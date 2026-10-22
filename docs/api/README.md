# Référence de l'API Polaris (`/api/v1`)

Une seule API sert le site web et les apps mobiles. Ce document est le **guide** ; le **contrat exact** (schémas de chaque requête et réponse) est [`openapi.json`](./openapi.json), généré depuis le code (`pnpm openapi`) et publié aussi par le workflow « Captures d'écran ». En local, la documentation interactive est sur <http://localhost:4000/api/docs>.

## Conventions (ADR-0009)

- **Base** : `https://<domaine>/api/v1` (même origine que le site en production). JSON UTF-8.
- **Réponse** : enveloppe `{ "data": … }`, et `{ "data": [...], "meta": { "nextCursor": "…" } }` pour les listes paginées (`?limit=50&cursor=…`, 200 max). Quelques routes renvoient un fichier (CSV, PDF, ZIP) sans enveloppe.
- **Erreurs** : RFC 9457 `application/problem+json` — `{ "type", "title", "status", "code", "detail", "errors": [{ "path", "message" }], "traceId" }`. Le client affiche `detail` (déjà en français) et s'appuie sur `code` pour la logique (`VALIDATION_FAILED`, `INVALID_CREDENTIALS`, `MFA_REQUIRED`, `ACCOUNT_LOCKED`, `RATE_LIMITED`, `NOT_FOUND`, `CONFLICT`…). 422 = champ invalide, 409 = conflit d'état, 404 = absent **ou d'un autre établissement**, 429 = trop de requêtes (en-tête `Retry-After`).
- **Authentification** : `Authorization: Bearer <accessToken>` (10 min). Sessions :
  - **web** : en-tête `X-Client: web/<version>` → le refresh est un cookie HttpOnly `polaris_rt` (chemin `/api/v1/auth`) ;
  - **mobile** : `X-Client: mobile/<version>` (ou toute valeur ne commençant pas par `web`) → `refreshToken` dans le corps de la réponse de connexion ; `POST /auth/refresh {"refreshToken"}` renvoie une **nouvelle paire** (rotation : l'ancien refresh devient invalide ; réutilisé, il révoque toute la famille de sessions). Conserver le refresh dans le stockage sécurisé du système (Keychain / Keystore).
- **Connexion parent** : `POST /auth/otp/request {"phone":"+22997000000"}` (réponse identique que le numéro existe ou non ; 3 envois par heure) puis `POST /auth/otp/verify {"phone","code","deviceId","deviceLabel"}` → paire de jetons.
- **Connexion personnel** : `POST /auth/login {"identifier","password","deviceId"}` → paire de jetons **ou** `{ "mfaRequired": true, "challenge", "expiresIn" }` → `POST /auth/mfa/verify {"challenge","code"}`.
- **Plusieurs établissements** : la réponse liste `memberships` ; `POST /auth/switch-membership {"membershipId"}` change l'établissement actif (nouvelle paire).
- **Idempotence** : `Idempotency-Key: <uuid>` obligatoire sur la création d'une tentative de paiement et l'encaissement en caisse ; rejouer la même clé renvoie la même réponse.
- **Évolution** : l'API est **additive** — on ajoute des champs et des routes, on n'en retire pas sans nouvelle version. Les clients ignorent les champs inconnus.

## Parcours principaux

| Parcours                   | Appels                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Parent : accueil           | `GET /me` → `GET /me/children` → `GET /me/children/summary` → `GET /me/children/finance` → `GET /me/notifications`                                                                                                                                                                                                                                                        |
| Parent : suivi d'un enfant | `GET /me/children/:studentId/attendance?from&to` · `GET /me/children/:studentId/justifications` · `POST /me/children/:studentId/justifications`                                                                                                                                                                                                                           |
| Parent : payer             | `GET /me/children/:studentId/payment-options` → `POST /me/children/:studentId/payment-attempts` (`Idempotency-Key`) → ouvrir `checkout` (URL du provider ou widget) → retour → `POST …/payment-attempts/:attemptId/confirm` → `GET …/payment-attempts/:attemptId` jusqu'à un statut final → `GET /me/children/:studentId/fees` · reçu `…/payments/:paymentId/receipt.pdf` |
| Enseignant : appel         | `GET /me/schedule/today` → `POST /sessions/:id/attendance-sheet` (ouvre ou retrouve la feuille, pré-remplie « présents ») → `PATCH /attendance-sheets/:id {version, records}` → `POST /attendance-sheets/:id/submit {version}` (409 si la version a changé)                                                                                                               |
| Notifications              | `GET /me/notifications` · `POST /me/notifications/:id/read` · `GET                                                                                                                                                                                                                                                                                                        | PUT /me/notifications/preferences` |

## Catalogue des routes (231 routes, par module)

Colonne « Accès » : `public` (sans jeton), `authentifié` (tout utilisateur connecté ; les routes `/me/...` filtrent elles-mêmes sur l'utilisateur), `identity` (sans établissement actif requis), `platform` (Super Admin, MFA exigée), sinon la ou les permissions requises (l'une suffit ; voir `packages/contracts/src/permissions.ts` et `apps/api/test/permissions-matrix.yaml`). Catalogue extrait des contrôleurs ; en cas d'écart, `openapi.json` fait foi.

### health

| Méthode | Route                  | Description                                 | Accès  |
| ------- | ---------------------- | ------------------------------------------- | ------ |
| GET     | `/api/v1/health/live`  | Le processus répond                         | public |
| GET     | `/api/v1/health/ready` | Dépendances joignables et migrations à jour | public |
| GET     | `/api/v1/metrics`      | Métriques Prometheus                        | public |

### academic

| Méthode | Route                                    | Description                                                                      | Accès                     |
| ------- | ---------------------------------------- | -------------------------------------------------------------------------------- | ------------------------- |
| GET     | `/api/v1/staff`                          | Personnel et profils enseignants                                                 | MANAGE_USERS              |
| PATCH   | `/api/v1/staff/:membershipId`            | Profil enseignant (matricule, titre, enseignant oui/non)                         | MANAGE_USERS              |
| GET     | `/api/v1/courses`                        | Cours (matière × groupe) avec enseignants et créneaux                            | VIEW_STUDENTS             |
| GET     | `/api/v1/courses/:id`                    | Détail d’un cours                                                                | VIEW_STUDENTS             |
| POST    | `/api/v1/courses`                        | Créer un cours                                                                   | MANAGE_SCHEDULES          |
| PUT     | `/api/v1/courses/:id/teachers`           | Remplacer les enseignants d'un cours                                             | MANAGE_SCHEDULES          |
| DELETE  | `/api/v1/courses/:id`                    | Supprimer un cours (annule ses séances futures)                                  | MANAGE_SCHEDULES          |
| POST    | `/api/v1/courses/:id/schedule-slots`     | Ajouter un créneau récurrent (chevauchements signalés dans meta.warnings)        | MANAGE_SCHEDULES          |
| POST    | `/api/v1/courses/:id/sessions`           | Créer une séance ponctuelle                                                      | MANAGE_SCHEDULES          |
| DELETE  | `/api/v1/schedule-slots/:id`             | Supprimer un créneau (annule ses séances futures)                                | MANAGE_SCHEDULES          |
| GET     | `/api/v1/sessions`                       | Séances (filtres période, groupe, cours, statut)                                 | VIEW_STUDENTS             |
| GET     | `/api/v1/sessions/:id`                   | Détail d’une séance                                                              | VIEW_STUDENTS             |
| PATCH   | `/api/v1/sessions/:id`                   | Déplacer ou annuler une séance                                                   | MANAGE_SCHEDULES          |
| POST    | `/api/v1/sessions/generate`              | Générer les séances des prochains jours depuis les emplois du temps (idempotent) | MANAGE_SCHEDULES          |
| GET     | `/api/v1/me/schedule`                    | Mon emploi du temps : mes séances (ou toutes avec une portée globale)            | authentifié               |
| GET     | `/api/v1/academic-years`                 | Années académiques                                                               | VIEW_STUDENTS             |
| POST    | `/api/v1/academic-years`                 | Créer une année                                                                  | MANAGE_ACADEMIC_STRUCTURE |
| PATCH   | `/api/v1/academic-years/:id`             | Modifier une année                                                               | MANAGE_ACADEMIC_STRUCTURE |
| POST    | `/api/v1/academic-years/:id/set-current` | Définir l'année courante                                                         | MANAGE_ACADEMIC_STRUCTURE |
| GET     | `/api/v1/academic-years/:id/terms`       | Périodes d'une année                                                             | VIEW_STUDENTS             |
| POST    | `/api/v1/academic-years/:id/terms`       | Créer une période                                                                | MANAGE_ACADEMIC_STRUCTURE |
| GET     | `/api/v1/programs`                       | Programmes et niveaux                                                            | VIEW_STUDENTS             |
| POST    | `/api/v1/programs`                       | Créer un programme                                                               | MANAGE_ACADEMIC_STRUCTURE |
| PATCH   | `/api/v1/programs/:id`                   | Modifier un programme                                                            | MANAGE_ACADEMIC_STRUCTURE |
| DELETE  | `/api/v1/programs/:id`                   | Supprimer un programme (sans groupe)                                             | MANAGE_ACADEMIC_STRUCTURE |
| POST    | `/api/v1/programs/:id/levels`            | Ajouter un niveau                                                                | MANAGE_ACADEMIC_STRUCTURE |
| PATCH   | `/api/v1/levels/:id`                     | Modifier un niveau                                                               | MANAGE_ACADEMIC_STRUCTURE |
| GET     | `/api/v1/groups`                         | Groupes (classes, sous-groupes) d'une année                                      | VIEW_STUDENTS             |
| GET     | `/api/v1/groups/:id`                     | Détail d’un groupe                                                               | VIEW_STUDENTS             |
| POST    | `/api/v1/groups`                         | Créer un groupe                                                                  | MANAGE_ACADEMIC_STRUCTURE |
| PATCH   | `/api/v1/groups/:id`                     | Modifier un groupe                                                               | MANAGE_ACADEMIC_STRUCTURE |
| DELETE  | `/api/v1/groups/:id`                     | Supprimer un groupe (sans inscrit)                                               | MANAGE_ACADEMIC_STRUCTURE |
| GET     | `/api/v1/subjects`                       | Matières / UE                                                                    | VIEW_STUDENTS             |
| POST    | `/api/v1/subjects`                       | Créer une matière                                                                | MANAGE_ACADEMIC_STRUCTURE |
| PATCH   | `/api/v1/subjects/:id`                   | Modifier une matière                                                             | MANAGE_ACADEMIC_STRUCTURE |
| DELETE  | `/api/v1/subjects/:id`                   | Désactiver une matière (sans cours)                                              | MANAGE_ACADEMIC_STRUCTURE |

### attendance

| Méthode | Route                                           | Description                                                                                    | Accès                                                                                               |
| ------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET     | `/api/v1/me/schedule/today`                     | Mes séances du jour avec l'état de l'appel et le prochain cours                                | authentifié                                                                                         |
| POST    | `/api/v1/sessions/:id/attendance-sheet`         | Ouvrir (ou retrouver) la feuille d'appel d'une séance, pré-remplie « présents »                | TAKE_ATTENDANCE, TAKE_ATTENDANCE_ANY                                                                |
| GET     | `/api/v1/sessions/:id/attendance-sheet`         | Feuille d'appel d'une séance                                                                   | VIEW_ATTENDANCE, VIEW_ATTENDANCE_ANY, TAKE_ATTENDANCE, TAKE_ATTENDANCE_ANY, VIEW_ATTENDANCE_REPORTS |
| GET     | `/api/v1/attendance-sheets`                     | Feuilles d'appel (période, groupe, statut ; `mine` = mes cours)                                | VIEW_ATTENDANCE, VIEW_ATTENDANCE_ANY, TAKE_ATTENDANCE, TAKE_ATTENDANCE_ANY, VIEW_ATTENDANCE_REPORTS |
| GET     | `/api/v1/attendance-sheets/missing`             | Appels manquants : séances terminées sans feuille soumise                                      | VIEW_ATTENDANCE_ANY, TAKE_ATTENDANCE_ANY, VIEW_ATTENDANCE_REPORTS                                   |
| POST    | `/api/v1/attendance-sheets/lock`                | Verrouiller ou déverrouiller les feuilles d'une période                                        | EDIT_ATTENDANCE_LOCKED                                                                              |
| GET     | `/api/v1/attendance-sheets/:id`                 | Feuille d'appel avec ses enregistrements                                                       | VIEW_ATTENDANCE, VIEW_ATTENDANCE_ANY, TAKE_ATTENDANCE, TAKE_ATTENDANCE_ANY, VIEW_ATTENDANCE_REPORTS |
| PATCH   | `/api/v1/attendance-sheets/:id`                 | Enregistrer le brouillon (version optimiste ; 409 VERSION_CONFLICT sinon)                      | TAKE_ATTENDANCE, TAKE_ATTENDANCE_ANY                                                                |
| POST    | `/api/v1/attendance-sheets/:id/submit`          | Valider l'appel : enregistrements figés, événements, statistiques                              | TAKE_ATTENDANCE, TAKE_ATTENDANCE_ANY                                                                |
| PATCH   | `/api/v1/attendance-records/:id`                | Corriger un enregistrement soumis (motif obligatoire, ligne de révision)                       | EDIT_ATTENDANCE, EDIT_ATTENDANCE_LOCKED                                                             |
| GET     | `/api/v1/attendance-records/:id/revisions`      | Historique des corrections d'un enregistrement                                                 | VIEW_ATTENDANCE, VIEW_ATTENDANCE_ANY, TAKE_ATTENDANCE, TAKE_ATTENDANCE_ANY, VIEW_ATTENDANCE_REPORTS |
| GET     | `/api/v1/justifications`                        | File des justificatifs (plus anciens en premier)                                               | REVIEW_JUSTIFICATION, VIEW_ATTENDANCE_ANY, VIEW_ATTENDANCE_REPORTS                                  |
| POST    | `/api/v1/justifications`                        | Déposer un justificatif pour un élève sur un intervalle                                        | REVIEW_JUSTIFICATION, TAKE_ATTENDANCE_ANY                                                           |
| GET     | `/api/v1/justifications/:id`                    | Détail d'un justificatif et des enregistrements couverts                                       | REVIEW_JUSTIFICATION, VIEW_ATTENDANCE_ANY, VIEW_ATTENDANCE_REPORTS                                  |
| POST    | `/api/v1/justifications/:id/review`             | Accepter, refuser ou demander un complément                                                    | REVIEW_JUSTIFICATION                                                                                |
| GET     | `/api/v1/students/:id/attendance`               | Historique d'assiduité d'un élève                                                              | VIEW_ATTENDANCE_ANY, VIEW_ATTENDANCE_REPORTS, REVIEW_JUSTIFICATION                                  |
| GET     | `/api/v1/students/:id/attendance/summary`       | Résumé d'assiduité d'un élève sur une période (défaut : 30 jours)                              | VIEW_ATTENDANCE_ANY, VIEW_ATTENDANCE_REPORTS, REVIEW_JUSTIFICATION                                  |
| GET     | `/api/v1/attendance/watchlist`                  | Élèves à surveiller (seuil d’absences non justifiées atteint)                                  | VIEW_ATTENDANCE_ANY, VIEW_ATTENDANCE_REPORTS, REVIEW_JUSTIFICATION                                  |
| POST    | `/api/v1/attendance/alerts/:id/resolve`         | Clore une alerte (suivi effectué)                                                              | REVIEW_JUSTIFICATION, EDIT_ATTENDANCE_LOCKED                                                        |
| GET     | `/api/v1/dashboards/teacher`                    | Tableau de bord enseignant (séances du jour, appels, absences)                                 | TAKE_ATTENDANCE, VIEW_ATTENDANCE, TAKE_ATTENDANCE_ANY                                               |
| GET     | `/api/v1/dashboards/student-life`               | Tableau de bord vie scolaire (jour, justificatifs, surveillance, appels manquants)             | VIEW_ATTENDANCE_ANY, VIEW_ATTENDANCE_REPORTS                                                        |
| GET     | `/api/v1/me/children/summary`                   | Assiduité de mes enfants : aujourd'hui, 30 jours, alertes (un appel)                           | authentifié                                                                                         |
| GET     | `/api/v1/me/children/:studentId/attendance`     | Historique d'assiduité d'un enfant                                                             | authentifié                                                                                         |
| GET     | `/api/v1/me/children/:studentId/justifications` | Justificatifs déposés pour un enfant                                                           | authentifié                                                                                         |
| POST    | `/api/v1/me/children/:studentId/justifications` | Déposer un justificatif pour mon enfant (si l’établissement l’autorise et si j’en ai le droit) | authentifié                                                                                         |

### audit

| Méthode | Route                | Description                                  | Accès          |
| ------- | -------------------- | -------------------------------------------- | -------------- |
| GET     | `/api/v1/audit-logs` | Journal d'audit de l'établissement (curseur) | VIEW_AUDIT_LOG |

### billing

| Méthode | Route                                                            | Description                                                                                                        | Accès                  |
| ------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| GET     | `/api/v1/fee-categories`                                         | Catégories de frais                                                                                                | VIEW_FEES              |
| POST    | `/api/v1/fee-categories`                                         | Créer une catégorie                                                                                                | MANAGE_FEE_STRUCTURES  |
| PATCH   | `/api/v1/fee-categories/:id`                                     | Modifier une catégorie                                                                                             | MANAGE_FEE_STRUCTURES  |
| DELETE  | `/api/v1/fee-categories/:id`                                     | Supprimer une catégorie sans grille                                                                                | MANAGE_FEE_STRUCTURES  |
| GET     | `/api/v1/fee-structures`                                         | Grilles de frais de l'année (échéancier type, nombre d'élèves affectés)                                            | VIEW_FEES              |
| GET     | `/api/v1/fee-structures/:id`                                     | Détail d'une grille                                                                                                | VIEW_FEES              |
| POST    | `/api/v1/fee-structures`                                         | Créer une grille avec son échéancier (Σ échéances = total)                                                         | MANAGE_FEE_STRUCTURES  |
| PATCH   | `/api/v1/fee-structures/:id`                                     | Modifier une grille (l'échéancier d'une grille déjà affectée est figé)                                             | MANAGE_FEE_STRUCTURES  |
| DELETE  | `/api/v1/fee-structures/:id`                                     | Supprimer une grille sans créance                                                                                  | MANAGE_FEE_STRUCTURES  |
| POST    | `/api/v1/fees/assign`                                            | Affectation de masse : crée les créances manquantes pour la cible (classes, niveaux, élèves ou cible de la grille) | ASSIGN_FEES            |
| POST    | `/api/v1/fees/adjustments`                                       | Ajustement de créance (remise, bourse, exonération, pénalité, correction) — motif obligatoire                      | ADJUST_FEES            |
| POST    | `/api/v1/fees/integrity-check`                                   | Contrôle d'intégrité du grand-livre (stocké = recalculé, invariants d'allocation)                                  | VIEW_FINANCIAL_REPORTS |
| GET     | `/api/v1/students/:id/fees`                                      | Compte d'un élève : créances, échéances, paiements, crédits, ajustements, totaux                                   | VIEW_FEES              |
| POST    | `/api/v1/students/:id/fees`                                      | Affecter des grilles à un élève (nouvel inscrit)                                                                   | ASSIGN_FEES            |
| POST    | `/api/v1/students/:id/payments/manual`                           | Encaissement manuel (caisse) : paiement immuable, allocation, reçu numéroté — Idempotency-Key obligatoire          | RECORD_MANUAL_PAYMENT  |
| GET     | `/api/v1/payments`                                               | Paiements (journal de caisse : période, moyen, caissier, `mine`)                                                   | VIEW_PAYMENTS          |
| GET     | `/api/v1/payments/:id`                                           | Détail d'un paiement et de ses allocations                                                                         | VIEW_PAYMENTS          |
| POST    | `/api/v1/payments/:id/reverse`                                   | Annulation compensatoire (motif obligatoire) : contre-passation des allocations, reçu d’annulation                 | CANCEL_PAYMENT         |
| GET     | `/api/v1/payments/:id/receipt`                                   | Reçu d'un paiement (instantané figé, URL de vérification)                                                          | VIEW_PAYMENTS          |
| GET     | `/api/v1/payments/:id/receipt.pdf`                               | Reçu PDF                                                                                                           | VIEW_PAYMENTS          |
| GET     | `/api/v1/receipts/verify/:tenantCode/:number/:hash`              | Vérifier l'authenticité d'un reçu (public)                                                                         | public                 |
| GET     | `/api/v1/unpaid`                                                 | Échéances impayées (par élève, classe, grille ; les plus anciennes d’abord)                                        | VIEW_FEES              |
| GET     | `/api/v1/unpaid/by-group`                                        | Synthèse par classe : dû, payé, solde, retard, taux de recouvrement                                                | VIEW_FEES              |
| POST    | `/api/v1/unpaid/reminders`                                       | Rappel manuel aux tuteurs pour une sélection d’échéances (dédoublonné par jour)                                    | SEND_PAYMENT_REMINDER  |
| GET     | `/api/v1/exports/payments.csv`                                   | Journal des encaissements (CSV ;)                                                                                  | EXPORT_FINANCIAL_DATA  |
| GET     | `/api/v1/exports/aged-balance.csv`                               | Balance âgée par élève (CSV ;)                                                                                     | EXPORT_FINANCIAL_DATA  |
| GET     | `/api/v1/exports/unpaid.csv`                                     | Impayés par échéance (CSV ;)                                                                                       | EXPORT_FINANCIAL_DATA  |
| GET     | `/api/v1/dashboards/finance`                                     | Tableau de bord finance (année, caisse du jour, mois, à venir, par classe, intégrité)                              | VIEW_FINANCIAL_REPORTS |
| GET     | `/api/v1/me/children/finance`                                    | Frais de mes enfants : solde, prochaine échéance, paiements récents                                                | authentifié            |
| GET     | `/api/v1/me/children/:studentId/fees`                            | Compte complet d'un enfant                                                                                         | authentifié            |
| GET     | `/api/v1/me/children/:studentId/payments/:paymentId/receipt`     | Reçu d'un paiement de mon enfant                                                                                   | authentifié            |
| GET     | `/api/v1/me/children/:studentId/payments/:paymentId/receipt.pdf` | Reçu PDF d'un paiement de mon enfant                                                                               | authentifié            |

