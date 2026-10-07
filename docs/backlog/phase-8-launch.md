# Phase 8 — Lancement production et hypercare

**Fenêtre** : 12 juil → 23 juil 2027 (2 semaines), puis **hypercare** août 2027 (4 semaines). **Objectif** : ouverture commerciale ; les pilotes passent en production définitive ; les premiers établissements payants sont onboardés pour la rentrée de septembre 2027. **Porte G8** : disponibilité ≥ 99,5 % sur le mois ; 0 incident S1 ; réconciliation quotidienne à 0 écart ; ≥ 70 % des parents des pilotes activés.

**ADR mises en œuvre** : 0001 (RLS : `tenant_usage_monthly` est une table tenant), 0003 (worker : sondes, revue, instantanés), 0007 (permission `RESET_USER_MFA`), 0008 (réinitialisation MFA tracée). **Prérequis** : G7 (pentest traité, checklist signée, exercice de restauration réussi) ; décisions « avant production » toutes signées ; astreinte nommée.

| Epic | Titre                                                                 | Points | Must |
| ---- | --------------------------------------------------------------------- | ------ | ---- |
| E1   | Mise en production outillée d'un établissement (préparation, bascule) | 13     | ✔    |
| E2   | Tableau de bord d'adoption (G8)                                       | 8      | ✔    |
| E3   | Hypercare : revue quotidienne, e-mail, acquittement                   | 13     | ✔    |
| E4   | Disponibilité mesurée et page publique d'état                         | 8      | ✔    |
| E5   | Consommation mensuelle (mesure pour la tarification)                  | 5      | ✔    |
| E6   | Support niveau 1 : recherche, déverrouillage, réinitialisation MFA    | 8      | ✔    |
| E7   | Astreinte, playbook support, communication, formation                 | 8      | ✔    |
| E8   | Bascule des pilotes, premiers établissements payants, hypercare réel  | 13     | ✔    |
|      | **Total**                                                             | **76** |      |

