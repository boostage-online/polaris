# Phase 4 — Frais et paiements manuels

**Fenêtre** : 22 fév → 26 mar 2027 (5 semaines, 2,5 sprints). **Objectif** : l'établissement sait à tout moment qui doit quoi, encaisse à la caisse en moins de 30 secondes avec un reçu infalsifiable, et relance les retards sans effort. **Porte G4** : 100 % des élèves actifs des pilotes portent une créance ; journal de caisse exporté = brouillard de caisse sur deux semaines ; 0 écart au contrôle d'intégrité ; rappels J−7 / J+1 reçus par les parents de test.

**ADR mises en œuvre** : 0005, 0003, 0007. **Prérequis** : G3 ; grilles tarifaires des pilotes collectées (Phase 0) ; code établissement court et stable (numérotation des reçus).

| Epic | Titre                                            | Points  | Must |
| ---- | ------------------------------------------------ | ------- | ---- |
| E1   | Catalogue : catégories, grilles, échéanciers     | 13      | ✔    |
| E2   | Créances : affectation, échéances, ajustements   | 21      | ✔    |
| E3   | Paiement manuel, allocation, crédits, annulation | 26      | ✔    |
| E4   | Reçus numérotés et vérification                  | 13      | ✔    |
| E5   | Impayés, rappels, exports                        | 21      | ✔    |
| E6   | Tableaux de bord finance et parent               | 13      | ✔    |
| E7   | Intégrité du grand-livre et exploitation         | 8       | ✔    |
|      | **Total**                                        | **115** |      |

