# Phase 2 — Académique, élèves, parents

**Fenêtre** : 7 déc 2026 → 15 jan 2027 (6 semaines dont fêtes ≈ 2 sprints utiles). **Objectif** : les deux pilotes ont leur structure, leurs élèves, leurs parents et leurs séances dans le système. **Porte G2** : 100 % des élèves et ≥ 80 % des parents des pilotes importés sans intervention en base ; chaque enseignant pilote voit ses séances de la semaine ; aucun élève visible par un parent non lié (test automatisé).

**ADR mises en œuvre** : 0004, 0007. **Prérequis** : G1 ; exports réels des pilotes (Phase 0).

| Epic | Titre                                             | Points  | Must |
| ---- | ------------------------------------------------- | ------- | ---- |
| E1   | Structure académique                              | 23      | ✔    |
| E2   | Enseignants, cours, emplois du temps, séances     | 26      | ✔    |
| E3   | Élèves et inscriptions                            | 24      | ✔    |
| E4   | Tuteurs et liens parent-enfant                    | 26      | ✔    |
| E5   | Imports CSV et qualité des données                | 21      | ✔    |
| E6   | Dashboards scolarité et administrateur            | 13      | S    |
| E7   | Reliquat Phase 1 (E10 Super Admin, MFA, sessions) | 18      | S    |
|      | **Total**                                         | **151** |      |

Capacité ≈ 4 semaines utiles × 25 ≈ 100 pts : E6 et E7 sont les variables d'ajustement ; E5-S05 (fusion de doublons) peut glisser en V1 si la détection seule suffit aux pilotes.

---

## E1 — Structure académique

| ID        | Story                                                                                                                                    | Critères d'acceptation                                                                                                   | Pts | Prio |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --- | ---- |
| P2-E1-S01 | [Tech] Tables `programs`, `levels`, `groups` (CLASS/SUBGROUP, `parent_group_id`), `subjects`, contraintes d'unicité scopées, soft delete | Migrations via le helper RLS ; tests de contraintes                                                                      | 5   | M    |
| P2-E1-S02 | En tant qu'administrateur, je veux gérer les années académiques et périodes afin de cadrer les inscriptions et séances                   | CRUD ; une seule année courante ; dates cohérentes ; clôture d'une année interdite s'il reste des feuilles d'appel DRAFT | 3   | M    |
| P2-E1-S03 | En tant qu'administrateur d'école, je veux créer mes classes par niveau sans voir la notion de programme                                 | Programme par défaut créé automatiquement ; terminologie « Classe/Matière/Élève » appliquée par `tenant.type`            | 3   | M    |
| P2-E1-S04 | En tant qu'administrateur d'université, je veux créer programmes, niveaux, promotions et groupes de TD rattachés                         | `SUBGROUP` avec `parent_group_id` ; vue arborescente                                                                     | 5   | M    |
| P2-E1-S05 | En tant qu'administrateur, je veux gérer les matières/UE et les associer à des niveaux                                                   | CRUD, code unique, désactivation sans suppression si des cours existent                                                  | 3   | M    |
| P2-E1-S06 | En tant qu'administrateur, je veux gérer les campus et rattacher des groupes                                                             | CRUD ; portée de rôle par campus prise en compte par les policies                                                        | 2   | S    |
| P2-E1-S07 | En tant qu'administrateur, je veux reconduire la structure d'une année sur la suivante                                                   | Copie des programmes/niveaux/groupes/matières sans les inscriptions ; aperçu avant validation                            | 2   | C    |

## E2 — Enseignants, cours, emplois du temps, séances

