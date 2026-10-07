# Checklist sécurité (Partie 11) — revue ligne par ligne, Phase 7

Statuts : ✅ fait et vérifié (test ou configuration citée) · 🟡 partiel (reste à faire précisé) · ⏭ reporté (phase ou condition) · 🏗 infrastructure (PaaS/cloud, hors code — à vérifier à la mise en production).

**Signature** : revue le 7 octobre 2026 pour la PR #7. À signer par le responsable technique et un second relecteur avant la production (décision « avant production » n° 9).

## Authentification et sessions

| Exigence                                                                                             | Statut | Où / preuve                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| argon2id (m = 64 Mo, t = 3, p = 4), mots de passe ≥ 10 caractères                                    | ✅     | `identity/application/password.service.ts`, `PasswordSchema.min(10)`                                                                          |
| Vérification contre une liste de mots de passe compromis (k-anonymity HIBP)                          | ⏭     | Appel réseau sortant à `api.pwnedpasswords.com` : à activer en production derrière un drapeau (`PASSWORD_BREACH_CHECK`), Phase 8              |
| JWT access ES256, 10 min, clés tournées (kid, double validité)                                       | ✅/🟡  | `token.service.ts`, JWKS `/auth/.well-known/jwks.json` ; rotation documentée (`runbooks/rotate-secrets.md`), **double validité à outiller**   |
| Refresh opaque haché, rotation à chaque usage, détection de réutilisation → révocation de la famille | ✅     | `refresh-token.service.ts`, test `auth.test.ts` « réutilisation = révocation »                                                                |
| Cookies HttpOnly ; Secure ; SameSite=Strict, chemin restreint ; aucun token dans localStorage        | ✅     | `controllers/cookies.ts` (`/api/v1/auth`), web : access token en mémoire uniquement (`lib/api.ts`)                                            |
| MFA TOTP obligatoire super admin et permissions financières sensibles ; codes de récupération        | ✅     | `mfa.service.ts`, `PermissionGuard` (403 `MFA_REQUIRED`), 8 codes hachés, test `hardening.test.ts`                                            |
| OTP SMS : 6 chiffres, 5 min, 5 essais, 3 envois/heure/numéro, anti-énumération                       | ✅     | `auth.service.ts` (`LockoutPolicy`), test `auth.test.ts` OTP                                                                                  |
| Verrouillage progressif par compte et par IP ; CAPTCHA après 3 échecs                                | 🟡     | Verrouillage : `lockout.service.ts` (compte 5 échecs → délai exponentiel ; IP 20/h). **CAPTCHA web non intégré** (dépendance tierce, Phase 8) |
| Révocation globale, liste des sessions actives visible par l'utilisateur                             | ✅     | `/auth/logout-all`, `/me/sessions`, écran `/settings/security`                                                                                |
| Impersonation Super Admin : 30 min, bannière, journalisée, interdite sur les actions financières     | ✅     | `impersonation.service.ts`, `IMPERSONATION_EXCLUDED`, bannière `app-shell.tsx`, `audit_logs.impersonated_by`, test `hardening.test.ts`        |

## Autorisation et isolation

| Exigence                                                                       | Statut | Où / preuve                                                                                                |
| ------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------- |
| Trois barrières tenant (guard, repository scopé, RLS) ; rôle DB sans BYPASSRLS | ✅     | `ScopeGuard`, `withTenantTx`, migrations (RLS forcée), test `rls.test.ts` (rôle applicatif sans BYPASSRLS) |
| 404 et non 403 pour une ressource d'un autre tenant                            | ✅     | `isolation.test.ts` (toutes les routes avec identifiant, A depuis B)                                       |
| Permissions en constantes typées ; aucun test de nom de rôle dans le code      | ✅     | `@polaris/contracts/permissions.ts`, `RequirePermission(...)`                                              |
| Policies de portée testées unitairement                                        | ✅     | `identity/domain/policies.test.ts`, `students-guardians/domain/policies` (droits parent)                   |
| Matrice endpoint × rôle exécutée en CI                                         | ✅     | `test/permissions-matrix.yaml` (≈ 210 routes) + test                                                       |
| Objets référencés par UUID v7 uniquement                                       | ✅     | `uuid_generate_v7()` dans toutes les tables                                                                |

## Surface web et API

