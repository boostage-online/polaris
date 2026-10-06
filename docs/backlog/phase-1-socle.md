# Phase 1 — Socle technique

**Fenêtre** : 2 nov → 4 déc 2026 (5 semaines, 2,5 sprints). **Objectif** : un monolithe déployé en staging avec tenancy, auth, RBAC, audit, outbox, observabilité et CI complète — sans fonctionnalité métier visible. **Porte G1** : token du tenant B sur ressource du tenant A → 404 sur 100 % des routes ; requête SQL sans `app.tenant_id` → 0 ligne ; déploiement et rollback < 10 min ; p95 des routes auth < 200 ms.

**ADR mises en œuvre** : 0001, 0002, 0003, 0007, 0008, 0009.

| Epic | Titre | Points | Must |
| --- | --- | --- | --- |
| E1 | Monorepo, outillage, environnement local | 21 | ✔ |
| E2 | CI/CD, environnements, déploiement | 26 | ✔ |
| E3 | Tenancy et isolation (RLS) | 24 | ✔ |
| E4 | Identité et authentification | 39 | ✔ |
| E5 | RBAC et policies | 21 | ✔ |
| E6 | Audit | 10 | ✔ |
| E7 | Outbox, queues, worker | 18 | ✔ |
| E8 | Observabilité et santé | 16 | ✔ |
| E9 | Squelette frontend et SDK | 21 | ✔ |
| E10 | Back-office Super Admin minimal | 13 | S |
| | **Total** | **209** | |

Capacité estimée : 5 semaines × ~25 pts ≈ 125 pts par équipe de 3,5 devs… **le total dépasse la capacité d'environ 40 %**. Arbitrage proposé : E10 reporté en début de Phase 2 ; E4-S09/S10 (MFA, sessions actives) et E8-S05 (traces) en fin de phase si capacité, sinon début Phase 2. Le reste est incompressible pour G1.

---

## E1 — Monorepo, outillage, environnement local

| ID | Story | Critères d'acceptation | Pts | Prio |
| --- | --- | --- | --- | --- |
| P1-E1-S01 | [Tech] Initialiser le monorepo pnpm + Turborepo avec `apps/api`, `apps/web`, `apps/worker`, `packages/contracts`, `packages/ui`, `packages/config` | `pnpm install` puis `pnpm build` et `pnpm test` passent sur un poste vierge ; cache Turborepo actif ; Node LTS pair épinglé (`.nvmrc`, `engines`) | 5 | M |
| P1-E1-S02 | [Tech] Configurer ESLint, Prettier, TypeScript strict, commits conventionnels, hooks pre-commit | `pnpm lint` échoue sur `any` implicite, import non utilisé, `dangerouslySetInnerHTML` ; commitlint actif | 3 | M |
| P1-E1-S03 | [Tech] Règles de couches entre modules (dependency-cruiser) | Import de `payments` depuis `academic` → échec CI ; import d'un fichier interne d'un autre module (hors `index.ts`) → échec ; `domain/` important NestJS/Drizzle → échec | 3 | M |
| P1-E1-S04 | [Tech] `docker compose up` local : PostgreSQL 16, Redis 7, MinIO, Mailpit, api + worker en hot reload | Démarrage < 2 min ; `README` « démarrer en 15 min » suivi par un dev externe à l'équipe sans aide | 5 | M |
| P1-E1-S05 | [Tech] Drizzle ORM : configuration, génération de migrations, script `migrate`, helper transactionnel avec `SET LOCAL app.tenant_id` | Une migration générée, relue et appliquée ; le helper expose `withTenantTx(tenantId, fn)` et `withPlatformTx(fn)` ; accès direct au pool interdit par lint | 5 | M |

## E2 — CI/CD, environnements, déploiement