### identity

| Méthode | Route                                     | Description                                                                                                             | Accès          |
| ------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------- |
| POST    | `/api/v1/auth/login`                      | Connexion par identifiant et mot de passe (défi MFA si activée)                                                         | public         |
| POST    | `/api/v1/auth/mfa/verify`                 | Relever le défi MFA (code TOTP ou code de récupération) et ouvrir la session                                            | public         |
| POST    | `/api/v1/auth/otp/request`                | Demande d'un code OTP par SMS (réponse identique que le numéro existe ou non)                                           | public         |
| POST    | `/api/v1/auth/otp/verify`                 | Connexion par code OTP                                                                                                  | public         |
| POST    | `/api/v1/auth/refresh`                    | Rotation du refresh token (cookie web ou corps mobile)                                                                  | public         |
| POST    | `/api/v1/auth/switch-membership`          | Changer d'établissement actif                                                                                           | authentifié    |
| POST    | `/api/v1/auth/logout`                     | Déconnexion de cet appareil                                                                                             | public         |
| POST    | `/api/v1/auth/logout-all`                 | Déconnexion de tous les appareils                                                                                       | authentifié    |
| POST    | `/api/v1/auth/invitations/accept`         | Accepter une invitation et créer son mot de passe                                                                       | public         |
| GET     | `/api/v1/auth/.well-known/jwks.json`      | Clés publiques de vérification des JWT                                                                                  | public         |
| GET     | `/api/v1/me`                              | Profil, appartenances et permissions effectives                                                                         | identity       |
| GET     | `/api/v1/me/mfa`                          | État de la MFA du compte et de la session                                                                               | identity       |
| POST    | `/api/v1/me/mfa/setup`                    | Démarrer l’enrôlement MFA : secret provisoire (10 min) et URL otpauth                                                   | identity       |
| POST    | `/api/v1/me/mfa/enable`                   | Activer la MFA avec un premier code valide ; renvoie les codes de récupération (une seule fois)                         | identity       |
| POST    | `/api/v1/me/mfa/disable`                  | Désactiver la MFA (preuve par code TOTP ou code de récupération)                                                        | identity       |
| POST    | `/api/v1/me/mfa/recovery-codes`           | Régénérer les codes de récupération (les anciens sont invalidés)                                                        | identity       |
| GET     | `/api/v1/me/sessions`                     | Sessions actives (appareils)                                                                                            | identity       |
| DELETE  | `/api/v1/me/sessions/:familyId`           | Révoquer une session                                                                                                    | identity       |
| GET     | `/api/v1/roles`                           | Rôles de l'établissement                                                                                                | MANAGE_USERS   |
| GET     | `/api/v1/roles/:id`                       | Détail d’un rôle                                                                                                        | MANAGE_USERS   |
| PATCH   | `/api/v1/roles/:id/permissions`           | Remplacer les permissions d'un rôle                                                                                     | MANAGE_ROLES   |
| POST    | `/api/v1/roles/:id/duplicate`             | Dupliquer un rôle                                                                                                       | MANAGE_ROLES   |
| GET     | `/api/v1/members`                         | Membres du personnel et leurs rôles                                                                                     | MANAGE_USERS   |
| PUT     | `/api/v1/members/:membershipId/roles`     | Remplacer les rôles d'un membre                                                                                         | MANAGE_ROLES   |
| POST    | `/api/v1/members/invitations`             | Inviter un membre du personnel                                                                                          | MANAGE_USERS   |
| POST    | `/api/v1/members/:membershipId/mfa-reset` | Réinitialiser la MFA d'un membre (téléphone perdu, plus de code de récupération) : sessions révoquées, motif journalisé | RESET_USER_MFA |

