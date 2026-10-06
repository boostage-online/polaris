# Passation — Phase 2 (académique, élèves, parents)

Branche `feat/phase-2-academique`, empilée sur `feat/phase-1-socle` (PR #2 → PR #1). Backlog de référence : `docs/backlog/phase-2-academique.md` ; ADR mises en œuvre : 0004 (modèle académique), 0007 (RBAC et portées).

## Ce qui est livré

**Base (migration `0002_academique_eleves`)** — 14 tables tenant, toutes sous RLS avec clé composite `(tenant_id, id)` : `programs`, `levels`, `groups` (CLASS / SUBGROUP via `parent_group_id`, capacité), `subjects`, `staff_profiles`, `course_offerings`, `course_teachers`, `schedule_slots`, `sessions`, `students`, `enrollments`, `guardians`, `student_guardians`, `import_jobs`. Fonction `unaccent_lite()` et index trigram pour la recherche de noms. Index partiels : une inscription CLASS active par élève et par année, une seule inscription active par groupe, un lien actif par couple élève-tuteur.

**Module `academic`** (couche 2)

- Années académiques (une seule courante), périodes, programmes et niveaux (programme par défaut pour les écoles), groupes et sous-groupes, matières.
- Personnel : `staff_profiles` créé à la demande pour un membre STAFF ; drapeau `is_teacher` qui conditionne l'affectation aux cours.
- Cours = matière × groupe × année (× période), enseignants MAIN/ASSISTANT, créneaux hebdomadaires. Les chevauchements (même enseignant, même groupe, même salle) sont **signalés** dans `meta.warnings`, jamais bloqués : les emplois du temps réels en ont.
- Séances : génération idempotente depuis les créneaux (`ON CONFLICT DO NOTHING`, horizon 14 jours, cron quotidien `SchedulesService` du worker à 02:30 Africa/Porto-Novo, aussi à la demande via `POST /sessions/generate`), séances ponctuelles, déplacement, annulation motivée. `GET /me/schedule` : l'enseignant ne voit que ses cours, une portée globale (`VIEW_ATTENDANCE_ANY`, `TAKE_ATTENDANCE_ANY`, `MANAGE_SCHEDULES`) voit tout (`SchedulePolicy`).

**Module `students-guardians`** (couche 2)

- Élèves : matricule `{année}-{séquence}` généré si absent, recherche nom/matricule, filtres classe/statut/fiches incomplètes, fiche avec historique d'inscriptions et nombre de tuteurs.
- Inscriptions historisées : inscription (capacité respectée), transfert (clôture de la classe et de ses sous-groupes, nouvelle ligne), clôture d'un sous-groupe, départ/diplomation (toutes inscriptions clôturées, plus d'inscription possible).
- Tuteurs : le **téléphone E.164 est l'identité** du parent (unique par tenant ; un numéro béninois à 8 chiffres est normalisé en `+22901…`). Invitation = création du compte utilisateur par téléphone + appartenance GUARDIAN + SMS ; l'activation réelle est la première connexion OTP (Phase 1).
- Liens parent-enfant : relation, principal, quatre droits (`can_view_attendance`, `can_view_finance`, `can_pay`, `can_justify`), jamais supprimés, seulement déliés avec motif ; événements `GuardianLinked` / `GuardianUnlinked` dans l'outbox. `GET /me/children` et `GuardianService.assertGuardianAccess(studentId, droit)` sont la garde de portée que les modules assiduité et finance réutiliseront (404, jamais 403, pour un enfant non lié).
- Imports CSV élèves (avec classe) et tuteurs (avec rattachement) : séparateur détecté, en-têtes tolérants, **simulation par défaut** (`dryRun=true`) avec rapport ligne par ligne (OK / WARNING / ERROR), doublons probables signalés, savepoint par ligne, 5 000 lignes maximum (synchrones ; le passage en job asynchrone est prévu quand le volume le justifiera).
- Tableaux de bord : scolarité (effectifs, sans classe, sans tuteur, fiches incomplètes, parents activés, imports récents) et administrateur (volumes, alertes : cours sans enseignant ou sans créneau, classes vides ou au-dessus de la capacité, enseignants sans cours, pas d'année courante).

**Web** — coque applicative avec navigation filtrée par permissions et type d'appartenance ; écrans : tableau de bord par profil, structure académique (4 onglets), personnel, cours (enseignants, créneaux, séances), planning, « mon emploi du temps », élèves (liste, création, fiche complète), tuteurs (liste, fiche, invitation), import en deux temps, « mes enfants » (parent).

**Seed** — par établissement : programme, niveaux 6e/5e, classes 6e A (capacité 40) et 6e B, sous-groupe, matières MATH/FR, profils enseignant/admin, cours Maths 6e A (lundi 08:00–10:00) et Français 6e A (sans enseignant, volontairement), 5 élèves (dont un parti), 2 tuteurs, compte parent `parent@<code>.local` (mot de passe de démo).

## Permissions et routes

59 routes nouvelles, toutes dans `test/permissions-matrix.yaml`. Résumé : lecture (`VIEW_STUDENTS`) pour tous les rôles système ; structure, cours, personnel et tableau de bord administrateur réservés à `ADMIN` (`MANAGE_ACADEMIC_STRUCTURE`, `MANAGE_SCHEDULES`, `MANAGE_USERS`, `MANAGE_TENANT_SETTINGS`) ; élèves, inscriptions, tuteurs, liens et imports pour `ADMIN` et `REGISTRAR`. `GET /me/schedule` et `GET /me/children` sont ouverts à tout utilisateur authentifié, la portée étant assurée par les policies.

Le test d'isolation inter-tenant utilise désormais des **identifiants réels du tenant A** par famille de route (année, programme, niveau, groupe, matière, cours, créneau, séance, élève, inscription, tuteur, lien, import) et des corps valides, afin que le 404 attendu soit celui de la recherche et non celui de la validation.

## Décisions d'implémentation à connaître

- `PermissionGuard` résout les permissions pour **toute** requête authentifiée (`actor.permissions`), même sans `@RequirePermission` : les policies de portée s'en servent.
- `GET /me/sessions` (sessions de connexion, Phase 1) et l'emploi du temps ne partagent pas la même route : l'emploi du temps est `GET /me/schedule`.
- `POST /guardians/:id/invite` est `@NoTransaction()` (SMS après commit) et limité à 60 par tenant et par heure.
- Les booléens en query string passent par `QueryBoolSchema` (`"false"` doit valoir faux ; `z.coerce.boolean()` ne convient pas).
- Le plafond global de rate limiting est configurable (`RATE_LIMIT_GLOBAL_PER_MINUTE`, 300 par défaut) ; les tests le relèvent car la matrice joue chaque route pour chaque rôle.
- Hors production, les réponses 500 portent le message d'erreur dans `detail` (diagnostic en CI et en développement).
- Le serveur de test écoute réellement (`app.listen(0)`) : supertest ne gère pas son cycle de vie.

## Non couvert dans cette phase (reporté)

- E1-S06 campus (le champ existe, pas d'écran), E1-S07 reconduction d'une année, E2-S02 invitation du personnel depuis l'écran Personnel (passe par la gestion des accès Phase 1), E5-S01 upload par URL présignée et import asynchrone, E5-S05 fusion de doublons, E6-S03 assistant de première configuration, E7 (reliquat Phase 1 : Super Admin, MFA, sessions actives).
- Photo d'élève (`photo_key` prévu, pas de stockage objet encore).

## État de vérification (CI GitHub Actions, PR #2)

**CI verte** au commit `8c2733a` (7 octobre 2026) : lint type-checked, typecheck (api, web, contrats), frontières de modules, garde-fou et migrations up → down → up, tests unitaires, **71 tests d'intégration** sur PostgreSQL/Redis réels (dont 31 nouveaux : académique, élèves, tuteurs, imports, matrice et isolation étendues), génération OpenAPI.

Corrections apportées pendant la boucle (le code est écrit sans accès au registre npm, la première exécution a lieu en CI) :

| Problème rencontré                                                                                        | Correction                                                                 |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Matrice de permissions (80 routes × 7 rôles) au-delà du plafond global de rate limiting → 429             | plafond configurable `RATE_LIMIT_GLOBAL_PER_MINUTE`, relevé dans les tests |
| `z.coerce.boolean()` prend `"false"` pour vrai (`dryRun`, `incomplete`, `activated`)                      | `QueryBoolSchema` dans les contrats                                        |
| Drizzle rend les colonnes sans préfixe dans une requête mono-table → `"id"` ambigu en sous-requête        | références qualifiées en clair (`students.id`) dans les corrélées          |
| supertest ferme/rouvre le serveur entre deux requêtes → `address of null` sporadique                      | le serveur de test écoute (`app.listen(0)`)                                |
| `GET /academic-years/:id/terms` et `GET /students/:id/guardians` répondaient 200 (liste vide) hors tenant | vérification d'existence du parent → 404                                   |
| Numéros béninois à 10 chiffres (`01…`) mal normalisés                                                     | règle explicite 8 / 10 chiffres et ancien format `+229` + 8 chiffres       |
| Deux `SessionSchema` exportés par les contrats (connexion vs séance)                                      | la séance devient `ClassSessionSchema`                                     |

## Prochaines étapes

1. Fusion de #1 puis #2 dans `main` ; déploiement staging (hébergement à décider, cf. Phase 1).
2. Ateliers pilotes : charger les exports réels via l'écran Imports (simulation d'abord), corriger les classes manquantes, inviter les parents.
3. Phase 3 — assiduité (`docs/backlog/phase-3-assiduite.md`) : feuilles d'appel sur les `sessions`, portée enseignant via `SchedulePolicy`, portée parent via `assertGuardianAccess`.