| Exigence                                                                                                 | Statut | Où / preuve                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| CSRF : JSON + vérification Origin + cookie SameSite=Strict ; double-submit pour multipart                | ✅     | `assertTrustedOrigin` sur `/auth/refresh` et `/auth/logout` (test), aucun formulaire multipart (uploads par URL présignée à venir)          |
| XSS : React, interdiction de `dangerouslySetInnerHTML`, CSP stricte avec nonce, Referrer-Policy, nosniff | 🟡     | CSP avec nonce + `strict-dynamic` dans `middleware.ts` en **Report-Only** ; `CSP_ENFORCE=true` après une semaine sans rapport sur staging   |
| Injections : requêtes paramétrées, validation zod, listes blanches sort/filter                           | ✅     | Drizzle + `sql` paramétré ; `ZodBody/ZodQuery/ZodParams` partout ; `sql.raw` uniquement sur des requêtes constantes (export complet)        |
| Rate limiting par IP, user, tenant ; limites strictes auth, OTP, paiement, webhooks                      | ✅     | `RateLimitGuard` (Redis), `@RateLimit` sur login/OTP/refresh/MFA/tentatives/webhooks ; limiteur dédié par provider                          |
| Taille maximale des corps (1 Mo), timeouts, pagination obligatoire (max 200)                             | ✅     | `bootstrap.ts` (`useBodyParser` 1 Mo, 413 en Problem Details), `CursorQuerySchema.limit.max(200)` ; timeouts provider `PROVIDER_TIMEOUT_MS` |
| Headers de sécurité et TLS 1.2+ (CDN/PaaS) ; HSTS preload                                                | ✅/🏗  | Helmet (API), `next.config.ts` (HSTS preload, Permissions-Policy, COOP, X-Frame-Options) ; TLS côté PaaS                                    |
| Dépendances : pnpm audit + Dependabot/Renovate hebdo ; lockfile strict                                   | ✅/🟡  | Job CI `security` (`pnpm audit --prod --audit-level=high` bloquant), `--frozen-lockfile` ; **Renovate à activer sur le dépôt**              |

## Fichiers

| Exigence                                                                             | Statut | Où / preuve                                                                                                              |
| ------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| Upload par URL présignée S3, scan antivirus, lecture présignée, bucket privé chiffré | ⏭     | Aucun upload binaire au MVP (justificatifs : nom de document, PDF des reçus générés côté serveur) ; stockage objet en V1 |

## Secrets et clés provider

| Exigence                                                                                        | Statut | Où / preuve                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Secrets d'infrastructure hors dépôt ; `.env.example` sans valeur                                | ✅     | `.env.example` (valeurs de développement explicites), gitleaks en CI                                                                             |
| Clés provider chiffrées par enveloppe, clé maître dans un KMS, déchiffrement dans Payments seul | ✅/🏗  | `shared/infrastructure/secrets.ts` (DEK par enregistrement, AES-256-GCM), `PAYMENT_MASTER_KEY` ; **KMS** : `KeyWrapper` à brancher en production |
| Rotation : procédure clé maître, secrets webhook, clés JWT ; test trimestriel en staging        | 🟡     | `runbooks/rotate-secrets.md` ; ré-enveloppement des DEK à outiller (script) — Phase 8                                                            |
| Aucun secret dans les logs : redaction au niveau du logger                                      | ✅     | `app.module.ts` `REDACT_PATHS` (authorization, cookie, signatures provider, password, token, secret, code)                                       |

## Webhooks

| Exigence                                                                  | Statut | Où / preuve                                                             |
| ------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| Corps brut conservé pour la signature                                     | ✅     | `rawBody: true`, `webhook.service.ts`                                   |
| FedaPay : signature + horodatage (5 min) ; KKiaPay : secret puis `verify` | ✅     | `providers.test.ts` (corps altéré, horodatage périmé)                   |
| Liste d'IP provider en filtre supplémentaire                              | ⏭     | Non publiée de façon fiable par les providers ; à ajouter si fournie    |
| Hors auth utilisateur, limite dédiée, 2xx rapide, aucun détail d'erreur   | ✅     | `@Public()` + `@RateLimit` par provider, 200 immédiat, file `payments`  |
| Rejeu détecté par contraintes uniques                                     | ✅     | `UNIQUE(provider, external_event_id)`, test « dix webhooks identiques » |

## Finance