### launch

| Méthode | Route                                           | Description                                                                                           | Accès                                         |
| ------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| GET     | `/api/v1/platform/tenants/:id/launch`           | Préparation à la mise en production : assistant, MFA, provider, SMS, alertes, checklist               | PLATFORM_MANAGE_TENANTS                       |
| PATCH   | `/api/v1/platform/tenants/:id/launch/checklist` | Cocher les points humains (contrat, budget SMS, astreinte, données validées)                          | PLATFORM_MANAGE_TENANTS                       |
| POST    | `/api/v1/platform/tenants/:id/launch/go-live`   | Basculer en production (409 tant qu’un point bloquant manque) : statut ACTIVE, offre, hypercare       | PLATFORM_MANAGE_TENANTS                       |
| GET     | `/api/v1/platform/adoption`                     | Adoption du parc : activation des parents, appels soumis, paiement en ligne, SMS, par établissement   | PLATFORM_VIEW_METRICS                         |
| GET     | `/api/v1/platform/reviews`                      | Revues quotidiennes (hypercare), la plus récente en premier                                           | PLATFORM_VIEW_METRICS                         |
| POST    | `/api/v1/platform/reviews/generate`             | Générer (ou régénérer) la revue du jour maintenant                                                    | PLATFORM_VIEW_METRICS                         |
| GET     | `/api/v1/platform/reviews/:day`                 | Une revue                                                                                             | PLATFORM_VIEW_METRICS                         |
| POST    | `/api/v1/platform/reviews/:day/ack`             | Acquitter la revue (lue, actions décidées)                                                            | PLATFORM_VIEW_METRICS                         |
| GET     | `/api/v1/platform/availability`                 | Disponibilité mesurée (sondes internes) sur N jours, objectif G8 ≥ 99,5 %                             | PLATFORM_VIEW_METRICS                         |
| POST    | `/api/v1/platform/availability/probe`           | Lancer une sonde maintenant (le worker en lance une par minute)                                       | PLATFORM_VIEW_METRICS                         |
| GET     | `/api/v1/status`                                | État public du service (disponibilité 30 jours)                                                       | public                                        |
| GET     | `/api/v1/platform/usage/export.csv`             | Consommation mensuelle en CSV (facturation manuelle)                                                  | PLATFORM_VIEW_METRICS                         |
| GET     | `/api/v1/platform/usage`                        | Consommation mensuelle par établissement (mois courant par défaut)                                    | PLATFORM_VIEW_METRICS                         |
| POST    | `/api/v1/platform/usage/snapshot`               | Recalculer l’instantané du mois courant pour tous les établissements                                  | PLATFORM_VIEW_METRICS                         |
| GET     | `/api/v1/platform/support/lookup`               | Retrouver une personne (e-mail, téléphone, nom) et son état de connexion dans tous les établissements | PLATFORM_MANAGE_TENANTS, PLATFORM_IMPERSONATE |
| POST    | `/api/v1/platform/support/unlock`               | Lever le verrouillage anti-force-brute d’un identifiant                                               | PLATFORM_MANAGE_TENANTS, PLATFORM_IMPERSONATE |
| POST    | `/api/v1/platform/support/users/:id/mfa-reset`  | Réinitialiser la MFA d’un utilisateur (identité vérifiée) : sessions révoquées, motif journalisé      | PLATFORM_IMPERSONATE                          |

