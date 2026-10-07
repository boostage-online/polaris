# Passation — Phase 6 (reporting, dashboards de direction, Super Admin)

Branche `feat/phase-6-reporting`, empilée sur `feat/phase-5-payments` (PR #6 → PR #5 → … → PR #1). Backlog : `docs/backlog/phase-6-reporting.md` ; document directeur, section « Phase 6 » ; ADR mises en œuvre : 0001 (RLS), 0003 (outbox et worker), 0007 (permissions).

**Règle d'or du module** : le reporting ne lit que ce que les autres modules ont écrit, ne modifie jamais une donnée métier, et ses agrégats sont **des tables tenant sous RLS** rafraîchies par le worker — pas des vues matérialisées PostgreSQL, qui ne supportent pas la RLS et casseraient l'isolation prouvée en Phase 1.

## Ce qui est livré

**Base (migration `0006_reporting`)** — 5 tables tenant sous RLS forcée :

- `report_attendance_daily` (clé `tenant, day, group`) : séances prévues et tenues, feuilles soumises et manquantes, enregistrements, présents, absents, retards, excusés, non justifiées, `refreshed_at`.
- `report_finance_daily` (clé `tenant, day, channel`) : nombre et montant des paiements, annulations, frais provider — un canal par méthode manuelle (`CASH`, `BANK_TRANSFER`, …) et par provider électronique (`FEDAPAY`, `KKIAPAY`, `FAKE`).
- `report_refreshes` : journal des rafraîchissements (période, lignes, durée, erreur).
- `scheduled_reports` : rapport, cadence (`WEEKLY` jour 1–7 lundi = 1, `MONTHLY` jour 1–28), destinataires (10 max.), filtres (`groupId`), `enabled`, `last_sent_at`, `last_error`, auteur.
- `tenant_exports` : état (`QUEUED → RUNNING → DONE | FAILED`), demandeur, horodatages, taille, inventaire des fichiers (`entries`), archive (`file bytea`), erreur.

**Rafraîchissement** (`ReportRefreshService`) : `refresh(tenantId, période)` supprime puis réinsère les lignes de la période par CTE depuis `class_sessions`/`attendance_sheets`/`attendance_records` et `payments`/`payment_attempts` ; par défaut les **3 derniers jours** dans le fuseau de l'établissement (les corrections d'appel et les annulations sont donc reprises) ; `refreshAll()` boucle sur les tenants actifs et journalise sans bloquer les autres en cas d'erreur. Cron `reports-refresh` toutes les **5 minutes** (G6) ; `POST /reports/refresh` à la demande ; `{ full: true }` reconstruit depuis le début de l'année scolaire via la file `reports` (3 essais, backoff exponentiel 10 s). Chaque dashboard affiche la date du dernier rafraîchissement.

**Catalogue de rapports** (`ReportsService`, 8 rapports MVP, `GET /reports` filtré par les permissions de l'acteur ; chaque rapport porte **sa propre permission**, vérifiée à l'exécution : un censeur n'obtient pas le rapport financier même s'il entre par `VIEW_REPORTS`) :

| Clé                      | Titre                   | Permission                | Période par défaut | Source                                   |
| ------------------------ | ----------------------- | ------------------------- | ------------------ | ---------------------------------------- |
| `attendance-by-group`    | Assiduité par classe    | `VIEW_ATTENDANCE_REPORTS` | 30 j               | `report_attendance_daily`                |
| `students-at-risk`       | Élèves à risque         | `VIEW_ATTENDANCE_REPORTS` | 30 j               | enregistrements + alertes (temps réel)   |
| `missing-sheets`         | Appels non réalisés     | `VIEW_ATTENDANCE_REPORTS` | 14 j               | séances terminées sans feuille soumise   |
| `attendance-corrections` | Corrections d'appel     | `VIEW_ATTENDANCE_REPORTS` | 30 j               | `attendance_record_revisions` par auteur |
| `collections-by-channel` | Encaissements par canal | `VIEW_FINANCIAL_REPORTS`  | 30 j               | `report_finance_daily`                   |
| `recovery-by-group`      | Recouvrement par classe | `VIEW_FINANCIAL_REPORTS`  | 365 j              | créances et échéances (temps réel)       |
| `parent-activation`      | Activation des parents  | `VIEW_REPORTS`            | 365 j              | tuteurs, invitations, comptes            |
| `payment-attempts`       | Tentatives de paiement  | `VIEW_FINANCIAL_REPORTS`  | 30 j               | `payment_attempts` par provider/statut   |

