# ADR-0009 — API REST `/api/v1`, additive, erreurs RFC 9457, pagination par curseur, idempotency keys

- **Statut** : Proposée
- **Date** : 2026-10-06
- **Décideurs** : lead technique
- **Références** : document directeur Parties 3, 16 ; ADR-0001

## Contexte et problème

Une seule API doit servir le web aujourd'hui et des apps Android/iOS demain, sans refonte. Les clients sont peu nombreux et sous notre contrôle. Les besoins en lecture sont prévisibles (dashboards par rôle). Les apps mobiles installées ne se mettent pas à jour le jour d'une release : la compatibilité ascendante est une contrainte dure. Les réseaux des parents sont souvent lents.

## Options envisagées

1. **GraphQL** — flexibilité de requête, mais surface de sécurité (profondeur, complexité, autorisation par champ, N+1) coûteuse pour une petite équipe ; caching HTTP et idempotence moins naturels ; aucun besoin de requêtes ad hoc.
2. **REST + OpenAPI** — standard, outillage de génération de SDK mûr, caching et rate limiting triviaux, idempotency keys naturelles.
3. **RPC typé** (tRPC) — excellent pour un front TypeScript, inadapté aux clients Kotlin/Swift et aux webhooks.
4. BFF par client (web, mobile) — logique dupliquée, deux contrats à maintenir.

## Décision

Nous retenons **REST + OpenAPI** avec le contrat suivant :

- Préfixe **`/api/v1`** ; le tenant est porté par le token (membership actif), pas par l'URL, sauf routes publiques (`/r/{tenant}/{receipt}/{hash}`).
- **Compatibilité** : dans une version, changements **additifs seulement** (nouveaux champs optionnels, nouveaux endpoints, nouvelles valeurs d'énumération documentées comme extensibles). Suppression ou changement de sens → `/api/v2` avec coexistence ≥ 12 mois. Header `X-Client: web/1.4.2` loggué ; `GET /meta/min-client-version` pour forcer une mise à jour.
- **Enveloppe** : `{ "data": …, "meta": { … } }` ; erreurs **RFC 9457** (`application/problem+json`) : `type`, `title`, `status`, `detail`, `code` (stable, ex. `PROVIDER_UNAVAILABLE`), `trace_id`, `errors[]` par champ pour 422.
- **Codes HTTP** : 200/201/204 ; 400 malformé ; 401 non authentifié ; 403 permission manquante ; **404 ressource inexistante ou d'un autre tenant** ; 409 conflit de version ou d'état ; 422 validation ; 429 rate limit ; 503 dépendance externe indisponible.
- **Pagination** : par **curseur** (`?cursor=&limit=`, max 200) pour les listes longues (assiduité, paiements, notifications) ; offset autorisé pour les listes d'administration courtes. Filtres et tris sur liste blanche (`?sort=-paid_at`).
- **Validation** : schémas zod dans `packages/contracts`, partagés front/back, source de l'OpenAPI ; aucune logique métier dans les DTO.
- **Idempotence** : header `Idempotency-Key` (UUID client) obligatoire sur création de tentative de paiement et paiement manuel, accepté sur toute création ; stockage 24 h de `(tenant, key, hash du body, réponse)` ; même clé + body différent → 422.
- **Concurrence** : `version` dans les payloads des entités éditables (feuille d'appel), `If-Match`/409 sur conflit.
- **Dates** : ISO 8601 UTC ; `tenant_timezone` fourni dans `/me`. **Montants** : entiers + `currency`.
- **Cache** : `ETag` / `If-None-Match` sur les ressources lues souvent.
- **Rate limiting** : par IP, par utilisateur, par tenant (Redis) ; limites dédiées sur auth, OTP, paiements, webhooks.
- **Endpoints « écran »** autorisés quand ils évitent plusieurs allers-retours (`GET /me/children/summary`, `GET /me/sessions/today`).
- **SDK** TypeScript généré pour le web ; Kotlin/Swift générés depuis la même spec le jour venu ; tests de contrat snapshotés en CI, toute rupture non additive bloque la PR.
- Webhooks entrants : `POST /webhooks/payments/{provider}`, hors versioning client, corps brut conservé.

## Conséquences

### Positives

- Un seul contrat pour tous les clients, documenté automatiquement, testé contre le code.
- Les apps mobiles pourront vivre des mois sans mise à jour.
- Idempotence et pagination par curseur rendent les clients résilients aux réseaux instables.

### Négatives et risques acceptés

- Les écrans riches font parfois plusieurs appels ; les endpoints « écran » corrigent les cas critiques.
- La discipline « additif seulement » demande de la revue : la CI de contrat en est le garde-fou.

### Ce que cette décision interdit

- Supprimer ou renommer un champ dans `/api/v1`.
- Une liste sans pagination.
- Une erreur renvoyée en texte libre ou avec un format non RFC 9457.
- Une server action Next.js qui accède à la base.

## Comment on saura qu'il faut la revoir

- Apparition de clients tiers (partenaires) avec des besoins de requêtes très variés : GraphQL en façade de lecture pourrait alors se justifier.