### notifications

| Méthode | Route                                  | Description                                                        | Accès                                  |
| ------- | -------------------------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| GET     | `/api/v1/me/notifications`             | Mes notifications (in-app) avec le nombre de non lues              | authentifié                            |
| POST    | `/api/v1/me/notifications/read-all`    | Tout marquer comme lu                                              | authentifié                            |
| POST    | `/api/v1/me/notifications/:id/read`    | Marquer une notification comme lue                                 | authentifié                            |
| GET     | `/api/v1/me/notifications/preferences` | Mes canaux par type de notification                                | authentifié                            |
| PUT     | `/api/v1/me/notifications/preferences` | Modifier mes canaux par type de notification                       | authentifié                            |
| GET     | `/api/v1/notifications`                | Journal des notifications (par élève, destinataire, canal, statut) | MANAGE_TENANT_SETTINGS, VIEW_AUDIT_LOG |
| GET     | `/api/v1/notifications/usage`          | Consommation SMS du mois et plafond                                | MANAGE_TENANT_SETTINGS, VIEW_AUDIT_LOG |
| POST    | `/api/v1/notifications/:id/resend`     | Renvoyer une notification échouée ou suspendue                     | MANAGE_TENANT_SETTINGS                 |

### payments

| Méthode | Route                                                                | Description                                                                                 | Accès                                   |
| ------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------- |
| GET     | `/api/v1/me/children/:studentId/payment-options`                     | Puis-je payer en ligne pour cet enfant ? (provider, bornes de montant)                      | authentifié                             |
| POST    | `/api/v1/me/children/:studentId/payment-attempts`                    | Démarrer un paiement en ligne (tentative → URL ou widget du provider)                       | authentifié                             |
| GET     | `/api/v1/me/children/:studentId/payment-attempts`                    | Mes tentatives de paiement récentes pour cet enfant                                         | authentifié                             |
| GET     | `/api/v1/me/children/:studentId/payment-attempts/:attemptId`         | État d'une tentative (polling après retour du provider)                                     | authentifié                             |
| POST    | `/api/v1/me/children/:studentId/payment-attempts/:attemptId/confirm` | Retour du provider : déclenche la vérification serveur-à-serveur                            | authentifié                             |
| GET     | `/api/v1/payment-attempts`                                           | Tentatives de paiement en ligne (filtres statut, élève, revue, période)                     | VIEW_PAYMENTS                           |
| GET     | `/api/v1/payment-attempts/pending`                                   | Transactions en attente : revues ouvertes, en attente anciennes, orphelines, santé provider | VIEW_PAYMENTS                           |
| GET     | `/api/v1/payment-attempts/:id`                                       | Chronologie d'une tentative (initiate, webhooks, verify, paiement, audit)                   | VIEW_PAYMENTS                           |
| POST    | `/api/v1/payment-attempts/:id/reverify`                              | Re-vérifier auprès du provider (UNKNOWN redevient vérifiable)                               | CANCEL_PAYMENT, MANAGE_PAYMENT_PROVIDER |
| POST    | `/api/v1/payment-attempts/:id/resolve`                               | Marquer une tentative en revue comme résolue (motif, audité)                                | CANCEL_PAYMENT, MANAGE_PAYMENT_PROVIDER |
| GET     | `/api/v1/payment-reconciliation`                                     | Réconciliations quotidiennes provider ↔ Polaris                                             | VIEW_FINANCIAL_REPORTS                  |
| POST    | `/api/v1/payment-reconciliation/run`                                 | Lancer la réconciliation d’une journée (défaut : hier)                                      | CANCEL_PAYMENT, MANAGE_PAYMENT_PROVIDER |
| POST    | `/api/v1/payment-reconciliation/:id/orphans/resolve`                 | Marquer une transaction orpheline comme traitée (motif)                                     | CANCEL_PAYMENT, MANAGE_PAYMENT_PROVIDER |
| GET     | `/api/v1/payment-config`                                             | Comptes marchands configurés (clés masquées, URL de webhook)                                | MANAGE_PAYMENT_PROVIDER                 |
| PUT     | `/api/v1/payment-config`                                             | Créer ou mettre à jour la configuration d’un provider (secrets chiffrés ; re-test requis)   | MANAGE_PAYMENT_PROVIDER                 |
| POST    | `/api/v1/payment-config/:provider/test`                              | Tester la connexion avec les clés enregistrées ; succès → provider actif                    | MANAGE_PAYMENT_PROVIDER                 |
| PATCH   | `/api/v1/payment-config/:provider/status`                            | Activer ou désactiver un provider                                                           | MANAGE_PAYMENT_PROVIDER                 |
| POST    | `/api/v1/webhooks/payments/:provider/:token`                         | Webhook provider (signature vérifiée, unicité, mise en file ; 200 en < 200 ms)              | public                                  |
| GET     | `/api/v1/dev/fake-provider/transactions/:externalId`                 | [Démo] Transaction de la caisse factice                                                     | public                                  |
| POST    | `/api/v1/dev/fake-provider/transactions/:externalId/complete`        | [Démo] Le parent paie / échoue / annule : poste le webhook signé                            | public                                  |
| POST    | `/api/v1/dev/fake-provider/outage`                                   | [Démo] Simuler une panne du provider de démonstration                                       | MANAGE_PAYMENT_PROVIDER                 |

