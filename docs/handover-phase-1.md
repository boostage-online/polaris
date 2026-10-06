# Passation — Phase 1 (socle technique)

Branche : `feat/phase-1-socle` (au-dessus de `docs/phase-0-cadrage`). État au 6 octobre 2026.

## Ce qui est livré

| Epic (backlog P1)      | Contenu                                                                                                                                                                                                    | Où                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| E1 Monorepo, outillage | pnpm/Turborepo, TS strict, ESLint, Prettier, commitlint, dependency-cruiser (couches), Docker Compose, Drizzle + helper transactionnel                                                                     | racine, `packages/config`, `docker-compose.yml`, `apps/api/src/database`                                                                  |
| E2 CI/CD               | workflow PR/main/tag (lint, types, frontières, migrations up→down→up, tests, images GHCR), Dockerfiles api/worker/web, runbooks déploiement/rollback/restore/secrets/incident                              | `.github/workflows/ci.yml`, `infra/docker`, `docs/runbooks`                                                                               |
| E3 Tenancy             | migration 0001 (RLS activée + forcée, FK composites, UUID v7, rôles PG), contexte tenant, `withTenantTx`, `ScopeGuard` (404 hors tenant), test générique B→A sur toutes les routes, test de couverture RLS | `apps/api/migrations`, `src/database`, `src/modules/identity/infrastructure/scope.guard.ts`, `test/rls.test.ts`, `test/isolation.test.ts` |
| E4 Identité            | argon2id, JWT ES256 10 min, refresh rotatif + détection de réutilisation, cookie web / body mobile, OTP SMS, switch-membership, logout(-all), sessions actives, anti-brute-force, invitations              | `src/modules/identity`                                                                                                                    |
| E5 RBAC                | catalogue typé, rôles système, guards, cache Redis versionné (`pv`), policies pures testées, matrice de permissions générée                                                                                | `packages/contracts/src/permissions.ts`, `src/modules/identity`, `test/permissions-matrix.*`                                              |
| E6 Audit               | `audit_logs` append-only (trigger), `AuditService.record` dans la transaction, consultation paginée                                                                                                        | `src/modules/audit`                                                                                                                       |
| E7 Outbox / worker     | `outbox_events` + `OutboxService.publish` (transaction obligatoire), relais LISTEN/NOTIFY + poll, processeur idempotent, DLQ, purges horaires                                                              | `src/modules/shared`, `src/worker`                                                                                                        |
| E8 Observabilité       | Pino JSON + redaction, `/health/live                                                                                                                                                                       | ready`, `/metrics`Prometheus, en-têtes`X-Request-Id`/`X-Trace-Id`, erreurs RFC 9457 avec `traceId`                                        | `src/app.module.ts`, `src/health`, `src/common` |
| E9 Frontend + SDK      | Next.js (login, choix d'établissement, tableau de bord, invitation), client API avec refresh silencieux, OpenAPI généré depuis les routes réelles, SDK `openapi-typescript`                                | `apps/web`, `src/openapi`, `packages/contracts/src/sdk`                                                                                   |
| E10 Super Admin        | création/suspension de tenants, invitation administrateur (API uniquement, pas d'écran)                                                                                                                    | `src/modules/platform`                                                                                                                    |

Non livré (reporté comme prévu dans le backlog) : MFA TOTP (`P1-E4-S09`), tableau de bord des files (Bull Board), écrans Super Admin, OpenTelemetry (hooks prévus, non câblés), Sentry (variable prévue, SDK non branché).

## État de vérification (CI GitHub Actions, PR #1)

**CI verte** au commit `37bc6a4` (6 octobre 2026) : lint type-checked, typecheck, frontières de modules (dependency-cruiser), garde-fou de migrations, migrations up → down → up sur PostgreSQL 16, tests unitaires, **40 tests d'intégration sur PostgreSQL/Redis réels** (RLS, isolation inter-tenant générique, authentification, RBAC, matrice de permissions, outbox/idempotence, worker), génération OpenAPI.

Le code avait été écrit sans accès au registre npm ; la première compilation a eu lieu dans la CI. Corrections apportées lors de cette boucle (utiles pour comprendre certains choix) :

| Problème rencontré                                                                                       | Correction                                                                                          |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `jose` 6 est ESM-only sous CommonJS                                                                      | épinglé `jose@5` (double build)                                                                     |
| `moduleResolution: Node16` faisait coexister deux jeux de types Drizzle (`.d.ts` / `.d.cts`)             | retour à `Node10` ; TypeScript 5.x épinglé (`ignoreDeprecations` non supporté par TS 5)             |
| esbuild (vitest, tsx) n'émet pas `emitDecoratorMetadata` → injection NestJS impossible                   | SWC partout : `unplugin-swc` pour vitest, `@swc-node/register` pour les scripts et le mode dev      |
| `INSERT … RETURNING` sur `outbox_events` refusé par la policy RLS de lecture depuis le contexte identité | identifiant généré côté application, plus de `RETURNING`                                            |
| révocation de famille de refresh tokens annulée par le rollback de la requête en 401                     | révocation exécutée dans une transaction indépendante                                               |
| `DiscoveryService` non disponible (`app.get`)                                                            | `DiscoveryModule` importé dans `AppModule`                                                          |
| tableau JS dans `sql\`… = any(\${ids})\`` développé en tuple                                             | `inArray()` du query builder                                                                        |
| argon2 exige `timeCost ≥ 2`                                                                              | paramètres corrigés (seed et vérification à temps constant)                                         |
| `logout-all` dans la boucle de la matrice invalidait toutes les sessions de l'utilisateur                | joué séparément, en dernier                                                                         |
| journaux GitHub Actions non lisibles depuis l'environnement de développement                             | `.github/scripts/run-step.sh` publie les dernières lignes d'une étape en échec en commentaire de PR |

Reste à faire côté CI : câbler `deploy-staging` / `deploy-production` sur le PaaS retenu (Phase 0, décision hébergement) ; committer `packages/contracts/src/sdk/schema.d.ts` régénéré quand la spec change (`pnpm openapi`).

## Décisions d'implémentation à connaître

- **Une requête = une transaction** (`TransactionInterceptor`) : les services utilisent `db.current()` et ne gèrent pas la transaction. Un handler qui appelle un service externe porte `@NoTransaction()` et ouvre lui-même ses transactions courtes (ex. `AuthService.requestOtp`).
- **Trois portées de route** (`@Scope`) : `tenant` (défaut, RLS), `platform` (BYPASSRLS, Super Admin), `identity` (utilisateur sans tenant : `/me`, bascule).
- **Identité globale hors RLS** : `users`, `memberships`, `membership_roles`, `refresh_tokens`, `otp_codes` ; `rls_exemptions` liste les exceptions et le test `rls.test.ts` les vérifie. `audit_logs` et `outbox_events` acceptent l'écriture depuis le contexte identité (login, OTP) mais la lecture reste scopée.
- **Pool plateforme** : utilisé par le module Platform, l'idempotence, la recherche d'invitation par jeton, la liste des appartenances au login et le relais outbox. Chaque usage passe par `withPlatformTx(reason, …)` et est tracé.
- **Révocation** : rôles → `permissions_version` ; suspension/désactivation → cache `mship:*` invalidé (sinon 30 s) ; déconnexion globale → `token_version`.
- **Mode cookie** : en-tête `X-Client: web/…` ; sinon le refresh voyage dans le corps (mobile).
- **Invitations** : en dehors de la production, la réponse contient le jeton (`token`) pour faciliter les tests ; en production il n'arrive que par e-mail.

## Prochaines étapes

1. Revue et fusion de la PR #1 (`feat/phase-1-socle` → `main`), CI verte.
2. Choix de l'hébergement et câblage des jobs `deploy-staging` / `deploy-production` (secrets GitHub `environment`).
3. Reliquat P1 (MFA TOTP, sessions actives UI, Bull Board) en début de Phase 2, comme prévu au backlog.
4. Phase 2 : structure académique, élèves, tuteurs, imports (`docs/backlog/phase-2-academique.md`).
