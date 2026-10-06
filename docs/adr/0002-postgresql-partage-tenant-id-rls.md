# ADR-0002 — PostgreSQL unique partagé, `tenant_id` sur chaque table, Row-Level Security en filet

- **Statut** : Proposée
- **Date** : 2026-10-06
- **Décideurs** : lead technique
- **Références** : document directeur Partie 3 (multi-tenancy), Partie 6 ; ADR-0001

## Contexte et problème

Chaque établissement est un tenant dont les données ne doivent **jamais** être visibles d'un autre. Le risque principal du produit est la fuite inter-tenant (données de mineurs, données financières). L'équipe est petite ; les migrations doivent rester un acte unique ; la volumétrie à trois ans est d'environ 200 tenants, 150 000 élèves, quelques millions de lignes d'assiduité par an. Certains utilisateurs (parents) appartiennent légitimement à plusieurs tenants.

## Options envisagées

1. **Une base par tenant** — isolation physique maximale, mais 200 bases à migrer, sauvegarder, monitorer, et un pool de connexions par tenant ; les requêtes transverses de la plateforme deviennent pénibles.
2. **Un schéma PostgreSQL par tenant** — mêmes coûts de migration (×200), `search_path` fragile, outillage ORM moins mûr.
3. **Base partagée avec colonne `tenant_id`**, filtrage applicatif seul — simple, mais un oubli de `WHERE tenant_id = …` suffit à fuiter.
4. **Base partagée avec `tenant_id` + Row-Level Security (RLS)** — la base refuse elle-même de servir les lignes d'un autre tenant, en plus du filtrage applicatif.

## Décision

Nous retenons l'option 4, **base partagée + `tenant_id` + RLS**, avec les règles suivantes :

- `tenant_id UUID NOT NULL` sur toute table métier. Exceptions explicites : `tenants`, `users` (compte global), `permissions`, tables techniques globales.
- L'appartenance d'un utilisateur à un tenant est une ligne `memberships` ; le token porte le _membership actif_ et donc un seul `tenant_id` à la fois.
- Clés primaires `UUID` v7 ; **clés étrangères composites `(tenant_id, id)`** sur les relations sensibles (`student_guardians`, `payment_allocations`, `attendance_records`, `payment_attempts`) pour qu'une FK ne puisse pas traverser deux tenants.
- Toute unicité est scopée : `UNIQUE (tenant_id, …)`. Tout index de table métier commence par `tenant_id`.
- **RLS activée** sur chaque table métier avec la policy `tenant_id = current_setting('app.tenant_id')::uuid`. Le rôle applicatif n'a pas `BYPASSRLS`. Chaque transaction applicative commence par `SET LOCAL app.tenant_id = …`. Une requête sans contexte renvoie zéro ligne.
- Un rôle PostgreSQL distinct avec `BYPASSRLS` est réservé au module Platform (Super Admin) et aux jobs transverses explicitement listés ; son usage est journalisé.
- Un helper de migration crée toute table métier avec colonne, policy et index composite ; un test CI échoue si une table possède `tenant_id` sans policy.
- Un contexte tenant résolu une fois par requête (`AsyncLocalStorage`) est injecté par le repository de base ; il n'existe pas de repository « sans tenant » hors du module Platform.
- Toute ressource d'un autre tenant répond **404**, jamais 403.
- Partitionnement par `tenant_id` (`pg_partman`) uniquement pour `attendance_records` et `notifications`, et seulement au-delà de ~50 M lignes.
- Sauvegarde : une base, PITR ; export par tenant = job applicatif.

## Conséquences

### Positives

- Trois barrières indépendantes (guard HTTP, repository scopé, RLS) : une erreur applicative donne un résultat vide, pas une fuite.
- Une migration, un backup, un monitoring.
- Les requêtes plateforme (métriques, support) restent du SQL ordinaire.

### Négatives et risques acceptés

- RLS ajoute une condition à chaque requête ; négligeable avec `tenant_id` en tête des index, mais à surveiller sur les requêtes de reporting (vues matérialisées).
- Les transactions doivent impérativement passer par le helper qui fait `SET LOCAL` ; un accès direct au pool contourne la protection (interdit par lint et revue).
- Un tenant très volumineux partage les ressources des autres (« noisy neighbour ») : limité par le rate limiting par tenant et le partitionnement.
- Les développeurs doivent apprendre RLS : formation en semaine 1 de la Phase 1, pair programming.

### Ce que cette décision interdit

- Une table métier sans `tenant_id` ou sans policy RLS.
- Une requête SQL brute exécutée hors du helper transactionnel.
- Un identifiant séquentiel exposé dans l'API.
- Répondre 403 à une ressource d'un autre tenant.

## Comment on saura qu'il faut la revoir

- Un client exige contractuellement une base ou une instance dédiée (réponse possible : un déploiement séparé complet du monolithe pour ce client, pas un changement de modèle).
- Le p95 d'une requête métier dépasse 400 ms à cause de RLS après optimisation des index.
- Plus de 2 000 tenants ou plus de 500 M de lignes dans une table.