> **État (PR #4, octobre 2026)** : E1 à E7 livrés dans leur périmètre « must » avec leurs écrans, testés en CI. Reporté : E2-S06 prorata, E3-S07 remboursement au parent, E4-S04 QR image et archivage S3, E5-S06 rapprochement bancaire, E5-S07 clôture de caisse signée, E7-S03 file asynchrone d'affectation. Détail : `docs/handover-phase-4.md`.

---

## E1 — Catalogue

| ID        | Story                                                                                                                                           | Critères d'acceptation                                          | Pts | Prio |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --- | ---- |
| P4-E1-S01 | [Tech] Tables `fee_categories`, `fee_structures`, `fee_schedule_items` sous RLS ; code de grille unique par année                               | Migration up/down ; 409 sur doublon                             | 3   | M    |
| P4-E1-S02 | En tant que comptable, je veux créer des catégories (scolarité, cantine, transport) afin de classer les frais                                   | CRUD ; suppression refusée si utilisée                          | 2   | M    |
| P4-E1-S03 | En tant que comptable, je veux créer une grille avec un échéancier (libellé, montant, date) et une cible par défaut afin de l'affecter en masse | Total = Σ tranches ; rangs uniques ; cible niveaux/classes      | 5   | M    |
| P4-E1-S04 | En tant que comptable, je veux que l'échéancier d'une grille déjà affectée soit figé afin que les créances existantes ne bougent pas            | 409 explicite ; archivage possible ; nouvelle grille conseillée | 3   | M    |

## E2 — Créances

| ID        | Story                                                                                                                                                    | Critères d'acceptation                                                                | Pts | Prio |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --- | ---- |
| P4-E2-S01 | [Tech] `student_fees`, `installments`, `fee_adjustments`, `fee_assignments` ; montants stockés et fonction de recalcul                                   | Invariants testés ; statuts dérivés unitairement                                      | 5   | M    |
| P4-E2-S02 | En tant que comptable, je veux affecter une grille à des classes, niveaux ou élèves à une date de référence afin de créer les créances                   | Inscriptions actives à `asOf` ; rapport ciblés/créés/ignorés ; rejouable sans doublon | 5   | M    |
| P4-E2-S03 | En tant que comptable, je veux affecter une grille à un seul élève (arrivée tardive, option) afin de traiter les cas particuliers                        | Depuis la fiche finance                                                               | 2   | M    |
| P4-E2-S04 | En tant que comptable, je veux émettre une remise, bourse, exonération, pénalité ou correction motivée afin d'ajuster une créance sans toucher la grille | Signé ; par créance ou échéance ; refusé sous le déjà-payé ; audité                   | 5   | M    |
| P4-E2-S05 | En tant que comptable, je veux voir le compte complet d'un élève (dû, payé, solde, exigible, retard, crédit) afin de répondre au guichet                 | Un appel ; p95 < 300 ms                                                               | 3   | M    |
| P4-E2-S06 | En tant que comptable, je veux un prorata automatique pour une arrivée en cours d'année                                                                  | Règle par grille                                                                      | 3   | C    |

## E3 — Paiement manuel

| ID        | Story                                                                                                                                                         | Critères d'acceptation                                                                                              | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| P4-E3-S01 | [Tech] `payments` immuables (trigger), `payment_allocations` signées, `refunds`, `student_credits`                                                            | `UPDATE`/`DELETE` interdits sauf `COMPLETED → REVERSED` ; tests SQL                                                 | 5   | M    |
| P4-E3-S02 | [Tech] Plan d'allocation pur : ciblées puis plus anciennes, reliquat en crédit                                                                                | Tests unitaires de bord (0, surplus, partiel)                                                                       | 3   | M    |
| P4-E3-S03 | En tant que caissier, je veux encaisser espèces, virement, chèque ou mobile money hors ligne avec une clé d'idempotence afin de ne jamais doubler un paiement | `Idempotency-Key` obligatoire (422) ; rejeu → même réponse ; allocation sous verrou ; reçu dans la même transaction | 8   | M    |
| P4-E3-S04 | En tant que caissier, je veux cibler des échéances précises afin de respecter la volonté du parent                                                            | Ordre d'imputation respecté puis plus anciennes                                                                     | 2   | M    |
| P4-E3-S05 | En tant que comptable, je veux qu'un trop-perçu devienne un crédit imputé automatiquement sur les créances suivantes                                          | Crédit visible ; appliqué à l'affectation et après pénalité                                                         | 3   | M    |
| P4-E3-S06 | En tant que comptable, je veux annuler un paiement erroné par écriture compensatoire motivée afin de garder une piste intègre                                 | Allocations inversées ; crédits remboursés ; reçu d'annulation ; 409 si déjà annulé ; parent notifié                | 5   | M    |
| P4-E3-S07 | En tant que comptable, je veux rembourser un parent (crédit → sortie de caisse) avec pièce                                                                    | `ISSUE_REFUND` ; écran et reçu de remboursement                                                                     | 5   | S    |

## E4 — Reçus

| ID        | Story                                                                                                                      | Critères d'acceptation                                                                  | Pts | Prio |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --- | ---- |
| P4-E4-S01 | [Tech] Numérotation `CODE-AAAA-000001` séquentielle sans trou par tenant et année                                          | Verrou consultatif ; deux encaissements simultanés → numéros consécutifs                | 3   | M    |
| P4-E4-S02 | En tant que parent, je veux un reçu avec instantané figé (établissement, élève, lignes, mode) afin de prouver mon paiement | `receipts.snapshot` ; PDF A5 imprimable ; téléchargeable côté staff et parent           | 5   | M    |
| P4-E4-S03 | En tant que tiers, je veux vérifier l'authenticité d'un reçu par son lien sans rien apprendre de personnel                 | Route publique ; `VALID` / `CANCELLED` / `UNKNOWN` ; montant et établissement seulement | 3   | M    |
| P4-E4-S04 | QR image sur le PDF, logo, archivage S3                                                                                    | `pdf_key` renseigné                                                                     | 2   | C    |

## E5 — Impayés, rappels, exports

| ID        | Story                                                                                                                      | Critères d'acceptation                                                  | Pts | Prio |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --- | ---- |
| P4-E5-S01 | En tant que comptable, je veux la liste des échéances dues ou en retard filtrable (classe, grille, élève) afin de relancer | Plus anciennes d'abord ; nombre de rappels ; pagination                 | 3   | M    |
| P4-E5-S02 | En tant que direction, je veux la synthèse par classe (dû, payé, solde, retard, taux) afin de piloter le recouvrement      | Totaux et barres                                                        | 3   | M    |
| P4-E5-S03 | [Tech] Rappels automatiques J−n, J+1 puis tous les n jours, dédoublonnés, agrégés par tuteur                               | Cron quotidien ; `payment_reminders` ; paramètres tenant                | 5   | M    |
| P4-E5-S04 | En tant que comptable, je veux envoyer un rappel manuel à une sélection avec un complément de message                      | Un rappel par échéance et par jour ; rapport tuteurs/échéances/ignorées | 3   | M    |
| P4-E5-S05 | En tant que comptable, je veux exporter le journal des encaissements, la balance âgée et les impayés en CSV                | `;` + BOM ; filtres période/classe ; `EXPORT_FINANCIAL_DATA`            | 3   | M    |
| P4-E5-S06 | Rapprochement des virements et chèques avec le relevé bancaire                                                             | Import relevé ; statut rapproché                                        | 5   | C    |
| P4-E5-S07 | Clôture de caisse journalière signée par le caissier                                                                       | Écart constaté/attendu ; PDF                                            | 3   | S    |

## E6 — Tableaux de bord

| ID        | Story                                                                                                                 | Critères d'acceptation                             | Pts | Prio |
| --------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --- | ---- |
| P4-E6-S01 | En tant que direction, je veux un tableau de bord finance (année, caisse du jour par mode et caissier, mois, 7 jours) | Un appel ; rafraîchi toutes les 2 min              | 5   | M    |
| P4-E6-S02 | En tant que parent, je veux voir le solde, la prochaine échéance, l'échéancier et mes reçus pour chaque enfant        | Droit « frais » du lien ; 404 avant 403 ; reçu PDF | 5   | M    |
| P4-E6-S03 | En tant que parent, je veux être notifié d'un paiement reçu ou annulé et d'une échéance proche ou en retard           | SMS + in-app ; agrégé par tuteur                   | 3   | M    |

## E7 — Intégrité et exploitation

| ID        | Story                                                                                                               | Critères d'acceptation                                                          | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --- | ---- |
| P4-E7-S01 | [Tech] `LedgerIntegrityCheck` quotidien : montants stockés vs écritures, invariants d'allocation ; alerte si écart  | Table d'historique ; événement ; déclenchement manuel depuis le tableau de bord | 5   | M    |
| P4-E7-S02 | [Tech] `RECEIPT_SECRET` par environnement, obligatoire en production ; matrice de permissions et isolation étendues | CI                                                                              | 1   | M    |
| P4-E7-S03 | [Tech] Affectation de masse asynchrone au-delà de 200 élèves                                                        | Job worker ; progression                                                        | 2   | C    |