### platform

| Méthode | Route                                            | Description                                                                                  | Accès                                       |
| ------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| GET     | `/api/v1/platform/tenants`                       | Lister les établissements                                                                    | PLATFORM_MANAGE_TENANTS                     |
| POST    | `/api/v1/platform/tenants`                       | Créer un établissement (rôles système copiés, invitation admin optionnelle)                  | PLATFORM_MANAGE_TENANTS                     |
| PATCH   | `/api/v1/platform/tenants/:id/status`            | Activer / suspendre un établissement                                                         | PLATFORM_MANAGE_TENANTS                     |
| POST    | `/api/v1/platform/tenants/:id/admin-invitations` | Inviter un administrateur d'établissement                                                    | PLATFORM_MANAGE_TENANTS                     |
| POST    | `/api/v1/platform/tenants/:id/impersonate`       | Ouvrir une session de support dans un établissement (30 min, tracée, sans action financière) | PLATFORM_IMPERSONATE                        |
| GET     | `/api/v1/platform/impersonations`                | Sessions de support (100 dernières)                                                          | PLATFORM_IMPERSONATE, PLATFORM_VIEW_METRICS |
| POST    | `/api/v1/platform/impersonations/:id/end`        | Clôturer une session de support (effectif en moins de 30 s)                                  | PLATFORM_IMPERSONATE                        |