> **État (PR #8, octobre 2026)** : E1 à E7 livrés (API, worker, écrans web, documentation) et couverts par `test/launch.test.ts`, la matrice de permissions (+17 routes) et le test d'isolation. E8 est l'exploitation réelle : bascule des pilotes, onboarding des premiers établissements payants et quatre semaines d'hypercare, à réaliser avec les établissements. Reporté (V1) : facturation SaaS automatique à partir de la consommation, sonde externe de disponibilité, page d'état avec incidents rédigés, formation vidéo. Détail : `docs/handover-phase-8.md`.

---

## E1 — Mise en production d'un établissement

| ID        | Story                                                                                                                                                                                         | Critères d'acceptation                                                                                                                                                          | Pts | Prio |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| P8-E1-S01 | [Tech] Colonnes `tenants.plan`, `live_at`, `hypercare_until`, `launch_checklist`                                                                                                              | Migration 0008 expand-only ; DTO tenant enrichi                                                                                                                                 | 2   | M    |
| P8-E1-S02 | En tant que Super Admin, je veux voir si un établissement est prêt : assistant complet, MFA de chaque administrateur, provider en mode réel ou désactivé, plafond SMS, alertes, premier appel | `GET /platform/tenants/:id/launch` ; points bloquants vs avertissements ; `ready`                                                                                               | 5   | M    |
| P8-E1-S03 | En tant que Super Admin, je veux cocher les points humains (contrat, budget SMS, astreinte prévenue, données validées)                                                                        | `PATCH …/launch/checklist` ; journalisé                                                                                                                                         | 2   | M    |
| P8-E1-S04 | En tant que Super Admin, je veux basculer l'établissement en production avec son offre et sa durée d'hypercare                                                                                | `POST …/launch/go-live` : 409 tant qu'un point bloque, statut ACTIVE, `live_at`, `hypercare_until`, audit `tenant.live`, e-mail aux administrateurs ; test `mise en production` | 3   | M    |
| P8-E1-S05 | Écran : bouton « Mise en production » par établissement, badge « Production depuis… / Hypercare jusqu'au… »                                                                                   | Vue plateforme → Établissements                                                                                                                                                 | 1   | M    |

## E2 — Adoption

| ID        | Story                                                                                                                                                                                             | Critères d'acceptation                                                                 | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --- | ---- |
| P8-E2-S01 | En tant que Super Admin, je veux, par établissement, l'activation des parents, les enseignants actifs, les appels soumis / séances tenues (7 j), la part du paiement en ligne, les SMS vs plafond | `GET /platform/adoption` ; `meetsG8` (≥ 70 %) ; égalité avec les tables sources (test) | 5   | M    |
| P8-E2-S02 | En tant que Super Admin, je veux la tendance du parc sur 8 semaines (parents activés, appels, paiements en ligne)                                                                                 | Barres hebdomadaires ; onglet Adoption                                                 | 3   | M    |

## E3 — Hypercare

| ID        | Story                                                                                                                                                                                | Critères d'acceptation                                                                                   | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | --- | ---- |
| P8-E3-S01 | [Tech] Revue quotidienne à 07:00 : disponibilité 24 h, alertes, UNKNOWN, en attente > 1 h, réconciliation, intégrité, SMS, imports, notifications, appels manquants, parents activés | Cron `hypercare-digest` ; table `platform_daily_reviews` ; `healthy`                                     | 5   | M    |
| P8-E3-S02 | En tant qu'administrateur plateforme, je veux recevoir la revue par e-mail (une fois) et la régénérer à la demande                                                                   | E-mail à la première génération seulement ; `POST /platform/reviews/generate` ; test `revue quotidienne` | 3   | M    |
| P8-E3-S03 | En tant qu'astreinte, je veux acquitter la revue avec une note (actions décidées)                                                                                                    | `POST /platform/reviews/:day/ack` ; qui, quand ; onglet Hypercare                                        | 3   | M    |
| P8-E3-S04 | Runbooks `hypercare.md` (lecture en 5 min, seuils, actions) et `astreinte.md`                                                                                                        | Rédigés                                                                                                  | 2   | M    |

## E4 — Disponibilité

| ID        | Story                                                                                               | Critères d'acceptation                                                                        | Pts | Prio |
| --------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --- | ---- |
| P8-E4-S01 | [Tech] Sonde `/health/ready` chaque minute, latence et motif d'échec conservés 90 jours             | Cron `availability-probe` ; `availability_checks` ; purge horaire                             | 3   | M    |
| P8-E4-S02 | En tant que Super Admin, je veux la disponibilité par jour et sur 30 jours face à l'objectif 99,5 % | `GET /platform/availability?days` ; p95 ; `meetsTarget`                                       | 2   | M    |
| P8-E4-S03 | En tant qu'établissement ou parent, je veux une page publique d'état du service                     | `GET /api/v1/status` (public, limité) ; page `/status` ; aucune donnée d'établissement (test) | 3   | M    |
| P8-E4-S04 | Sonde externe (PaaS ou tiers) corrélée                                                              | Reporté : infrastructure                                                                      | 2   | S    |

## E5 — Consommation

| ID        | Story                                                                                                              | Critères d'acceptation                                                                        | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --- | ---- |
| P8-E5-S01 | [Tech] Instantané mensuel par établissement (élèves, tuteurs, personnel, appels, SMS, e-mails, paiements) sous RLS | Cron `usage-snapshot` 04:15 ; idempotent ; mois précédent figé le 1er–2 ; test `consommation` | 3   | M    |
| P8-E5-S02 | En tant que Super Admin, je veux la liste du mois et un CSV pour facturer à la main                                | `GET /platform/usage`, `…/export.csv` ; onglet Consommation                                   | 2   | M    |

## E6 — Support niveau 1

| ID        | Story                                                                                                                                                  | Critères d'acceptation                                                                                                                  | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| P8-E6-S01 | En tant que support, je veux retrouver une personne par e-mail, téléphone ou nom dans tous les établissements et voir pourquoi elle ne se connecte pas | `GET /platform/support/lookup?q` : compte, verrouillage, MFA, sessions, invitations, rôles, tuteurs sans compte ; journalisé            | 3   | M    |
| P8-E6-S02 | En tant que support, je veux lever un verrouillage anti-force-brute                                                                                    | `POST /platform/support/unlock` ; test (5 échecs → 423 → déverrouillé → 200)                                                            | 1   | M    |
| P8-E6-S03 | En tant que support (ou administrateur avec `RESET_USER_MFA`), je veux réinitialiser la MFA d'une personne identifiée                                  | Sessions révoquées, motif journalisé ; refus sur soi-même ; 404 hors établissement ; permission sensible (MFA exigée) ; écran Personnel | 3   | M    |
| P8-E6-S04 | Playbook support N1 (10 demandes fréquentes, règles, ticket niveau 2)                                                                                  | `docs/support/playbook-n1.md`                                                                                                           | 1   | M    |

## E7 — Astreinte, communication, formation

| ID        | Story                                                                                  | Critères d'acceptation                                  | Pts | Prio |
| --------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------- | --- | ---- |
| P8-E7-S01 | Astreinte définie : plage, rotation, délais, pouvoirs, escalade, relève                | `docs/runbooks/astreinte.md`                            | 2   | M    |
| P8-E7-S02 | Modèles : annonce de mise en production + note aux parents ; préparation de la rentrée | `docs/communication/annonce-lancement.md`, `rentree.md` | 2   | M    |
| P8-E7-S03 | Support niveau 1 formé (½ journée) avec les guides utilisateur et le playbook          | Session tenue, quiz de 10 cas                           | 2   | M    |
| P8-E7-S04 | Vidéos de formation (appel, caisse, parent)                                            | Reporté                                                 | 2   | C    |

## E8 — Exploitation réelle

| ID        | Story                                                                                            | Critères d'acceptation                                 | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | --- | ---- |
| P8-E8-S01 | Bascule des pilotes en production définitive (checklist, go-live, annonce)                       | 3–5 établissements `live_at` renseigné                 | 3   | M    |
| P8-E8-S02 | Hypercare 4 semaines : revue acquittée chaque jour ouvré, réconciliation à 0 écart               | 100 % des revues acquittées ; `reconciliationGaps = 0` | 5   | M    |
| P8-E8-S03 | Premiers établissements payants onboardés pour septembre (créneaux planifiés, budget SMS validé) | Onboarding < 2 h (G7), `plan` STANDARD/PREMIUM         | 3   | M    |
| P8-E8-S04 | Porte G8 mesurée : disponibilité ≥ 99,5 %, 0 S1, ≥ 70 % de parents activés                       | Lecture dans Hypercare et Adoption                     | 2   | M    |