| ID | Story | Critères d'acceptation | Pts | Prio |
| --- | --- | --- | --- | --- |
| P1-E2-S01 | [Tech] Pipeline PR GitHub Actions : lint, typecheck, dependency-cruiser, unitaires, intégration (services Postgres/Redis), build images | Durée < 12 min ; échec bloque le merge ; cache pnpm et Turborepo | 5 | M |
| P1-E2-S02 | [Tech] Images Docker `api` et `worker` (multi-stage, non-root, healthcheck) publiées taguées `sha` | Image < 300 Mo ; `docker run` démarre avec les variables documentées dans `.env.example` | 3 | M |
| P1-E2-S03 | [Tech] Environnement staging sur le PaaS retenu : Postgres managé (PITR), Redis managé, bucket S3, secrets | Déploiement automatique à chaque merge sur `main` ; URL staging accessible ; secrets hors dépôt | 5 | M |
| P1-E2-S04 | [Tech] Étape de migration distincte avant déploiement rolling ; rollback = redéploiement de l'image N−1 | Migration appliquée avant bascule ; rollback testé < 10 min ; runbook `deploy-rollback.md` | 5 | M |
| P1-E2-S05 | [Tech] Test de migration en CI sur dump (seed) : up, down de la dernière, up ; détection de `DROP`/`RENAME` dans une migration | PR avec `DROP COLUMN` sans marqueur `-- contract` → échec | 3 | M |
| P1-E2-S06 | [Tech] Smoke tests post-déploiement (health, login seed, requête tenantisée) | Échec du smoke → déploiement marqué en échec et alerte | 2 | M |
| P1-E2-S07 | [Tech] Sauvegardes : PITR 7 j, snapshot quotidien 35 j, job de test de restauration mensuel | Une restauration exécutée manuellement et documentée (`restore.md`) ; job planifié créé | 3 | M |

## E3 — Tenancy et isolation

| ID | Story | Critères d'acceptation | Pts | Prio |
| --- | --- | --- | --- | --- |
| P1-E3-S01 | [Tech] Tables `tenants`, `campuses`, `academic_years`, `terms` avec contraintes (slug unique, un seul `is_current` par tenant) | Migrations relues ; tests de contraintes | 3 | M |
| P1-E3-S02 | [Tech] Helper de création de table métier : `tenant_id NOT NULL`, policy RLS, index composite ; test CI « table avec `tenant_id` sans policy » | Création d'une table de test sans policy → échec CI | 5 | M |
| P1-E3-S03 | [Tech] Rôles PostgreSQL : `app` (sans `BYPASSRLS`), `platform` (`BYPASSRLS`, usage journalisé) | Requête via `app` sans `SET LOCAL` → 0 ligne ; via `platform` → journal d'usage | 3 | M |
| P1-E3-S04 | [Tech] Contexte tenant par requête (`AsyncLocalStorage`), `TenantGuard`, repository de base scopé | Toute route hors liste publique exige un membership actif ; ressource d'un autre tenant → 404 | 5 | M |
| P1-E3-S05 | [Tech] Suite de tests d'isolation : deux tenants semés en miroir, test générique B→A sur chaque route enregistrée | Le générateur échoue si une route n'est pas couverte ; 100 % des routes → 404 | 5 | M |
| P1-E3-S06 | En tant que Super Admin, je veux créer, activer et suspendre un tenant afin d'onboarder un établissement | Création avec code, nom, type, fuseau ; suspension bloque toute connexion des memberships du tenant avec message explicite ; audité | 3 | M |

## E4 — Identité et authentification

