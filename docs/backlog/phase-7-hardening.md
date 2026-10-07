# Phase 7 — Durcissement et pilote élargi

**Fenêtre** : 31 mai → 9 juil 2027 (6 semaines, 3 sprints dont 2 semaines de marge pour les correctifs post-pentest). **Objectif** : le système est prêt à accueillir 20 établissements sans surveillance permanente. **Porte G7** : RTO mesuré < 2 h ; p95 API < 400 ms à 2 000 utilisateurs simultanés ; 0 vulnérabilité haute ouverte ; un établissement non pilote onboardé par le support en moins de 2 h sans développeur.

**ADR mises en œuvre** : 0001 (RLS, exemptions explicites), 0003 (worker : alertes, rétention), 0007 (permissions `MANAGE_PRIVACY`, permissions d'impersonation), 0008 (MFA TOTP pour les actions sensibles et le super admin, impersonation tracée), 0009 (erreurs 403 `MFA_REQUIRED`, 413, 429 par portée). **Prérequis** : G6 ; pentester externe réservé ; comptes sandbox des deux providers.

| Epic | Titre                                                                              | Points | Must |
| ---- | ---------------------------------------------------------------------------------- | ------ | ---- |
| E1   | Authentification renforcée : MFA TOTP, codes de récupération                       | 13     | ✔    |
| E2   | Impersonation Super Admin tracée et bornée                                         | 8      | ✔    |
| E3   | Supervision : alertes plateforme, e-mail, acquittement                             | 13     | ✔    |
| E4   | Données personnelles : export, anonymisation, rétention, registre                  | 13     | ✔    |
| E5   | Onboarding self-service : assistant, bannière, manuel                              | 8      | ✔    |
| E6   | Sécurité applicative : CSP, anti-CSRF, limites, en-têtes, audit                    | 13     | ✔    |
| E7   | Résilience et exploitation : sauvegarde, restauration, charge, runbooks, exercices | 13     | ✔    |
| E8   | Pentest externe, checklist signée, pilote élargi                                   | 8      | ✔    |
|      | **Total**                                                                          | **89** |      |

> **État (PR #7, octobre 2026)** : E1 à E7 livrés (API, worker, écrans web, CI, documentation) et couverts par `test/hardening.test.ts`, la matrice de permissions (+20 routes) et le test d'isolation. E8 dépend de prestataires et d'établissements réels : le cahier des charges du pentest (`docs/security/pentest-brief.md`), la checklist renseignée et le brief d'exercice sont prêts ; le test lui-même, le rapport de charge sur staging et le pilote élargi restent à réaliser. Reporté : QR code pour l'enrôlement MFA (saisie manuelle de la clé), CAPTCHA et vérification HIBP des mots de passe, KMS pour la clé maître, CSP bloquante (après une semaine de rapports sur staging), Renovate. Détail : `docs/handover-phase-7.md`.

---

## E1 — MFA TOTP

| ID        | Story                                                                                                                                  | Critères d'acceptation                                                                                                        | Pts | Prio |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| P7-E1-S01 | [Tech] TOTP RFC 6238 (SHA-1, 30 s, ±1 fenêtre) sans dépendance, vecteurs de test de la RFC                                             | `domain/totp.test.ts` vert ; secret scellé par enveloppe (`APP_MASTER_KEY`)                                                   | 3   | M    |
| P7-E1-S02 | En tant que membre du personnel, je veux activer la MFA en deux temps (clé + code de confirmation) et recevoir 8 codes de récupération | `POST /me/mfa/setup` → secret en attente 10 min ; `POST /me/mfa/enable` avec code valide ; codes hachés, à usage unique       | 5   | M    |
| P7-E1-S03 | En tant qu'utilisateur MFA, je veux un défi après le mot de passe, protégé contre le rejeu                                             | `POST /auth/login` renvoie un défi (5 min, usage unique) ; `POST /auth/mfa/verify` ; code déjà utilisé refusé ; 60/min par IP | 3   | M    |
| P7-E1-S04 | [Tech] Les actions couvertes uniquement par une permission sensible et toute route plateforme exigent une session MFA                  | 403 `MFA_REQUIRED` ; drapeau `mfa` dans le jeton et le refresh ; test `MFA exigée`                                            | 2   | M    |
| P7-E1-S05 | En tant qu'utilisateur, je veux désactiver la MFA ou régénérer mes codes avec un code valide                                           | `POST /me/mfa/disable`, `POST /me/mfa/recovery-codes` ; écran Sécurité du compte                                              | —   | S    |
| P7-E1-S06 | QR code à l'enrôlement                                                                                                                 | Reporté (saisie manuelle + lien `otpauth://`)                                                                                 | 1   | C    |

## E2 — Impersonation

| ID        | Story                                                                                                                                    | Critères d'acceptation                                                                                                               | Pts | Prio |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --- | ---- |
| P7-E2-S01 | En tant que Super Admin, je veux ouvrir une session de support sur un établissement avec un motif, pour 30 minutes au plus               | `POST /platform/tenants/:id/impersonate` (MFA) → jeton d'accès 30 min ; table `impersonation_sessions` ; `IMPERSONATION_TTL_MINUTES` | 3   | M    |
| P7-E2-S02 | [Tech] Les permissions de la session sont celles de l'administrateur moins toute action financière/sensible ; jamais de route plateforme | `IMPERSONATION_EXCLUDED` ; 403 sur paiement/annulation/clés/privacy ; 404 sur `/platform/*` ; test `impersonation`                   | 3   | M    |
| P7-E2-S03 | En tant qu'administrateur d'établissement, je veux voir qu'une session de support est en cours et la retrouver dans l'audit              | Bannière orange ; `impersonated_by` dans `audit_logs` ; « via le support » dans `/admin/audit`                                       | 1   | M    |
| P7-E2-S04 | En tant que Super Admin, je veux lister et clôturer les sessions                                                                         | `GET /platform/impersonations`, `POST /platform/impersonations/:id/end` (cache Redis 30 s invalidé) ; onglet Support                 | 1   | S    |

## E3 — Supervision

| ID        | Story                                                                                                                                                            | Critères d'acceptation                                                                                                              | Pts | Prio |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| P7-E3-S01 | [Tech] Évaluation toutes les 5 minutes d'un jeu de conditions (Redis, outbox, files, DLQ, agrégats périmés, revues, SMS, intégrité, disjoncteurs, notifications) | Cron `platform-alerts` ; table `platform_alerts` (clé stable, ouverture, dernière vue, résolution) ; seuils dans `ALERT_THRESHOLDS` | 5   | M    |
| P7-E3-S02 | En tant qu'administrateur plateforme, je veux être prévenu par e-mail à l'ouverture d'une alerte puis toutes les 6 h tant qu'elle reste ouverte                  | E-mail aux comptes plateforme ; `notified_at` ; renvoi 6 h ; test `alertes`                                                         | 3   | M    |
| P7-E3-S03 | En tant qu'administrateur plateforme, je veux voir, acquitter et voir se résoudre les alertes                                                                    | `GET /platform/alerts?status`, `POST /platform/alerts/:id/ack`, `POST /platform/alerts/evaluate` ; onglet Alertes                   | 3   | M    |
| P7-E3-S04 | Runbook « alertes » : signification et action pour chaque clé                                                                                                    | `docs/runbooks/alerts.md`                                                                                                           | 2   | M    |

## E4 — Données personnelles

| ID        | Story                                                                                                                                | Critères d'acceptation                                                                                                                                     | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| P7-E4-S01 | En tant qu'administrateur, je veux exporter en JSON toutes les données d'un élève ou d'un tuteur                                     | `GET /privacy/students/:id`, `GET /privacy/guardians/:id` (`MANAGE_PRIVACY`) ; sections identité, inscriptions, présences, frais, paiements, notifications | 3   | M    |
| P7-E4-S02 | En tant que parent, je veux télécharger mes propres données                                                                          | `GET /me/personal-data` ; bouton « Mes données »                                                                                                           | 2   | M    |
| P7-E4-S03 | En tant qu'administrateur, je veux anonymiser un élève parti (après délai, ou forcé) ou un tuteur sans enfant, avec motif journalisé | Refus 409 si actif / lien actif / délai non écoulé sans `force` ; identité, notes, justificatifs, notifications effacés ; pièces comptables conservées     | 5   | M    |
| P7-E4-S04 | [Tech] Rétention automatique nocturne (élèves 5 ans après départ, tuteurs inactifs 2 ans), paramétrable par établissement            | Cron `privacy-retention` 03:30 ; `settings.privacy.*` ; test `rétention`                                                                                   | 2   | M    |
| P7-E4-S05 | En tant qu'administrateur, je veux un registre des demandes (qui, quand, quoi, motif, origine)                                       | `privacy_requests` ; `GET /privacy/requests` ; écran Données personnelles ; registre des traitements `docs/security/registre-traitements.md`               | 1   | M    |

## E5 — Onboarding self-service

| ID        | Story                                                                                                                          | Critères d'acceptation                                                           | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | --- | ---- |
| P7-E5-S01 | En tant qu'administrateur, je veux un assistant de 12 étapes calculées depuis les données réelles, avec lien vers chaque écran | `GET /onboarding` ; étapes `year … first-sheet` ; progression ; test `assistant` | 5   | M    |
| P7-E5-S02 | En tant qu'administrateur, je veux ignorer une étape facultative et masquer la bannière                                        | `PATCH /onboarding` ; `settings.onboarding` fusionné par section                 | 1   | M    |
| P7-E5-S03 | Manuel d'onboarding et runbook support « < 2 h sans développeur »                                                              | `docs/user-guide/onboarding.md`, `docs/runbooks/onboarding-tenant.md`            | 2   | M    |

## E6 — Sécurité applicative

| ID        | Story                                                                                                                         | Critères d'acceptation                                            | Pts | Prio |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --- | ---- |
| P7-E6-S01 | [Tech] CSP avec nonce et `strict-dynamic` côté web (report-only puis bloquante), CSP de l'API, HSTS, Permissions-Policy, COOP | Middleware Next ; `CSP_ENFORCE` ; helmet                          | 3   | M    |
| P7-E6-S02 | [Tech] Anti-CSRF sur les routes à cookie (`Origin` = `WEB_ORIGIN`), corps limités à 1 Mo, 429 distincts par portée            | Test `anti-CSRF` ; 413 en Problem Details                         | 2   | M    |
| P7-E6-S03 | [Tech] `security.txt`, audit des dépendances (bloquant sur critique), détection de secrets (gitleaks) en CI                   | Job `security` vert ; `pnpm audit --prod` ; rapport dans la PR    | 3   | M    |
| P7-E6-S04 | En tant qu'administrateur, je veux consulter le journal d'audit (acteur, action, objet, avant/après, support)                 | `/admin/audit` (`VIEW_AUDIT_LOG`) ; filtres action/acteur/période | 3   | M    |
| P7-E6-S05 | Checklist sécurité Partie 11 renseignée ligne par ligne, modèle de menaces STRIDE                                             | `docs/security/checklist.md`, `docs/security/threat-model.md`     | 2   | M    |

## E7 — Résilience et exploitation

| ID        | Story                                                                                                                               | Critères d'acceptation                                                                                 | Pts | Prio |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --- | ---- |
| P7-E7-S01 | [Tech] Scripts de sauvegarde et d'exercice de restauration (chronométré, vérifications d'intégrité), rejoués en CI                  | `ops/db/backup.sh`, `ops/db/restore-drill.sh`, `ops/db/restore-check.sql` ; étape CI « restore drill » | 5   | M    |
| P7-E7-S02 | [Tech] Scénarios k6 (API lecture/écriture, webhooks) avec seuils p95 < 400 ms, workflow manuel contre staging                       | `load/k6/*.js`, `.github/workflows/load.yml`, `load/README.md`                                         | 3   | M    |
| P7-E7-S03 | Runbooks complets (alertes, provider hors ligne, violation de données, quota SMS, impersonation, onboarding) et journal d'exercices | `docs/runbooks/*`, `docs/runbooks/exercise-log.md`, modèles `docs/communication/*`                     | 3   | M    |
| P7-E7-S04 | Exercices réels : restauration à J−1 (RTO < 2 h), provider hors ligne 1 h, fuite supposée                                           | **À réaliser sur staging** ; résultats consignés dans `exercise-log.md`                                | 2   | M    |

## E8 — Pentest, checklist signée, pilote élargi

| ID        | Story                                                                                  | Critères d'acceptation                                           | Pts | Prio |
| --------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --- | ---- |
| P7-E8-S01 | Test d'intrusion externe (boîte grise, deux tenants, tous rôles) et corrections        | `docs/security/pentest-brief.md` ; 0 haute ouverte ; contre-test | 5   | M    |
| P7-E8-S02 | Checklist sécurité signée, décisions « avant production » toutes signées               | Section « Signature » de la checklist                            | 1   | M    |
| P7-E8-S03 | Pilote élargi à 3–5 établissements dont un sur le second provider ; retours UX traités | Journal des retours ; p95 et RTO mesurés en conditions réelles   | 2   | M    |