| ID        | Story                                                                                                                            | Critères d'acceptation                                                                                     | Pts | Prio |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --- | ---- |
| P2-E2-S01 | [Tech] Tables `staff_profiles`, `course_offerings`, `course_teachers`, `schedule_slots`, `sessions`                              | Contraintes ADR-0004 ; index `(tenant_id, starts_at)`                                                      | 5   | M    |
| P2-E2-S02 | En tant qu'administrateur, je veux inviter un membre du personnel et le marquer enseignant                                       | Invitation e-mail/SMS avec code à usage unique ; `staff_profile` créé ; rôle Enseignant par défaut         | 3   | M    |
| P2-E2-S03 | En tant qu'administrateur, je veux créer un cours (matière × groupe × année/période) et lui affecter un ou plusieurs enseignants | Co-enseignement MAIN/ASSISTANT ; unicité du cours                                                          | 3   | M    |
| P2-E2-S04 | En tant qu'administrateur, je veux saisir l'emploi du temps récurrent d'un cours (jour, heure, salle, validité)                  | Détection de chevauchement pour un même groupe ou enseignant (avertissement, pas blocage)                  | 5   | M    |
| P2-E2-S05 | [Tech] Génération idempotente des séances 14 jours à l'avance (cron) et à la demande                                             | `UNIQUE (course_offering_id, starts_at)` ; relance sans doublon ; prise en compte de `valid_from/valid_to` | 5   | M    |
| P2-E2-S06 | En tant qu'administrateur ou enseignant autorisé, je veux créer, déplacer ou annuler une séance ponctuelle                       | Annulation impossible si feuille SUBMITTED ; audit                                                         | 3   | M    |
| P2-E2-S07 | En tant qu'enseignant, je veux voir mes séances de la semaine afin de préparer mes appels                                        | `GET /me/sessions?from&to` ; filtré par `course_teachers` ; p95 < 300 ms                                   | 2   | M    |

## E3 — Élèves et inscriptions

| ID        | Story                                                                                                                                  | Critères d'acceptation                                                                         | Pts | Prio |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --- | ---- |
| P2-E3-S01 | [Tech] Tables `students`, `enrollments` ; index partiel unique « une inscription CLASS active par élève et année » ; recherche trigram | Tests de contrainte ; recherche sur 3 000 élèves < 100 ms                                      | 5   | M    |
| P2-E3-S02 | En tant que scolarité, je veux créer et modifier une fiche élève (matricule, identité, photo optionnelle)                              | Matricule unique par tenant, généré ou saisi ; photo via URL présignée ; `EDIT_STUDENT` audité | 5   | M    |
| P2-E3-S03 | En tant que scolarité, je veux inscrire un élève dans une classe et des sous-groupes pour l'année courante                             | Une seule CLASS active ; plusieurs SUBGROUP ; date d'entrée                                    | 3   | M    |
| P2-E3-S04 | En tant que scolarité, je veux changer un élève de classe en conservant l'historique                                                   | Clôture `left_at` + nouvelle inscription ; les appels passés restent attachés à l'ancienne     | 3   | M    |
| P2-E3-S05 | En tant que scolarité, je veux marquer un élève parti ou diplômé                                                                       | Statut, date ; inscriptions clôturées ; exclu des appels futurs                                | 2   | M    |
| P2-E3-S06 | En tant que scolarité, je veux rechercher et filtrer les élèves (nom, matricule, classe, statut)                                       | Pagination curseur ; `VIEW_STUDENTS`                                                           | 3   | M    |
| P2-E3-S07 | En tant que scolarité, je veux voir la liste des élèves avec données incomplètes (sans parent, sans classe, sans date de naissance)    | Vue dédiée avec compteurs ; lien d'action                                                      | 3   | S    |

## E4 — Tuteurs et liens parent-enfant

| ID        | Story                                                                                                                                                                     | Critères d'acceptation                                                                                                        | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| P2-E4-S01 | [Tech] Tables `guardians`, `student_guardians` (drapeaux, `linked_by`, `unlinked_at`), FK composites, audit systématique                                                  | Suppression physique impossible ; test B→A                                                                                    | 5   | M    |
| P2-E4-S02 | En tant que scolarité, je veux créer un tuteur (téléphone E.164 obligatoire, e-mail optionnel) et le lier à un ou plusieurs élèves avec un type de relation et des droits | Normalisation E.164 ; détection d'un tuteur existant par téléphone ; drapeaux par défaut tous actifs ; `LINK_GUARDIAN` audité | 5   | M    |
| P2-E4-S03 | En tant que scolarité, je veux délier un tuteur d'un élève                                                                                                                | `unlinked_at`, motif, audit ; accès du parent coupé à la requête suivante                                                     | 2   | M    |
| P2-E4-S04 | En tant que tuteur, je veux recevoir une invitation SMS/e-mail avec un code afin d'activer mon compte                                                                     | Code à usage unique 72 h ; activation par OTP (P1-E4-S05) ; membership GUARDIAN créé ; `guardians.user_id` renseigné          | 5   | M    |
| P2-E4-S05 | En tant que tuteur, je veux voir la liste de mes enfants (tous établissements) et basculer entre eux                                                                      | `GET /me/children` ; un enfant par lien actif ; aucun enfant non lié (test automatisé)                                        | 3   | M    |
| P2-E4-S06 | [Tech] `GuardianPolicy` (vue, finance, paiement, justificatif) et tests unitaires exhaustifs                                                                              | Matrice drapeaux × action ; lien délié → refus                                                                                | 3   | M    |
| P2-E4-S07 | En tant que tuteur principal, je veux voir qui d'autre a accès à mon enfant                                                                                               | Liste des tuteurs liés avec relation et droits ; lecture seule                                                                | 3   | S    |