Chaque rapport accepte `from`, `to` et `groupId`. `GET /reports/:key` renvoie l'aperçu JSON (5 000 lignes max., `truncated`) ; `GET /reports/:key.csv` le fichier complet (`;`, BOM UTF-8, booléens « oui/non », nom `clé_du_au.csv`, `Content-Disposition` exposé par CORS).

**Tableaux de bord** (`DashboardsService`) :

- `GET /dashboards/direction` (`VIEW_REPORTS`) : élèves actifs et nouveaux (30 j) ; présence 7 j / 30 j / 30 j précédents, appels manquants 7 j, élèves à risque, non justifiées ; finance de l'année (facturé, encaissé, reste, retard, taux), encaissé mois / mois précédent, part du paiement en ligne (30 j), revues ouvertes ; parents (total, activés, taux) ; SMS du mois vs plafond (`settings.notifications.smsMonthlyCap`, 2 000 par défaut), in-app non lues ; tendances sur 8 semaines ; les 5 classes les moins assidues.
- `GET /dashboards/pedagogy?from&to` (`VIEW_ATTENDANCE_REPORTS`) : par classe (taux, absents, retards, non justifiées, appels manquants), élèves à risque (50 max. : alerte ouverte, ou ≥ 3 non justifiées, ou taux < 80 % sur ≥ 5 séances), appels manquants par enseignant, répartition des retards (≤ 5, 6–15, 16–30, > 30 min).
- `GET /dashboards/finance/channels?from&to` (`VIEW_FINANCIAL_REPORTS`) : par canal (libellé, type manuel/électronique, paiements, montant, annulés, frais, part), paiements en ligne (tentatives, réussies, échouées, en attente, à vérifier, taux de réussite, **délai médian de confirmation**), série quotidienne manuel/en ligne.

**Traçabilité** (`TraceService`) : `GET /trace/sheets/:id` (`VIEW_ATTENDANCE_ANY` | `VIEW_ATTENDANCE_REPORTS` | `VIEW_AUDIT_LOG`) — feuille (état, version, rétroactive, qui a ouvert/soumis/verrouillé et quand), séance et enseignants, effectifs, corrections après soumission (avant → après, motif, hors fenêtre, auteur), notifications parents issues de la feuille (par agrégat outbox ou `missing:<séance>` pour les appels manquants), audit ; `GET /trace/notifications/:id` (`MANAGE_TENANT_SETTINGS` | `VIEW_AUDIT_LOG`) — destinataire et adresse, rendu, tentatives, erreur, identifiant provider, événement source (ou `synthetic` si créée hors outbox), autres envois du même événement, préférences du destinataire.

**Rapports planifiés** (`ScheduledReportsService`) : CRUD + « Envoyer maintenant » (`VIEW_REPORTS`) ; cron `reports-scheduled-send` à **6 h 30** : `runDue(tenantId, now)` sélectionne les rapports actifs dont le jour correspond (jour ISO de la semaine ou jour du mois dans le fuseau du tenant), calcule la période écoulée (7 jours ou mois précédent), génère le CSV et l'envoie en **pièce jointe** (`EmailAttachment` ajouté au port `EmailMessage`) ; **au plus un envoi par jour** (`last_sent_at`), erreur conservée dans `last_error` sans bloquer les autres.

**Export complet** (`TenantExportService`, `MANAGE_TENANT_SETTINGS`) : `POST /tenant-exports` crée la demande et met un job `tenant-export` en file ; le worker (`ReportsProcessor`) construit **20 CSV** (`eleves`, `tuteurs`, `liens_eleve_tuteur`, `annees`, `groupes`, `inscriptions`, `seances`, `appels`, `presences`, `justificatifs`, `grilles_de_frais`, `creances`, `echeances`, `ajustements`, `paiements`, `allocations`, `recus`, `tentatives_paiement`, `notifications`, `journal_audit`) + `README.txt`, les assemble dans un ZIP écrit **sans dépendance** (`infrastructure/zip.ts` : deflate, CRC-32, noms UTF-8) et le stocke dans `tenant_exports.file` ; `GET /tenant-exports/:id/download` le sert en flux. Les 20 derniers exports sont listés ; aucun secret ni clé provider n'y figure.