| Exigence                                                                               | Statut | Où / preuve                                                                                           |
| -------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| Montants calculés côté serveur ; montant vérifié = montant demandé                     | ✅     | `LedgerService`, `ConfirmAttempt` (écart → UNKNOWN + revue)                                           |
| Tables financières append-only par trigger ; corrections compensatoires                | ✅     | `forbid_mutation()` sur payments, allocations, ajustements, reçus                                     |
| Séparation des tâches, MFA sur les actions sensibles, double validation remboursements | ✅/⏭  | MFA exigée (`RECORD_MANUAL_PAYMENT`, `CANCEL_PAYMENT`, `MANAGE_PAYMENT_PROVIDER`) ; remboursements V1 |
| Reçus avec hash de vérification ; numérotation séquentielle sans trou                  | ✅     | `receipt_sequences`, vérification publique `/r/:number`                                               |
| Contrôle d'intégrité nocturne du grand-livre avec alerte                               | ✅     | `billing-daily` + alerte `tenant:<id>:ledger-integrity` (CRITICAL, e-mail)                            |

## Logs, audit, sauvegardes, chiffrement

| Exigence                                                                                                           | Statut | Où / preuve                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logs JSON structurés (tenant, acteur, request_id, trace_id), sans données personnelles ; rétention 90 j            | ✅/🏗  | pino + contexte de requête ; rétention côté plateforme de logs                                                                                          |
| `audit_logs` append-only, consultables par tenant ; export sur demande                                             | ✅     | Écran `/admin/audit`, inclus dans l'export complet (`journal_audit.csv`)                                                                                |
| Chiffrement au repos, TLS, PITR 7–30 j, snapshot quotidien 35 j, copie hebdo hors région ; test mensuel automatisé | 🏗/✅  | Service managé (décision « avant production » n° 8) ; **exercice de restauration automatisé en CI** (`ops/db/restore-drill.sh`, invariants, RTO mesuré) |
| Champs sensibles chiffrés applicativement (clés provider, secrets TOTP)                                            | ✅     | Enveloppe commune (`secrets.ts`)                                                                                                                        |
| Accès production : SSO + MFA, bastion, pas de psql sans ticket                                                     | 🏗     | Procédure dans `runbooks/database-roles.md` et `incident.md`                                                                                            |

## Données personnelles et mineurs

| Exigence                                                                                                   | Statut | Où / preuve                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Registre des traitements, base légale, information des parents, loi 2017-20 / RGPD                         | ✅     | `docs/security/registre-traitements.md`                                                      |
| Minimisation : pas de données de santé structurées, pas de photo obligatoire, pas de géolocalisation       | ✅     | Modèle de données (motif libre non médical, `photo_key` optionnel)                           |
| Durées : assiduité 5 ans après départ puis anonymisation ; finance 10 ans ; comptes parents inactifs 2 ans | ✅     | `privacy.service.ts` (`privacy-retention` quotidien, paramètres `privacy.*`)                 |
| Export par tenant et par parent ; suppression = anonymisation, conservation des pièces financières         | ✅     | Export complet (Phase 6), `/privacy/*`, `/me/personal-data`, anonymisation outillée          |
| Rattachement parent-enfant par le personnel, invitation par code, droits par drapeau, audit                | ✅     | Phase 2/3 ; écran « qui voit mon enfant » = droits visibles sur la fiche enfant (vue parent) |
| SMS : prénom + initiale seulement                                                                          | ✅     | Templates de notifications (Phase 3)                                                         |
| Clauses de sous-traitance, pays d'hébergement                                                              | 🏗     | Décision « avant production » n° 3                                                           |

## Gouvernance

| Exigence                                                     | Statut | Où / preuve                                                                                          |
| ------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------- |
| Modèle de menaces (STRIDE) revu à chaque phase majeure       | ✅     | `docs/security/threat-model.md`                                                                      |
| Test d'intrusion externe avant production ; `security.txt`   | 🟡/✅  | `security.txt` servi par le web ; **pentest externe à commander** (`docs/security/pentest-brief.md`) |
| Procédure d'incident et de notification 72 h                 | ✅     | `runbooks/incident.md`, `runbooks/data-breach.md` (exercice « fuite supposée »)                      |
| Revue de code obligatoire sur payments/, identity/, tenancy/ | ✅     | `CODEOWNERS` (+ billing, migrations, workflows, ops)                                                 |