## E5 — Imports CSV et qualité des données

| ID        | Story                                                                                                                               | Critères d'acceptation                                                                                                         | Pts | Prio |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --- | ---- |
| P2-E5-S01 | [Tech] Infrastructure d'import : upload par URL présignée, job worker, `import_jobs`, rapport d'erreurs téléchargeable, modèles CSV | Import de 3 000 lignes < 2 min ; rapport ligne par ligne                                                                       | 5   | M    |
| P2-E5-S02 | En tant que scolarité, je veux importer les élèves avec leur classe depuis un CSV                                                   | Colonnes documentées ; validation ligne par ligne (matricule, classe existante, dates) ; mode « simulation » avant application | 5   | M    |
| P2-E5-S03 | En tant que scolarité, je veux importer les tuteurs et leurs liens aux élèves                                                       | Rattachement par matricule ; normalisation téléphone ; réutilisation d'un tuteur existant                                      | 5   | M    |
| P2-E5-S04 | En tant que scolarité, je veux voir les doublons probables (même nom + date de naissance, même téléphone)                           | Détection à l'import et à la saisie ; avertissement non bloquant                                                               | 3   | M    |
| P2-E5-S05 | En tant que scolarité, je veux fusionner deux fiches élève ou tuteur en double                                                      | Choix du survivant ; réaffectation des liens et inscriptions ; audit                                                           | 3   | C    |

## E6 — Dashboards scolarité et administrateur

| ID        | Story                                                                                                                                                                                                   | Critères d'acceptation                                              | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --- | ---- |
| P2-E6-S01 | En tant que scolarité, je veux un tableau de bord (élèves, inscriptions, tuteurs, élèves sans tuteur, imports récents, données incomplètes)                                                             | Chiffres exacts vs requêtes de référence ; < 500 ms                 | 5   | S    |
| P2-E6-S02 | En tant qu'administrateur, je veux un tableau de bord (élèves, enseignants, classes, cours, séances à venir, erreurs de configuration : cours sans enseignant, groupe sans élève, emploi du temps vide) | Liste d'erreurs actionnable                                         | 5   | S    |
| P2-E6-S03 | En tant qu'administrateur, je veux un assistant de première configuration (année → structure → matières → enseignants → cours → emploi du temps → élèves → tuteurs)                                     | Progression sauvegardée ; chaque étape renvoie vers l'écran complet | 3   | C    |

## E7 — Reliquat Phase 1

| ID        | Story                                            | Pts | Prio |
| --------- | ------------------------------------------------ | --- | ---- |
| P2-E7-S01 | P1-E10 Back-office Super Admin minimal (S01–S03) | 11  | S    |
| P2-E7-S02 | P1-E4-S09 MFA TOTP                               | 5   | S    |
| P2-E7-S03 | P1-E4-S10 Sessions actives                       | 2   | S    |

## Risques spécifiques à la phase

- **Qualité des données sources** : téléphones mal formatés, homonymes, classes nommées différemment d'un fichier à l'autre → mode simulation, normalisation E.164, rapport d'erreurs, atelier de nettoyage avec la scolarité pilote avant l'import réel.
- **Modèle universitaire plus riche que prévu** (UE optionnelles individuelles) : `SUBGROUP` par UE + inscriptions multiples ; si insuffisant, ADR avant la Phase 3.
- **Fêtes de fin d'année** : capacité réduite ; G2 visé au 15 janvier avec marge d'une semaine.
- **Rattachement parent-enfant** : risque n° 1 du produit ; aucune création de lien par le parent lui-même ; tests B→A et policy exhaustifs obligatoires avant de livrer E4-S05.