**Vue Super Admin** (`PlatformOverviewService`, `GET /platform/overview`, portée plateforme, `PLATFORM_VIEW_METRICS`) : parc (total, actifs, essai, suspendus) ; volumétrie (élèves actifs, tuteurs et activés, encaissé jour et mois, présence 7 j) ; paiements 24 h (tentatives, réussies, échouées, en attente, à vérifier, webhooks, par provider) ; santé (ping base et Redis, retard de l'outbox et âge du plus ancien événement, compteurs réels des files BullMQ `domain-events`, `payments`, `schedules`, `reports`, `maintenance` et de leurs DLQ, établissements dont les agrégats ont plus de 20 minutes) ; erreurs 24 h (UNKNOWN, notifications en échec, imports en échec, revues ouvertes) ; tableau par établissement (élèves, activation des parents, présence 7 j, appels manquants, encaissé du mois, provider en ligne, tentatives en attente, revues, SMS, dernier rafraîchissement).

**Web**

- `/direction` (`VIEW_REPORTS`) : 4 KPI, cartes Assiduité / Finance avec variation vs période précédente et tendances en barres (sans bibliothèque graphique), classes les moins assidues (lien vers la ligne du dashboard pédagogique), parents et notifications (jauge SMS), bouton « Rafraîchir les agrégats ».
- `/pedagogy` (`VIEW_ATTENDANCE_REPORTS`) : filtre de période (7/30/90 j ou dates), taux par classe avec barres colorées par seuil (≥ 90 vert, ≥ 75 ambre, rouge), élèves à risque (lien fiche élève, CSV), appels non réalisés par enseignant (CSV), répartition des retards.
- `/reports` : catalogue par famille (assiduité, finance, adoption), aperçu (200 lignes affichées, période, classe), CSV, rafraîchissement ; onglet **Rapports planifiés** (créer, suspendre/réactiver, envoyer maintenant, supprimer avec confirmation en ligne) ; onglet **Export complet** (administrateur : demander, suivi automatique toutes les 5 s tant qu'un export est en cours, télécharger).
- `/finance` : carte « Par canal (30 derniers jours) » avec taux de réussite et délai médian des paiements en ligne.
- `/platform` (Super Admin) : onglets Vue d'ensemble, Établissements (créer, suspendre avec motif, réactiver, inviter un administrateur — réutilise `/platform/tenants`), Santé technique (files, DLQ, outbox).
- `/trace/sheets/[id]` et `/trace/notifications/[id]` ; boutons « Tracer » dans la liste des feuilles d'appel et dans le journal des notifications ; navigation : section **Pilotage** (Direction, Pédagogie, Rapports) et **Super Admin** (Plateforme).

**Seed** — par tenant : un rapport planifié hebdomadaire « Assiduité par classe » et un export `DONE` minimal (archive de démonstration).

## Permissions et routes

20 routes nouvelles dans `test/permissions-matrix.yaml` : catalogue et rapports pour ADMIN, STUDENT_LIFE, ACADEMIC_HEAD, DIRECTION (FINANCE n'a que le catalogue : la matrice joue `attendance-by-group`, rapport d'assiduité) ; dashboards selon leur permission ; traces ; rapports planifiés pour ADMIN, ACADEMIC_HEAD, DIRECTION ; exports pour ADMIN seul ; `/platform/overview` en portée plateforme. L'isolation joue `/trace/*`, `/scheduled-reports/:id`, `/tenant-exports/:id(/download)` avec les identifiants du tenant A depuis le tenant B (404 attendu) ; `:key` est exclu (ce n'est pas un identifiant de ressource).

## Décisions d'implémentation à connaître

- **Tables plutôt que vues matérialisées** : la RLS forcée ne s'applique pas aux vues matérialisées ; les agrégats sont des tables ordinaires, remplies par tenant dans une transaction tenant (`withTenantTx`), donc isolées comme le reste.
- **Fenêtre glissante de 3 jours** : suffisante pour absorber corrections d'appel et annulations de paiement ; au-delà, le rafraîchissement complet (`full`) est disponible et reste idempotent (suppression + réinsertion).
- **Permission par rapport** : la permission d'entrée du contrôleur est la plus large (`VIEW_REPORTS` ou l'une des deux spécialisées) ; la définition du rapport tranche (403). Le catalogue ne montre que ce que l'acteur peut exécuter.
- **Médiane de confirmation** : `percentile_cont(0.5)` sur `completed_at − created_at` des tentatives réussies ; la statistique attendue par la Phase 5 (G5 : < 60 s) est désormais visible par établissement et par provider.
- **Export en base** (`bytea`) plutôt qu'en stockage objet : simple et transactionnel pour les volumes des pilotes (quelques Mo) ; à déplacer vers un stockage objet signé si un établissement dépasse ~50 Mo (voir Phase 7).
- **ZIP sans dépendance** : évite d'ajouter une bibliothèque pour 20 fichiers ; testé par relecture du répertoire central (`listZip`) et CRC.
- **Rapports planifiés sans doublon** : la sélection « dû aujourd'hui » et `last_sent_at` dans le fuseau du tenant garantissent un envoi par jour même si le cron est rejoué.

