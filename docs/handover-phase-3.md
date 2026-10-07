# Passation — Phase 3 (assiduité et notifications)

Branche `feat/phase-3-assiduite`, empilée sur `feat/phase-2-academique` (PR #3 → PR #2 → PR #1). Backlog : `docs/backlog/phase-3-assiduite.md` ; ADR mises en œuvre : 0003 (outbox → notifications), 0006 (statuts d'assiduité), 0007 (portées).

## Ce qui est livré

**Base (migration `0003_assiduite_notifications`)** — 9 tables tenant sous RLS : `attendance_sheets` (une par séance, `UNIQUE(tenant_id, session_id)`, `version`), `attendance_records` (`status` × `excuse_status`, `late_minutes`, `left_early_at`, `UNIQUE(tenant_id, session_id, student_id)`), `attendance_record_revisions` (append-only), `absence_justifications` + `justification_records`, `attendance_daily_stats`, `attendance_alerts` (une alerte ouverte par élève et par type), `notifications` (`UNIQUE(tenant_id, event_id, recipient_user_id, channel)`), `notification_preferences`.

**Module `attendance`** (couche 3)

- `GET /me/schedule/today` : séances du jour (fuseau de l'établissement) de l'acteur avec l'état de l'appel et la « prochaine » séance (première sans feuille soumise dont la fin n'est pas passée de plus de 30 min).
- Ouverture `POST /sessions/:id/attendance-sheet` : idempotente (deux ouvertures simultanées → la contrainte unique désigne le gagnant, l'autre relit) ; un enregistrement PRESENT par inscription active dans le groupe à la date de la séance ; interdite plus de 15 min avant le début ; **rétroactive** (plus de 24 h après la fin) réservée à `TAKE_ATTENDANCE_ANY` et marquée.
- Brouillon `PATCH` et validation `POST …/submit` avec **version optimiste** (409 `VERSION_CONFLICT` + `currentVersion`). Normalisation `AttendancePolicy.normalize` : un retard ≥ seuil tenant devient ABSENT (durée conservée), durée bornée par la séance, sortie anticipée réservée aux présents ; élève sans enregistrement → 422 détaillé. La soumission passe la séance en HELD, journalise, publie `AttendanceSheetSubmitted` (liste des absents/retards) et recalcule les statistiques.
- Corrections `PATCH /attendance-records/:id` : motif obligatoire, ligne de révision, `EDIT_ATTENDANCE` dans la fenêtre (feuille SUBMITTED, fin + `correctionWindowHours`), `EDIT_ATTENDANCE_LOCKED` sinon (révision marquée « hors fenêtre ») ; événement `AttendanceCorrected` si le statut change. Verrouillage par période `POST /attendance-sheets/lock`.
- Appels manquants `GET /attendance-sheets/missing` (séances terminées sans feuille soumise, 7 jours par défaut).
- Justificatifs : dépôt par la vie scolaire ou par un **parent autorisé** (règle tenant `guardianJustificationsEnabled` **et** droit `can_justify` du lien ; 404 avant 403), rattachement automatique aux enregistrements ABSENT/LATE soumis de l'intervalle (→ `PENDING`), décision `APPROVED` (→ `EXCUSED`) / `REJECTED` (ne rétrograde jamais un `EXCUSED`) / `INFO_REQUESTED` (reste en file), événements `JustificationSubmitted` / `JustificationReviewed`.
- Statistiques : `attendance_daily_stats` recalculées **dans la transaction** pour les élèves touchés (déterministe ; un recalcul complet par le worker donnerait le même résultat), lecture « présence physique » (EXCUSED compte absent). Seuil « N absences non justifiées sur W jours » → `attendance_alerts` (mise à jour, résolution automatique si la situation s'améliore, clôture manuelle) + événement `RepeatedAbsencesDetected`.
- Tableaux de bord enseignant, vie scolaire ; espace parent `GET /me/children/summary` (un appel : aujourd'hui, 30 jours, récents, alertes, justificatifs), historique et justificatifs par enfant via `GuardianService.assertGuardianAccess`.

**Module `notifications`** (couche 4)

- `NotificationPlanner.handle(event)` : résout les destinataires (tuteurs avec le droit et un compte, membres portant une permission, enseignants du cours), rend les gabarits (`domain/templates.ts`, SMS ≤ 160 caractères), **agrège par tuteur** (un SMS pour plusieurs enfants d'un même appel), applique les préférences (`notification_preferences`, in-app toujours conservé, PUSH ignoré en V1), crée les lignes `QUEUED` de façon idempotente puis envoie (`dispatch`) : in-app immédiat, SMS/e-mail via les ports `SmsGateway`/`EmailGateway`, **quota SMS mensuel** (`settings.notifications.smsMonthlyCap`, défaut 2000) → `SUPPRESSED`, avertissement aux administrateurs à 80 %.
- Canaux par défaut : absence → SMS + in-app ; retard → in-app ; décision de justificatif → SMS + in-app ; absences répétées → vie scolaire in-app + tuteur principal SMS ; appel non fait → enseignant in-app.
- Worker : `NotificationsEventHandler` (pont vers le planificateur), crons `SchedulesService` : appels manquants toutes les heures (séances terminées depuis 2 h, `event_id = missing:<session>`), filet d'envoi toutes les 15 min.
- API : boîte in-app (`/me/notifications`, non lues, marquage), préférences, journal administrateur (par élève, destinataire, canal, statut), renvoi manuel (`@NoTransaction`), consommation SMS.

**Web** — mes appels du jour et prochain cours ; feuille d'appel tactile (un tap = absent, ⏱ = retard avec durées rapides, brouillon conservé dans le navigateur et envoyé toutes les 10 s, indicateur hors ligne, validation, puis corrections motivées et historique des révisions) ; feuilles et appels manquants avec verrouillage ; justificatifs (file, décision, dépôt) ; élèves à surveiller ; espace parent (synthèse, historique filtrable, dépôt de justificatif) ; cloche et boîte de notifications, préférences, journal administrateur avec quota ; paramètres d'assiduité et SMS ; tableaux de bord enseignant et vie scolaire.

**Seed** — sur la séance seedée du 12/10 : feuille soumise (Aïcha absente, Koffi en retard, Mariam présente), justificatif en attente déposé par le parent, alerte d'absences répétées, notification in-app.

## Permissions et routes

34 routes nouvelles dans `test/permissions-matrix.yaml`. `RequirePermission` accepte désormais **plusieurs permissions (l'une suffit)** : `TAKE_ATTENDANCE` ou `TAKE_ATTENDANCE_ANY`, `EDIT_ATTENDANCE` ou `EDIT_ATTENDANCE_LOCKED`… La question « sur cette séance ? » reste dans `AttendancePolicy` (enseignant ↔ `course_teachers`) ; un non-enseignant du cours reçoit 403 à l'ouverture, 404 en lecture.

## Décisions d'implémentation à connaître

- Statistiques recalculées de façon synchrone (pas de job worker) : simple et testable ; à déplacer vers le worker si la soumission dépasse l'objectif de 300 ms sur de grandes classes.
- Les tuteurs **non invités** (sans compte) ne reçoivent rien : inviter les parents fait partie de la mise en service (le tableau de bord scolarité montre « parents activés »).
- L'agrégation couvre un même appel ; l'agrégation entre appels d'une même matinée (E5-S02) n'est pas faite.
- Pas de dépôt de fichier pour les justificatifs (E3-S01 : stockage objet et antivirus à venir) : `documentName` conserve le nom annoncé.
- Pas de web push ni de repli push → SMS (E5-S05/S10) ; pas d'accusés de réception fournisseur (DLR) : `SENT` est l'état final tant que l'agrégateur SMS n'est pas câblé.
- Brouillon hors ligne : `localStorage` + `PATCH` périodique ; IndexedDB et service worker viendront avec le mode hors ligne complet.

## Non couvert (reporté)

E2-S05 rapport des corrections par utilisateur (les révisions sont indexées par auteur, l'écran manque), E3-S01 upload, E3-S07 rattachement a posteriori automatique (le rattachement se fait au dépôt), E4-S02 taux par classe sous seuil hebdomadaire, E5-S03 adaptateurs SMS/e-mail réels et DLR, E5-S05 repli, E5-S09 templates versionnés en fichiers, E5-S10 web push, E6-S05/S06, E7 (charge, E2E, formation, plan de pilote).

## État de vérification (CI GitHub Actions, PR #3)

**CI verte** au commit `b1db090` (7 octobre 2026) : lint type-checked, typecheck (api, web, contrats), frontières de modules, migrations up → down → up, tests unitaires (politiques d'assiduité, gabarits de notification), **94 tests d'intégration** (dont 23 nouveaux : feuilles d'appel, justificatifs et espace parent, notifications ; matrice et isolation étendues aux 34 nouvelles routes), OpenAPI.

Corrections apportées pendant la boucle :

| Problème rencontré                                                                                           | Correction                                                   |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `GROUP BY` sur une expression paramétrée (`at time zone $1`) refusé par PostgreSQL (paramètres distincts)    | sous-requête calculant `day` une fois, agrégat par-dessus    |
| test d'idempotence du worker perturbé par le worker BullMQ réel qui traite d'autres événements en parallèle  | comptage par référence (`invitation:<id>`) plutôt que global |
| test de la liste de surveillance dépendant de l'ordre des fichiers (alerte seedée résolue par un autre test) | alerte posée par le test lui-même                            |
| `string \| 'all'` redondant, assertion de type inutile côté web                                              | types simplifiés                                             |

## Prochaines étapes

1. Fusion de #1, #2, #3 dans `main` ; staging ; câblage de l'agrégateur SMS (port `SmsGateway`) sur numéros de liste blanche.
2. Pilote assiduité : former deux enseignants, mesurer « appel < 60 s » et « délai soumission → SMS », ajuster les seuils dans Paramètres.
3. Phase 4 — frais et paiements (ADR-0005, ADR-0010) : la portée parent (`assertGuardianAccess(…, 'finance' | 'pay')`) et le moteur de notifications sont prêts à être réutilisés.
