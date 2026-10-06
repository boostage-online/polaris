# Polaris

Plateforme SaaS multi-tenant d'**assiduité** et de **frais scolaires** pour les établissements scolaires et universitaires et leurs parents/tuteurs. Modular monolith TypeScript : API NestJS, worker BullMQ, frontend Next.js, PostgreSQL (Row-Level Security), Redis.

- Document directeur (architecture, roadmap, risques) : [Claude Docs](https://claude.ai/code/artifact/21da5528-b9d1-4354-a925-56e8fe542012)
- Décisions figées : [`docs/adr/`](docs/adr/README.md) · Backlog : [`docs/backlog/`](docs/backlog/README.md) · Runbooks : [`docs/runbooks/`](docs/runbooks/README.md)

## Démarrer en 15 minutes

Prérequis : Node 22 (`.nvmrc`), pnpm 10 (`corepack enable`), Docker.

```bash
git clone <repo> polaris && cd polaris
cp .env.example .env                      # valeurs locales prêtes à l'emploi
docker compose up -d                      # PostgreSQL 16, Redis 7, MinIO, Mailpit
pnpm install
pnpm build --filter=@polaris/contracts    # types et schémas partagés
pnpm db:migrate                           # migrations SQL (expand only)
pnpm db:seed                              # 1 plateforme, 1 lycée, 1 université, 1 compte par rôle
pnpm dev                                  # api :4000, worker, web :3000
```

Comptes de démonstration (mot de passe `Polaris-demo-2026`) : `admin@polaris.local` (Super Admin), `admin@lycee-demo.local`, `teacher@lycee-demo.local`, `finance@univ-demo.local`, etc. (un compte par rôle système et par établissement, `<role>@<code>.local`).

- API : <http://localhost:4000/api/v1> · documentation interactive : <http://localhost:4000/api/docs>
- Web : <http://localhost:3000> · e-mails locaux : <http://localhost:8025> (Mailpit)
- Santé : `GET /api/v1/health/ready` · métriques : `GET /api/v1/metrics`

## Commandes

| Commande                                          | Effet                                                                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` · `pnpm typecheck` · `pnpm depcruise` | qualité ; `depcruise` vérifie les frontières entre modules (ADR-0001)                                                   |
| `pnpm test`                                       | tests unitaires (domaine pur, contrats)                                                                                 |
| `pnpm test:integration`                           | tests sur PostgreSQL/Redis réels : RLS, isolation inter-tenant, auth, RBAC, matrice de permissions, outbox, idempotence |
| `pnpm db:migrate` / `db:rollback` / `db:status`   | migrations SQL (`apps/api/migrations`)                                                                                  |
| `pnpm --filter @polaris/api db:check-migrations`  | garde-fou expand/contract                                                                                               |
| `pnpm openapi`                                    | génère `apps/api/openapi.json` et le SDK TypeScript (`packages/contracts/src/sdk`)                                      |
| `pnpm --filter @polaris/api keys:generate`        | paire de clés JWT ES256 pour `.env`                                                                                     |

## Structure

```
apps/api                 API NestJS + worker (src/worker) — un code, deux processus
  migrations/            SQL versionné, expand → contract
  src/modules/           tenancy · identity · platform · audit · shared  (Phase 1)
                         academic · students-guardians · attendance · billing · payments · notifications · reporting (phases suivantes)
  test/                  intégration (vitest + supertest), permissions-matrix.yaml
apps/web                 Next.js, client de l'API (jamais d'accès direct à la base)
packages/contracts       schémas zod, catalogue de permissions, codes d'erreur, SDK généré
packages/config          tsconfig, eslint, règles dependency-cruiser
infra/                   docker-compose, Dockerfiles, init PostgreSQL
docs/                    ADR, backlog, cadrage, runbooks
```

## Règles non négociables (résumé des ADR)

1. Toute table métier porte `tenant_id`, RLS activée ; les requêtes passent par `withTenantTx` ; une ressource d'un autre tenant répond **404**.
2. Un module n'importe un autre module que via son `index.ts`, et uniquement vers les couches inférieures (vérifié en CI).
3. Les effets différés passent par l'outbox dans la transaction métier ; aucun appel externe dans une transaction.
4. Les permissions sont des constantes TypeScript ; aucun test de nom de rôle dans le code ; chaque route non publique figure dans `permissions-matrix.yaml`.
5. Access JWT 10 min sans permissions dedans ; refresh opaque rotatif ; jamais de token dans `localStorage`.
6. API `/api/v1` additive, erreurs RFC 9457, pagination par curseur, `Idempotency-Key` sur les créations.
7. Tables financières et `audit_logs` append-only ; corrections par écritures compensatoires.