### reporting

| Méthode | Route                                 | Description                                                                               | Accès                                                         |
| ------- | ------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| GET     | `/api/v1/reports`                     | Catalogue des rapports accessibles (8 rapports MVP)                                       | VIEW_REPORTS, VIEW_ATTENDANCE_REPORTS, VIEW_FINANCIAL_REPORTS |
| POST    | `/api/v1/reports/refresh`             | Rafraîchir les agrégats (derniers jours ; `full` = depuis le début de l’année)            | VIEW_REPORTS, VIEW_FINANCIAL_REPORTS, VIEW_ATTENDANCE_REPORTS |
| GET     | `/api/v1/reports/:key.csv`            | Exporter un rapport en CSV                                                                | VIEW_REPORTS, VIEW_ATTENDANCE_REPORTS, VIEW_FINANCIAL_REPORTS |
| GET     | `/api/v1/reports/:key`                | Exécuter un rapport (aperçu JSON, 5 000 lignes max.)                                      | VIEW_REPORTS, VIEW_ATTENDANCE_REPORTS, VIEW_FINANCIAL_REPORTS |
| GET     | `/api/v1/dashboards/direction`        | Tableau de bord de direction : KPI synthétiques et tendances                              | VIEW_REPORTS                                                  |
| GET     | `/api/v1/dashboards/pedagogy`         | Tableau de bord pédagogique : taux par classe, élèves à risque, appels non réalisés       | VIEW_ATTENDANCE_REPORTS                                       |
| GET     | `/api/v1/dashboards/finance/channels` | Encaissements par canal et par provider, tentatives en ligne                              | VIEW_FINANCIAL_REPORTS                                        |
| GET     | `/api/v1/trace/sheets/:id`            | Traçabilité d'une feuille d'appel : séance, soumission, corrections, notifications, audit | VIEW_ATTENDANCE_ANY, VIEW_ATTENDANCE_REPORTS, VIEW_AUDIT_LOG  |
| GET     | `/api/v1/trace/notifications/:id`     | Traçabilité d'une notification : événement source, rendu, envois, préférences             | MANAGE_TENANT_SETTINGS, VIEW_AUDIT_LOG                        |
| GET     | `/api/v1/scheduled-reports`           | Rapports planifiés par e-mail                                                             | VIEW_REPORTS                                                  |
| POST    | `/api/v1/scheduled-reports`           | Planifier un rapport (hebdomadaire ou mensuel) vers des destinataires                     | VIEW_REPORTS                                                  |
| PATCH   | `/api/v1/scheduled-reports/:id`       | Modifier ou suspendre un rapport planifié                                                 | VIEW_REPORTS                                                  |
| DELETE  | `/api/v1/scheduled-reports/:id`       | Supprimer un rapport planifié                                                             | VIEW_REPORTS                                                  |
| POST    | `/api/v1/scheduled-reports/:id/send`  | Envoyer maintenant                                                                        | VIEW_REPORTS                                                  |
| GET     | `/api/v1/tenant-exports`              | Exports complets de l’établissement (20 derniers)                                         | MANAGE_TENANT_SETTINGS                                        |
| POST    | `/api/v1/tenant-exports`              | Demander un export complet (archive ZIP de CSV, construite par le worker)                 | MANAGE_TENANT_SETTINGS                                        |
| GET     | `/api/v1/tenant-exports/:id`          | État d’un export                                                                          | MANAGE_TENANT_SETTINGS                                        |
| GET     | `/api/v1/tenant-exports/:id/download` | Télécharger l’archive                                                                     | MANAGE_TENANT_SETTINGS                                        |
| GET     | `/api/v1/platform/overview`           | Vue Super Admin : parc, volumétrie, paiements 24 h, santé, erreurs, par établissement     | PLATFORM_VIEW_METRICS                                         |
| GET     | `/api/v1/platform/alerts`             | Alertes de supervision (ouvertes par défaut)                                              | PLATFORM_VIEW_METRICS                                         |
| POST    | `/api/v1/platform/alerts/evaluate`    | Évaluer les conditions maintenant (le worker le fait toutes les 5 minutes)                | PLATFORM_VIEW_METRICS                                         |
| POST    | `/api/v1/platform/alerts/:id/ack`     | Acquitter une alerte (plus de rappel e-mail tant qu’elle reste ouverte)                   | PLATFORM_VIEW_METRICS                                         |

