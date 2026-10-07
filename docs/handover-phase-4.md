# Passation — Phase 4 (frais et paiements manuels)

Branche `feat/phase-4-billing`, empilée sur `feat/phase-3-assiduite` (PR #4 → PR #3 → PR #2 → PR #1). Backlog : `docs/backlog/phase-4-billing.md` ; ADR mises en œuvre : 0005 (modèle financier : dette, paiement, allocation), 0003 (outbox → notifications), 0007 (permissions). Les paiements électroniques (FedaPay, KKiaPay, ADR-0010) sont la Phase 5 : le modèle les accueille déjà (`payments.source = 'ELECTRONIC'`, `attempt_id`, méthodes `MOBILE_MONEY`/`CARD`, `refunds.kind = 'PROVIDER_REFUND'`).

## Ce qui est livré

**Base (migration `0004_billing`)** — 15 tables tenant sous RLS forcée :

- Catalogue : `fee_categories`, `fee_structures` (`applies_to` jsonb, `status`), `fee_schedule_items` (échéancier type).
- Créances : `fee_assignments` (journal des affectations de masse), `student_fees` (`UNIQUE(tenant_id, student_id, fee_structure_id)`, montants stockés `amount_allocated`, `adjustments_total`, `status`), `installments` (`UNIQUE(student_fee_id, seq)`), `fee_adjustments` (append-only, signés).
- Paiements : `payments` **immuables** — le trigger `payments_guard()` n'autorise que la transition `COMPLETED → REVERSED` avec ses champs d'annulation, et interdit `DELETE` ; `UNIQUE(attempt_id)` ; `refunds` (append-only) ; `payment_allocations` (montant signé ; négatif seulement avec `refund_id` ; `credit_id` quand l'imputation vient d'un crédit) ; `student_credits`.
- Reçus : `receipt_sequences (tenant_id, year, last_seq)`, `receipts` (`UNIQUE(tenant_id, number)`, `UNIQUE(payment_id, kind)`, instantané figé, `verify_hash`, append-only).
- Suivi : `payment_reminders` (`UNIQUE(installment_id, kind, scheduled_for)`), `ledger_integrity_checks`.

**Domaine pur `billing/domain/ledger.ts`** (testé unitairement) — statuts dérivés d'une échéance (`PENDING` → `DUE` → `OVERDUE` avec jours de grâce ; `PARTIALLY_PAID` / `PAID` ; `CANCELLED` si le dû tombe à zéro), statut de la créance, **plan d'allocation** (échéances ciblées dans l'ordre donné, puis les plus anciennes par date puis rang, `a = min(reste, montant restant)`, reliquat → crédit), numérotation `CODE-AAAA-000001`, empreinte de vérification (`sha256(secret|tenant|numéro|montant)` tronquée), calendrier des rappels (J−n avant ; J+1 puis tous les n jours après).

**Services**

- `CatalogService` : catégories (suppression refusée si des grilles l'utilisent), grilles par année (total = Σ échéancier, code unique par année, **échéancier figé dès qu'une créance existe** → 409 ; archivage à la place).
- `LedgerService`
  - `assign` : résout les inscriptions principales actives à `asOf` (classes, niveaux, programmes ou élèves explicites, sinon la cible de la grille), crée une créance par élève **manquant** (copie de l'échéancier), journalise dans `fee_assignments`, applique les crédits ouverts, publie `FeesAssigned`. Rejouable sans effet.
  - `adjust` : ajustement signé par créance ou par échéance (imputé sinon sur la dernière échéance ouverte), **refusé si le dû passerait sous le déjà-payé** (422), recalcul des montants stockés.
  - `recordManual` : paiement manuel (`CASH`, `BANK_TRANSFER`, `CHEQUE`, `MOBILE_MONEY_OFFLINE`), `@RequireIdempotencyKey()` (422 sans en-tête ; rejeu → même réponse, `Idempotent-Replayed`), allocation sous `FOR UPDATE`, reliquat en crédit, reçu émis dans la même transaction, audit, événements `PaymentRecorded` / `OverpaymentRecorded`.
  - `reverse` : **annulation compensatoire** — `refunds(INTERNAL_REVERSAL)`, allocations négatives, crédits issus du paiement passés `REFUNDED`, paiement `REVERSED` (seule mutation permise par le trigger), reçu d'annulation lié, événement `PaymentReversed` ; 409 si déjà annulé.
  - `applyCredits` : impute les crédits ouverts sur les échéances ouvertes (à l'affectation et après une pénalité).
  - `account` : tout le compte en un appel (totaux dû / payé / solde / exigible / retard / crédit, créances et échéances, paiements avec imputations et reçus, crédits, ajustements).
  - `integrityCheck` : recompose chaque échéance et créance depuis les écritures et compare aux montants stockés, vérifie les invariants des allocations (somme par paiement ≤ montant, négatives seulement avec remboursement) ; résultat dans `ledger_integrity_checks`, événement `LedgerIntegrityMismatch` vers `VIEW_FINANCIAL_REPORTS` si écart.
- `ReceiptService` : numéro **sans trou** sous `pg_advisory_xact_lock(hashtext('receipts:<tenant>:<année>'))`, instantané (établissement, élève, paiement, lignes d'imputation, crédit, `cancels`/`reason` pour une annulation), `verifyUrl = WEB_ORIGIN/r/{code}/{numéro}/{empreinte}`, PDF A5 généré sans dépendance (`infrastructure/pdf.ts`, Helvetica WinAnsi), vérification publique en portée identité (`VALID` / `CANCELLED` / `UNKNOWN`, rien de nominatif).
- `UnpaidService` : échéances ouvertes (élève, classe, grille, statut, recherche ; les plus anciennes d'abord ; nombre de rappels), synthèse par classe (dû, payé, solde, retard, taux), **rappels automatiques** (`scheduleReminders` : dédoublonnés par `payment_reminders`, un événement agrégé par type), rappels manuels (un par échéance et par jour, 240 caractères de complément), exports CSV `;` avec BOM (journal des encaissements, balance âgée 0–30 / 31–60 / 61–90 / > 90, impayés par échéance), élèves actifs sans créance.
- `FinanceDashboardService` : finance (année, caisse du jour par mode et par caissier, mois, 7 prochains jours, par classe, dernier contrôle d'intégrité, élèves sans frais) et parent (`/me/children/finance` : solde, prochaine échéance, échéances ouvertes, derniers paiements, `canPay`).

**Notifications** — `PAYMENT_RECEIVED` (SMS + in-app : montant, numéro de reçu, crédit éventuel), `PAYMENT_REVERSED`, `INSTALLMENT_DUE_SOON` / `INSTALLMENT_OVERDUE` (**agrégés par tuteur** : un message pour plusieurs enfants et échéances, SMS + in-app), `LEDGER_INTEGRITY` (in-app aux membres `VIEW_FINANCIAL_REPORTS`). Destinataires : tuteurs avec le droit « frais » et un compte activé. Cron quotidien `daily-billing` à 06:00 Africa/Porto-Novo : rafraîchissement des statuts dus/en retard, planification des rappels, contrôle d'intégrité, pour chaque tenant.

**Règles tenant** (`settings.billing`, écran Paramètres) : `graceDays` (0), `reminderDaysBefore` ([7, 1]), `overdueReminderEveryDays` (14). Secret `RECEIPT_SECRET` (obligatoire en production).

**Web** — `/finance` (tableau de bord et contrôle d'intégrité à la demande), `/finance/catalog` (catégories, grilles avec éditeur d'échéancier), `/finance/assign` (affectation de masse avec rapport), `/finance/students/[id]` (compte, échéances ciblables, **encaissement** avec clé d'idempotence générée à l'ouverture du formulaire et conservée jusqu'au succès, ajustements, annulation motivée, reçus et PDF), `/finance/cash` (journal filtrable, recherche rapide d'élève, export), `/finance/unpaid` (échéances ouvertes, sélection et rappel manuel, synthèse par classe, exports), `/r/[code]/[number]/[hash]` (vérification publique, cible du lien imprimé sur le reçu), espace parent (pastilles sur « Mes enfants », section frais / échéancier / reçus sur la fiche enfant), bloc finance du tableau de bord, lien depuis la fiche élève.

**Seed** — par tenant : catégorie `SCOLARITE`, grille `SCOL-6E` (3 × 50 000 FCFA au 01/10/2026, 10/01/2027, 01/04/2027, cible niveau 6e) affectée aux élèves actifs de 6e ; Aïcha a payé 60 000 FCFA en espèces le 02/10 (50 000 sur T1, 10 000 sur T2), reçu `{CODE}-2026-000001`.

## Permissions et routes

31 routes nouvelles dans `test/permissions-matrix.yaml` : lecture (`VIEW_FEES`, `VIEW_PAYMENTS`, `VIEW_FINANCIAL_REPORTS`) pour ADMIN, DIRECTION, FINANCE ; mutations (`MANAGE_FEE_STRUCTURES`, `ASSIGN_FEES`, `ADJUST_FEES`, `RECORD_MANUAL_PAYMENT`, `CANCEL_PAYMENT`, `SEND_PAYMENT_REMINDER`, `EXPORT_FINANCIAL_DATA`) pour ADMIN et FINANCE ; routes parent en portée identité avec `assertGuardianAccess(studentId, 'finance')` (404 avant 403 ; un parent sur une route staff reçoit 403). La vérification de reçu est `@Public()` + `@NoTransaction()` + `@Scope('identity')`.

## Décisions d'implémentation à connaître

- **Montants stockés + recalcul** : `student_fees` / `installments` portent `amount_allocated`, `adjustments_total`, `status` pour des lectures rapides ; la vérité reste dans les écritures, et `integrityCheck` les confronte chaque nuit. Toute écriture passe par `LedgerService.recompute`.
- **Jamais de suppression** : paiements, allocations, remboursements, reçus et ajustements sont append-only ou verrouillés par trigger ; une erreur se corrige par une écriture inverse. Les grilles s'archivent.
- **Créance figée** : la copie de l'échéancier dans `installments` est la seule source pour l'élève ; modifier une grille n'a d'effet que sur les affectations futures.
- **Crédit** plutôt que remboursement : un trop-perçu devient un `student_credit` imputé automatiquement sur les créances suivantes ; le remboursement effectif au parent (`ISSUE_REFUND`) n'a pas d'écran en V1.
- **Idempotence côté client** : l'écran génère une `Idempotency-Key` par formulaire, pas par clic ; un rejeu renvoie la réponse initiale avec le même reçu.
- **PDF minimal** : texte seul, A5, sans logo ni image de QR (le lien de vérification est imprimé en clair) ; le stockage objet (`receipts.pdf_key`) et le gabarit riche arrivent avec la Phase 5.
- **Rappels** : un seul événement agrégé par type et par jour → le planificateur de notifications regroupe par tuteur ; les rappels manuels ne court-circuitent pas le dédoublonnage quotidien.
- **Affectation synchrone** : convient aux pilotes (< 200 élèves par cible) ; un job worker est prévu au-delà.

## Non couvert (reporté)

Paiements électroniques et comptes marchands (Phase 5, ADR-0010) ; remboursement au parent avec écran et pièce comptable ; prorata pour arrivée en cours d'année (ajustement manuel en attendant) ; plan d'échelonnement individuel ; QR image et logo sur le reçu, archivage S3 des PDF ; rapprochement bancaire des virements et chèques (la `reference` est saisie, pas rapprochée) ; clôture de caisse journalière signée ; export comptable normalisé ; file asynchrone pour les affectations de masse.

## État de vérification (CI GitHub Actions, PR #4)

**CI verte** au commit `44adcb7` (7 octobre 2026, API + écrans web) — lint type-checked, typecheck (api, web, contrats), frontières de modules, migrations up → down → up, tests unitaires (`ledger.test.ts`), **105 tests d'intégration** (dont 11 nouveaux : catalogue, compte seedé, affectation idempotente et grille figée, encaissement idempotent avec allocation ciblée et reçu, trop-perçu → crédit → pénalité, ajustement refusé sous le payé, annulation compensatoire et immutabilité par trigger, PDF et vérification publique, impayés / rappels / planification J−7, exports / tableau de bord / intégrité, espace parent ; matrice et isolation étendues aux 31 routes), OpenAPI.

Corrections apportées pendant la boucle :

| Problème rencontré                                                                         | Correction                                               |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `kind=CANCELLATION` ignoré par `GET /payments/:id/receipt` (schéma de requête non branché) | paramètre lu par le contrôleur et documenté dans OpenAPI |
| espaces insécables littérales dans des expressions régulières (`no-irregular-whitespace`)  | échappements ` ` / ` `                                   |
| isolation : mutations billing sans corps valide → 422 au lieu de 404                       | corps minimaux ajoutés au test                           |
| attente de test oubliant la cantine affectée plus haut au même élève                       | attente corrigée (dû 150 000 après remise)               |
| nom de fichier des PDF/CSV invisible côté web (CORS)                                       | `Content-Disposition` exposé                             |

## Prochaines étapes

1. Fusion de #1 → #4 dans `main` ; staging ; `RECEIPT_SECRET` dédié par environnement ; vérifier l'impression A5 des reçus sur l'imprimante de la caisse pilote.
2. Pilote caisse : encaisser une semaine réelle, comparer le journal exporté au brouillard de caisse, ajuster `graceDays` et le calendrier des rappels dans Paramètres.
3. Phase 5 — paiements électroniques (ADR-0010) : `PaymentsModule` (tentatives, webhooks idempotents par `attempt_id`, rapprochement), réutilisant `LedgerService.allocate` / `ReceiptService.issue` tels quels.