| ID | Story | Critères d'acceptation | Pts | Prio |
| --- | --- | --- | --- | --- |
| P1-E4-S01 | [Tech] Tables `users`, `memberships`, `refresh_tokens`, `otp_codes` ; contraintes (e-mail/téléphone uniques non null, au moins l'un des deux) | Migrations + tests | 3 | M |
| P1-E4-S02 | En tant que membre du personnel, je veux me connecter par e-mail + mot de passe afin d'accéder à mon établissement | argon2id (paramètres ADR-0008) ; mot de passe ≥ 10 et absent des listes compromises ; réponse identique compte inexistant / mauvais mot de passe | 5 | M |
| P1-E4-S03 | [Tech] Émission d'access JWT ES256 10 min (`sub, mid, tid, kind, pv`) et refresh opaque rotatif avec `family_id` ; détection de réutilisation → révocation de la famille | Tests : rotation, réutilisation, expiration ; clés avec `kid` et rotation documentée | 8 | M |
| P1-E4-S04 | [Tech] Transport : cookie `HttpOnly; Secure; SameSite=Strict` sur `/api/v1/auth` pour le web ; `Authorization: Bearer` et refresh dans le body pour les autres clients | Les deux modes testés ; aucun token dans `localStorage` (revue front) | 3 | M |
| P1-E4-S05 | En tant que parent, je veux activer mon compte par OTP SMS afin de me connecter avec mon téléphone | OTP 6 chiffres, 5 min, 5 essais, 3 envois/h ; anti-énumération ; passerelle SMS en mode « log » en local/staging | 5 | M |
| P1-E4-S06 | En tant qu'utilisateur, je veux basculer entre mes établissements afin d'agir dans le bon tenant | `POST /auth/switch-membership` ; nouveau token ; audit | 2 | M |
| P1-E4-S07 | En tant qu'utilisateur, je veux me déconnecter de cet appareil ou de tous mes appareils | Révocation du refresh courant / de toutes les familles + `token_version` ; access tokens expirés en ≤ 10 min | 3 | M |
| P1-E4-S08 | [Tech] Anti-brute-force : verrouillage progressif par compte et par IP (Redis), CAPTCHA après 3 échecs sur le web | Tests de seuils ; métriques d'échecs exposées | 3 | M |
| P1-E4-S09 | En tant que Super Admin ou titulaire d'une permission financière sensible, je dois configurer la MFA TOTP afin de sécuriser mes actions | Enrôlement avec QR, codes de récupération, exigence vérifiée au login et avant action sensible | 5 | S |
| P1-E4-S10 | En tant qu'utilisateur, je veux voir mes sessions actives et en révoquer une | Liste (appareil, dernière activité), révocation unitaire | 2 | S |

## E5 — RBAC et policies

| ID | Story | Critères d'acceptation | Pts | Prio |
| --- | --- | --- | --- | --- |
| P1-E5-S01 | [Tech] Catalogue de permissions en TypeScript (`as const`), migration de synchronisation vers `permissions` | Ajout d'une permission = modification du fichier + migration générée ; test d'égalité code ↔ base | 3 | M |
| P1-E5-S02 | [Tech] Tables `roles`, `role_permissions`, `membership_roles` ; rôles système copiés à la création du tenant | 7 rôles système présents sur tout nouveau tenant ; rôle Administrateur non modifiable | 3 | M |
| P1-E5-S03 | [Tech] `PermissionGuard` + décorateur `@RequirePermission`, cache Redis `perms:{mid}:{pv}`, invalidation par `pv` | Retrait d'une permission effectif à la requête suivante ; route sans décorateur et hors liste publique → échec d'un test de démarrage | 5 | M |
| P1-E5-S04 | En tant qu'administrateur d'établissement, je veux attribuer et retirer des rôles aux membres afin d'organiser mon équipe | Impossible de retirer `MANAGE_ROLES` au dernier détenteur ; audité `before/after` | 3 | M |
| P1-E5-S05 | En tant qu'administrateur, je veux modifier les permissions d'un rôle système (sauf Administrateur) ou le dupliquer | Édition, duplication ; audit | 3 | S |
| P1-E5-S06 | [Tech] Générateur de matrice de permissions : pour chaque route, rôle système × résultat attendu ; échec si une route n'a pas d'entrée | Matrice versionnée (`permissions-matrix.yaml`), test exécuté en CI | 4 | M |

## E6 — Audit

| ID | Story | Critères d'acceptation | Pts | Prio |
| --- | --- | --- | --- | --- |
| P1-E6-S01 | [Tech] Table `audit_logs` append-only (trigger anti UPDATE/DELETE), décorateur `@Audited(action)` capturant acteur, entité, `before/after`, IP, user agent | Tentative d'UPDATE → exception ; test du décorateur sur une entité factice | 5 | M |
| P1-E6-S02 | En tant qu'administrateur, je veux consulter le journal d'audit de mon établissement filtré par entité, acteur et période | Pagination par curseur, permission `VIEW_AUDIT_LOG`, export CSV | 3 | M |
| P1-E6-S03 | [Tech] Index `(tenant_id, entity_type, entity_id)` et `(tenant_id, occurred_at DESC)` ; rétention et plan de partitionnement documentés | Requête de 10 000 lignes < 100 ms sur seed | 2 | S |

## E7 — Outbox, queues, worker

| ID | Story | Critères d'acceptation | Pts | Prio |
| --- | --- | --- | --- | --- |
| P1-E7-S01 | [Tech] Table `outbox_events`, API `events.publish(event)` utilisable uniquement dans une transaction | Publication hors transaction → erreur ; test : rollback n'écrit rien | 3 | M |
| P1-E7-S02 | [Tech] Relais outbox → BullMQ (poller + `LISTEN/NOTIFY`), marquage `published_at`, purge 7 j, métrique « plus vieil événement non publié » | Crash simulé entre commit et publish → événement publié au redémarrage | 5 | M |
| P1-E7-S03 | [Tech] `apps/worker` : enregistrement des processeurs, `processed_events` pour l'idempotence, retry 5× backoff, DLQ par file, drainage à l'arrêt | Doublon d'événement → traité une fois ; échec définitif visible en DLQ | 5 | M |
| P1-E7-S04 | [Tech] Jobs planifiés (BullMQ repeatable) avec verrou anti-double exécution multi-instances | Deux workers démarrés → un seul exécute le cron | 3 | M |
| P1-E7-S05 | [Tech] Tableau de bord des files (Bull Board) protégé par le rôle Platform | Accessible en staging ; profondeur et DLQ visibles | 2 | S |

## E8 — Observabilité et santé

| ID | Story | Critères d'acceptation | Pts | Prio |
| --- | --- | --- | --- | --- |
| P1-E8-S01 | [Tech] Logs Pino JSON avec `request_id`, `trace_id`, `tenant_id`, `actor`, `route`, `duration_ms` ; redaction par liste de clés | Test : `password`, `authorization`, `token` jamais présents dans un log | 3 | M |
| P1-E8-S02 | [Tech] `GET /health/live` et `GET /health/ready` (DB, Redis, S3, migrations à jour) | Readiness fausse si Redis indisponible ; utilisée par le PaaS | 2 | M |
| P1-E8-S03 | [Tech] Métriques Prometheus/OpenMetrics : HTTP (taux, latence par route, 4xx/5xx par tenant), files, DB pool ; export vers Grafana Cloud/Datadog | Dashboard « API » et « Queues » importés ; alerte 5xx > 2 % configurée | 5 | M |
| P1-E8-S04 | [Tech] Sentry api, worker, web ; tags `tenant_id`, `release` ; erreurs attendues (4xx, provider FAILED) exclues | Erreur déclenchée en staging visible avec `trace_id` | 3 | M |
| P1-E8-S05 | [Tech] OpenTelemetry (HTTP, pg, BullMQ, sortant) ; échantillonnage 10 % + règle 100 % sur `/auth` et futurs `/payments`, `/webhooks` | Trace de bout en bout API → worker visible | 3 | S |

## E9 — Squelette frontend et SDK

| ID | Story | Critères d'acceptation | Pts | Prio |
| --- | --- | --- | --- | --- |
| P1-E9-S01 | [Tech] Génération OpenAPI depuis les schémas zod de `packages/contracts` ; SDK TypeScript généré ; test de contrat snapshoté | Rupture non additive → échec CI ; SDK publié dans le monorepo | 5 | M |
| P1-E9-S02 | [Tech] Next.js App Router : layout responsive (mobile first), thème, composants de base (`packages/ui`), TanStack Query, gestion des erreurs RFC 9457 et affichage du `trace_id` | Lighthouse mobile ≥ 80 sur la page de login en 3G simulée | 5 | M |
| P1-E9-S03 | En tant qu'utilisateur, je veux me connecter, basculer d'établissement et me déconnecter depuis le web | Parcours E2E Playwright ; cookies conformes ; refresh transparent | 5 | M |
| P1-E9-S04 | [Tech] Enveloppe `{data, meta}`, pagination par curseur, filtres sur liste blanche, `Idempotency-Key` middleware (24 h, hash du body) | Même clé + body différent → 422 ; même clé → même réponse sans ré-exécution | 3 | M |
| P1-E9-S05 | [Tech] Rate limiting par IP, utilisateur, tenant (Redis, fenêtre glissante) ; limites dédiées auth/OTP | 429 avec `Retry-After` ; métriques | 3 | M |

## E10 — Back-office Super Admin minimal (reportable)

| ID | Story | Critères d'acceptation | Pts | Prio |
| --- | --- | --- | --- | --- |
| P1-E10-S01 | En tant que Super Admin, je veux lister les tenants avec statut, nombre de membres et date de création | Vue paginée ; recherche par nom/code | 3 | S |
| P1-E10-S02 | En tant que Super Admin, je veux inviter le premier administrateur d'un tenant | Invitation e-mail avec lien à usage unique (24 h) ; audit | 3 | S |
| P1-E10-S03 | En tant que Super Admin, je veux impersonner un membre pendant 30 min, avec bannière et journalisation, sans accès aux actions financières | Bannière visible ; actions marquées `impersonated_by` dans l'audit ; permissions financières refusées | 5 | S |
| P1-E10-S04 | En tant que Super Admin, je veux voir la santé de la plateforme (API, files, DB, dernières erreurs) | Page agrégeant health, métriques clés, liens Sentry/Grafana | 2 | C |

## Risques spécifiques à la phase

- **Sur-ingénierie du socle** : i18n complète, SSO, feature flags avancés sont hors phase ; toute story non listée passe par le product owner.
- **RLS mal comprise** : session de formation 90 min en semaine 1 (lead) ; pair programming obligatoire sur E3.
- **Choix du PaaS en retard** : E2-S03 est bloquée tant que l'hébergement n'est pas choisi (décision Phase 0) ; le reste de E2 peut avancer en local.
- **Capacité** : voir arbitrage en tête de fichier ; G1 ne dépend pas de E10 ni des stories `S`.
