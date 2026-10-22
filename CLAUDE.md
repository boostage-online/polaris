# CLAUDE.md — consignes pour Claude Code sur Polaris

Polaris est une plateforme SaaS multi-établissements d'**assiduité** et de **frais scolaires** (Bénin, puis Afrique de l'Ouest francophone) : établissements, enseignants, parents. Le MVP (phases 1 à 8) est **terminé, testé et fusionné dans `main`**. Tu reprends le projet pour la suite : refonte visuelle, apps mobiles Flutter, mise en production, V1.

Avant toute tâche, lis dans cet ordre : ce fichier → [`docs/roadmap/README.md`](docs/roadmap/README.md) (le plan, la phase en cours) → la passation de la dernière phase (`docs/handover-phase-*.md`) → les ADR concernées (`docs/adr/`). Pour l'apparence : [`docs/design/README.md`](docs/design/README.md). Pour l'API : [`docs/api/README.md`](docs/api/README.md).

## Langue

**Tout est en français** : interface, messages d'erreur, documentation, commentaires de code, messages de commit, descriptions de PR, noms de tests (`it('refuse un parent qui n'est pas lié à l'élève', …)`). Les identifiants de code (variables, fonctions, tables, routes) restent en anglais.

## Pile technique (figée — ADR 0001 à 0010)

| Partie                     | Technologie                                                                                      | Dossier                          |
| -------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------- |
| API + worker               | NestJS 11, TypeScript strict, Drizzle (requêtes) + SQL écrit à la main (migrations), BullMQ      | `apps/api`                       |
| Web                        | Next.js 15 (App Router), React 19, TanStack Query, Tailwind                                      | `apps/web`                       |
| Contrats partagés          | zod, catalogue de permissions, codes d'erreur, SDK généré depuis OpenAPI                         | `packages/contracts`             |
| Mobile (à créer, phase 10) | Flutter 3 stable, Dart 3, Riverpod, go_router, dio, client généré depuis `docs/api/openapi.json` | `apps/mobile`                    |
| Données                    | PostgreSQL 16 (Row-Level Security forcée), Redis 7                                               | —                                |
| Déploiement                | Images Docker publiées par la CI sur GHCR, VPS Hostinger + Docker Compose + Caddy                | `infra/vps`, `.github/workflows` |

Monorepo **pnpm 10 + Turborepo**, Node 22. N'ajoute une dépendance que si elle est nécessaire, justifiée dans la PR, et mets `pnpm-lock.yaml` à jour dans le même commit (la CI installe en `--frozen-lockfile`).

## Commandes

```bash
docker compose up -d                       # PostgreSQL, Redis, MinIO, Mailpit (local)
pnpm install && pnpm build --filter=@polaris/contracts
pnpm db:migrate && pnpm db:seed            # données de démonstration (mot de passe Polaris-demo-2026)
pnpm dev                                   # api :4000, worker, web :3000
pnpm lint && pnpm typecheck && pnpm depcruise
pnpm test                                  # unitaires
pnpm test:integration                      # PostgreSQL et Redis réels, séquentiel (~2 min)
pnpm format:check                          # prettier (la CI le vérifie)
pnpm openapi                               # régénère apps/api/openapi.json et le SDK TypeScript
```

Comptes de démo : `admin@polaris.local` (Super Admin), `<rôle>@lycee-demo.local` / `<rôle>@univ-demo.local` (admin, direction, academic-head, registrar, student-life, teacher, finance), parent : `parent@lycee-demo.local`. MFA TOTP de démonstration pour admin, finance et Super Admin : secret `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`.

## Règles non négociables