### students-guardians

| Méthode | Route                                     | Description                                                                                               | Accès                  |
| ------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------- |
| GET     | `/api/v1/guardians`                       | Tuteurs (recherche nom/téléphone, activés ou non)                                                         | VIEW_STUDENTS          |
| GET     | `/api/v1/guardians/:id`                   | Fiche tuteur avec ses enfants                                                                             | VIEW_STUDENTS          |
| POST    | `/api/v1/guardians`                       | Créer un tuteur (409 si le téléphone existe déjà)                                                         | MANAGE_GUARDIANS       |
| PATCH   | `/api/v1/guardians/:id`                   | Modifier un tuteur                                                                                        | MANAGE_GUARDIANS       |
| POST    | `/api/v1/guardians/:id/invite`            | Inviter le tuteur : crée son accès parent et envoie le SMS d'accueil                                      | MANAGE_GUARDIANS       |
| PATCH   | `/api/v1/student-guardians/:id`           | Modifier un lien parent-enfant (relation, principal, droits)                                              | LINK_GUARDIAN          |
| DELETE  | `/api/v1/student-guardians/:id`           | Détacher un tuteur (motif obligatoire, historisé)                                                         | LINK_GUARDIAN          |
| GET     | `/api/v1/me/children`                     | Mes enfants (vue parent) avec les droits de chaque lien                                                   | authentifié            |
| POST    | `/api/v1/imports/students`                | Importer des élèves (CSV ; dryRun=true par défaut : rapport sans écriture)                                | IMPORT_STUDENTS        |
| POST    | `/api/v1/imports/guardians`               | Importer des tuteurs et leurs rattachements (CSV ; dryRun=true par défaut)                                | IMPORT_STUDENTS        |
| GET     | `/api/v1/imports/:id`                     | Rapport d'un import                                                                                       | IMPORT_STUDENTS        |
| GET     | `/api/v1/dashboards/registrar`            | Tableau de bord scolarité (effectifs, fiches incomplètes, imports récents)                                | VIEW_STUDENTS          |
| GET     | `/api/v1/dashboards/admin`                | Tableau de bord administrateur (volumes, alertes de configuration)                                        | MANAGE_TENANT_SETTINGS |
| GET     | `/api/v1/privacy/requests`                | Registre des demandes (exports, anonymisations, rétention automatique)                                    | MANAGE_PRIVACY         |
| GET     | `/api/v1/privacy/students/:id`            | Export des données personnelles d'un élève (toutes sections)                                              | MANAGE_PRIVACY         |
| POST    | `/api/v1/privacy/students/:id/anonymize`  | Anonymiser un élève parti (identité, notes, justificatifs, notifications ; pièces financières conservées) | MANAGE_PRIVACY         |
| GET     | `/api/v1/privacy/guardians/:id`           | Export des données personnelles d'un tuteur                                                               | MANAGE_PRIVACY         |
| POST    | `/api/v1/privacy/guardians/:id/anonymize` | Anonymiser un tuteur sans enfant rattaché (compte désactivé)                                              | MANAGE_PRIVACY         |
| GET     | `/api/v1/me/personal-data`                | Export de mes données personnelles (parent)                                                               | authentifié            |
| GET     | `/api/v1/students`                        | Élèves (recherche, classe, statut, fiches incomplètes)                                                    | VIEW_STUDENTS          |
| GET     | `/api/v1/students/:id`                    | Fiche élève avec historique d'inscriptions                                                                | VIEW_STUDENTS          |
| POST    | `/api/v1/students`                        | Créer un élève (matricule généré si absent, inscription immédiate possible)                               | CREATE_STUDENT         |
| PATCH   | `/api/v1/students/:id`                    | Modifier un élève                                                                                         | EDIT_STUDENT           |
| POST    | `/api/v1/students/:id/enrollments`        | Inscrire dans une classe ou un sous-groupe                                                                | MANAGE_ENROLLMENTS     |
| POST    | `/api/v1/students/:id/transfer`           | Transférer vers une autre classe (clôture l'inscription courante et ses sous-groupes)                     | MANAGE_ENROLLMENTS     |
| POST    | `/api/v1/students/:id/leave`              | Départ ou diplomation : clôt toutes les inscriptions actives                                              | MANAGE_ENROLLMENTS     |
| GET     | `/api/v1/students/:id/guardians`          | Tuteurs d'un élève                                                                                        | VIEW_STUDENTS          |
| POST    | `/api/v1/students/:id/guardians`          | Rattacher un tuteur (existant ou créé à la volée)                                                         | LINK_GUARDIAN          |
| POST    | `/api/v1/enrollments/:id/close`           | Clore une inscription (sortie de classe ou de sous-groupe)                                                | MANAGE_ENROLLMENTS     |

### tenancy

| Méthode | Route                     | Description                                                                          | Accès                                                                                              |
| ------- | ------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| GET     | `/api/v1/onboarding`      | Assistant de démarrage : étapes réalisées et restantes, calculées depuis les données | MANAGE_TENANT_SETTINGS, MANAGE_ACADEMIC_STRUCTURE, MANAGE_USERS, IMPORT_STUDENTS, MANAGE_SCHEDULES |
| PATCH   | `/api/v1/onboarding`      | Masquer ou réafficher l’assistant de démarrage                                       | MANAGE_TENANT_SETTINGS                                                                             |
| GET     | `/api/v1/tenant`          | Établissement courant                                                                | authentifié                                                                                        |
| PATCH   | `/api/v1/tenant/settings` | Modifier les paramètres de l'établissement                                           | MANAGE_TENANT_SETTINGS                                                                             |
