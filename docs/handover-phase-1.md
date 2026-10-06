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

## Ce qui n'a PAS pu être vérifié ici — à faire en premier

La session de développement n'avait pas accès à `registry.npmjs.org` : **les dépendances n'ont jamais été installées**, donc ni `pnpm build`, ni `pnpm lint`, ni les tests n'ont tourné. Le code a été relu et passé au compilateur TypeScript sans ses dépendances (syntaxe et cohérence interne OK ; les erreurs restantes étaient toutes dues aux modules absents). La migration SQL, elle, a été exécutée (up puis down) sur PostgreSQL 16 avec succès.

Ordre de vérification recommandé (une demi-journée) :

```bash
pnpm install
pnpm build --filter=@polaris/contracts
pnpm typecheck            # corriger les écarts de typage avec les versions réelles de drizzle/nest/jose
pnpm lint                 # règles type-checked : attendre quelques `no-floating-promises` à traiter
pnpm depcruise            # frontières de modules
docker compose up -d && pnpm db:migrate && pnpm db:seed
pnpm test && pnpm test:integration
pnpm openapi              # génère openapi.json + SDK ; committer packages/contracts/src/sdk/schema.d.ts
pnpm format && git commit -am "chore: format"   # puis retirer continue-on-error dans ci.yml
pnpm dev                  # smoke manuel : login admin@lycee-demo.local, /api/docs
```

Points à surveiller lors de cette première compilation (hypothèses prises sans pouvoir les tester) :

1. **Drizzle 0.43** : signatures de `db.execute(sql\`…\`)` (`rows`, `rowCount`), `selectDistinct`, sous-requête dans `inArray`, type `inet`. Ajuster si l'API a bougé.
2. **NestJS 11 + Express 5** : `app.set('trust proxy')`, `rawBody: true`, ordre des guards globaux (`useExisting`), `@Res({ passthrough: true })` avec cookies.
3. **BullMQ 5** : `upsertJobScheduler` (≥ 5.16), `addBulk` avec `jobId`.
4. **jose 6** en CommonJS (`moduleResolution: Node16`) : si l'import échoue, passer `apps/api` en ESM ou épingler jose 5.
5. **Vitest 3.2** : `test.projects` (sinon revenir à `vitest.workspace.ts`).
6. **Tests d'intégration** : ils supposent `polaris_app` (sans BYPASSRLS) et `polaris_owner` sur `polaris_test` (voir `test/global-setup.ts`, variables `DATABASE_URL_TEST*`). Redis doit tourner ; la base de test est **recréée** à chaque run.
7. **ESLint type-checked** : quelques `@typescript-eslint/no-floating-promises` ou `no-unsafe-*` probables dans les tests et le worker ; corriger plutôt que désactiver.

## Décisions d'implémentation à connaître

- **Une requête = une transaction** (`TransactionInterceptor`) : les services utilisent `db.current()` et ne gèrent pas la transaction. Un handler qui appelle un service externe porte `@NoTransaction()` et ouvre lui-même ses transactions courtes (ex. `AuthService.requestOtp`).
- **Trois portées de route** (`@Scope`) : `tenant` (défaut, RLS), `platform` (BYPASSRLS, Super Admin), `identity` (utilisateur sans tenant : `/me`, bascule).
- **Identité globale hors RLS** : `users`, `memberships`, `membership_roles`, `refresh_tokens`, `otp_codes` ; `rls_exemptions` liste les exceptions et le test `rls.test.ts` les vérifie. `audit_logs` et `outbox_events` acceptent l'écriture depuis le contexte identité (login, OTP) mais la lecture reste scopée.
- **Pool plateforme** : utilisé par le module Platform, l'idempotence, la recherche d'invitation par jeton, la liste des appartenances au login et le relais outbox. Chaque usage passe par `withPlatformTx(reason, …)` et est tracé.
- **Révocation** : rôles → `permissions_version` ; suspension/désactivation → cache `mship:*` invalidé (sinon 30 s) ; déconnexion globale → `token_version`.
- **Mode cookie** : en-tête `X-Client: web/…` ; sinon le refresh voyage dans le corps (mobile).
- **Invitations** : en dehors de la production, la réponse contient le jeton (`token`) pour faciliter les tests ; en production il n'arrive que par e-mail.

## Prochaines étapes

1. Vérification ci-dessus, puis PR `feat/phase-1-socle` → `main` avec la CI verte.
2. Choix de l'hébergement et câblage des jobs `deploy-staging` / `deploy-production` (secrets GitHub `environment`).
3. Reliquat P1 (MFA TOTP, sessions actives UI, Bull Board) en début de Phase 2, comme prévu au backlog.
4. Phase 2 : structure académique, élèves, tuteurs, imports (`docs/backlog/phase-2-academique.md`).