1. **Isolation entre établissements.** Toute table métier porte `tenant_id` avec RLS forcée ; tout accès passe par `db.withTenantTx` / `db.current()` ; une ressource d'un autre établissement répond **404**. Toute nouvelle table tenant : policy RLS dans la migration, sinon une ligne dans `rls_exemptions` justifiée. `test/rls.test.ts` et `test/isolation.test.ts` doivent rester verts.
2. **Frontières de modules** (`packages/config/depcruise/api.cjs`) : un module n'importe un autre que par son `index.ts` et seulement vers une couche inférieure (1 socle → 2 référentiels → 3 métier → 4 transverse). `pnpm depcruise` en CI.
3. **Permissions** : constantes de `packages/contracts/src/permissions.ts`, jamais de test sur un nom de rôle. **Chaque route non publique a une ligne dans `apps/api/test/permissions-matrix.yaml`** (la CI échoue sinon) ; chaque route avec identifiant est couverte par le test d'isolation.
4. **Migrations SQL à la main** (`apps/api/migrations/NNNN_nom.up.sql` + `.down.sql` commençant par `-- contract`), **expand only** en production ; validées up → down → up par la CI.
5. **Effets différés par l'outbox** dans la transaction métier (notifications, e-mails, SMS) ; aucun appel externe dans une transaction.
6. **Argent** : montants entiers en XOF (`bigint`), tables financières et `audit_logs` append-only, corrections par écritures compensatoires, `Idempotency-Key` sur les créations de paiement.
7. **API** `/api/v1` additive (on ajoute, on ne casse pas : les apps mobiles déjà installées en dépendent), erreurs RFC 9457 (`AppError`), pagination par curseur.
8. **Auth** : JWT d'accès 10 min sans permissions dedans, refresh opaque rotatif (cookie HttpOnly pour le web, corps de réponse pour le mobile avec l'en-tête `X-Client: mobile/<version>`), jamais de jeton dans `localStorage` ; MFA exigée pour les permissions sensibles.
9. **Données de mineurs** : minimisation, prénom + initiale dans les SMS, pas de donnée personnelle dans les journaux.

## Façon de travailler

- **Une phase = une branche `feat/phase-N-…` = une PR vers `main`.** Commits petits et nommés (`feat(attendance): …`, `fix(web): …`, `docs: …` — commitlint).
- **La CI GitHub Actions est la vérité** : lint, typecheck, frontières, migrations, tests unitaires et d'intégration, audit des dépendances, gitleaks, images Docker. Une PR n'est terminée que **CI verte**. Les étapes en échec publient leurs dernières lignes en commentaire de la PR (`.github/scripts/run-step.sh`) : lis-les pour corriger.
- **Tests d'abord pour le métier** : un test d'intégration par règle (`apps/api/test/*.test.ts`, helpers `startApp`, `loginAs`, `localDay`). Dates : toujours dans le fuseau de l'établissement (`localDay`), jamais `toISOString().slice(0,10)`.
- **En fin de phase** : `docs/handover-phase-N.md` (livré, décisions, non couvert, état de vérification), backlog `docs/backlog/phase-N-*.md` mis à jour, index des docs.
- **Captures d'écran** : après un changement d'interface, lance le workflow « Captures d'écran » (onglet Actions, ou push sur la branche `screenshots-run`) et compare à `docs/design/maquettes/`. Ajoute les écrans nouveaux dans `ops/screenshots/screenshots.mjs`.
- **Ne jamais** : désactiver un test pour passer la CI, contourner la RLS, committer un secret (`.env` est ignoré), modifier une migration déjà fusionnée (on en écrit une nouvelle), pousser directement sur `main`.

## Carte du dépôt

```
apps/api/src/modules/   tenancy · identity · platform · audit · shared · academic · students-guardians ·
                        attendance · billing · payments · notifications · reporting · launch
apps/api/src/worker/    crons et processeurs BullMQ (même code, second processus)
apps/api/test/          intégration ; permissions-matrix.yaml
apps/web/src/app/       écrans (App Router) ; components/ ; lib/api.ts (client) ; lib/resources.ts
packages/contracts/     schémas zod = contrat API ; permissions ; SDK
docs/                   roadmap · design · api · mobile · adr · backlog · handover · runbooks · security · user-guide
infra/vps/              production : compose, Caddy, install.sh, deploy.sh, sauvegardes
ops/                    sauvegarde/restauration, captures d'écran
```