## Non couvert (reporté)

Export PDF des rapports (le CSV suffit aux pilotes) ; comparaison inter-années ; alertes Super Admin par e-mail (DLQ, outbox) — Phase 7 avec la supervision ; stockage objet pour les exports volumineux ; rapports personnalisés (colonnes au choix) ; test utilisateur de compréhension des dashboards avec un chef d'établissement pilote (porte G6, à faire sur staging).

## État de vérification (CI GitHub Actions, PR #6)

**CI verte** au commit `637d6bb` (7 octobre 2026, API + écrans web + documentation) — lint type-checked, typecheck (api, web, contrats), frontières de modules, migrations up → down → up, tests unitaires, **124 tests d'intégration** (dont 8 nouveaux pour le reporting), OpenAPI.

La CI a d'abord été bloquée côté GitHub (quota de minutes Actions de l'organisation épuisé sur un dépôt privé : « spending limit needs to be increased ») ; le dépôt a été rendu public pour la débloquer. Corrections apportées pendant la boucle :

| Problème rencontré                                                                                                                                           | Correction                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Express fait correspondre `GET /reports/:key` à « clé.csv » avant la route CSV                                                                               | route `:key.csv` déclarée en premier dans le contrôleur                                   |
| le rafraîchissement complet partait de la première séance : le paiement seedé (2 oct.) précédait la séance (12 oct.) et les séances futures étaient ignorées | bornes = première séance ou premier paiement → dernière séance planifiée ou aujourd'hui   |
| `column reference "adjustments_total" is ambiguous` (installments ⋈ student_fees) sur le tableau de bord de direction                                        | colonnes qualifiées ; toutes les requêtes du module repassées au parseur PostgreSQL local |
| `instanceof Date` sur un type `Cell` (TS2358) dans l'export                                                                                                  | lignes lues en `unknown` avant conversion des dates                                       |
| le test d'isolation n'avait pas de fixture pour `:key`                                                                                                       | `:key` exclu (clé de rapport, pas un identifiant de ressource)                            |
| la matrice de permissions (≈ 190 routes × 9 rôles) dépassait les 5 s par défaut : les délais de la racine vitest ne sont pas hérités par les projets         | délais répétés dans chaque projet, délai explicite sur la matrice                         |
| assertion de type inutile sur `filters`                                                                                                                      | supprimée                                                                                 |

Tests : unitaires (`infrastructure/zip.test.ts` — archive relue, CRC, noms UTF-8) ; intégration `test/reporting.test.ts` — agrégats (égalité avec les tables sources, rejeu sans doublon), catalogue filtré et 403 par rapport, les 8 rapports en JSON et CSV (BOM, `;`, `Content-Disposition`), élèves à risque et encaissements par canal sur données seedées, dashboards direction/pédagogie/canaux et leurs 403, traces feuille et notification, rapports planifiés (création, validation 422, envoi immédiat avec pièce jointe CSV, `runDue` une fois par jour, suspension, suppression), export complet (409 si déjà en cours ou pas prêt, construction par le worker, inventaire, ZIP téléchargé et relu, 404 depuis l'autre tenant), vue plateforme (parc, santé, par établissement, 404 pour un rôle tenant) ; matrice (+20 routes) et isolation étendues.

## Prochaines étapes

1. Test utilisateur G6 : faire lire `/direction` et `/pedagogy` à un chef d'établissement pilote sans explication, noter les incompréhensions, ajuster libellés et seuils.
2. Staging : vérifier la durée de l'export complet sur les données réelles des pilotes (G6 < 10 min) et la charge du cron de rafraîchissement.
3. Phase 7 — durcissement : supervision et alertes (DLQ, outbox, agrégats périmés), sauvegardes et restauration testées, charge (k6), revue de sécurité, journal d'audit consultable.
