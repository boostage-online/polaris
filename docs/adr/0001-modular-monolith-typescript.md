# ADR-0001 — Modular monolith TypeScript (NestJS + Next.js) dans un monorepo

- **Statut** : Proposée
- **Date** : 2026-10-06
- **Décideurs** : lead technique, product owner
- **Références** : document directeur Parties 3, 4, 5 ; ADR-0003

## Contexte et problème

Polaris doit être construit et maintenu pendant au moins cinq ans par une équipe de 2 à 5 développeurs, sans équipe d'exploitation dédiée au départ. Le produit a onze domaines métier identifiés (tenancy, identité, académique, élèves/tuteurs, assiduité, billing, payments, notifications, reporting, audit, plateforme) qui partagent beaucoup de données (un paiement référence un élève qui référence un groupe) et doivent rester fortement cohérents (un appel soumis doit déclencher des notifications sans perte ; un paiement confirmé doit être alloué dans la même transaction).

Le même backend doit servir le web aujourd'hui et des apps mobiles plus tard. La volumétrie cible à trois ans (~200 établissements, ~150 000 élèves, ~5 M d'enregistrements d'assiduité par an) est modeste pour une base relationnelle unique.

## Options envisagées

1. **Microservices** (un service par domaine, communication HTTP/événements) — isolation forte, mais 11 déploiements, transactions distribuées pour les cas les plus critiques (paiement → allocation → reçu), et une charge d'exploitation hors de portée de l'équipe.
2. **Monolithe classique** (couches techniques `controllers/services/repositories` sans frontières métier) — rapide au début, mais les dépendances entre domaines deviennent invisibles et le code finance se mélange au code assiduité en dix-huit mois.
3. **Modular monolith** : un seul déployable (en deux processus, API et worker), découpé en modules métier avec API publique explicite, dépendances entre modules vérifiées par l'outillage, communication montante par événements.
4. Backend dans un autre langage (Laravel, Django) avec frontend React — deux écosystèmes, types dupliqués entre front et back.

## Décision

Nous retenons le **modular monolith TypeScript** :

- **Backend NestJS** (Node LTS pair), un module NestJS par domaine métier, structure interne `controllers/ · application/ · domain/ · infrastructure/ · events/ · index.ts`.
- **Frontend Next.js** (App Router) qui consomme l'API via un SDK TypeScript généré depuis OpenAPI ; aucune server action ne touche la base.
- **Deux processus** à partir du même code : `apps/api` (HTTP) et `apps/worker` (BullMQ, crons).
- **Monorepo pnpm + Turborepo** : `apps/api`, `apps/web`, `apps/worker`, `packages/contracts` (schémas zod, types, SDK), `packages/ui`, `packages/config`.
- **Règle de couches** vérifiée en CI (dependency-cruiser) : Socle (Tenancy, Identity, Platform, Audit, Shared) ← Référentiels (Academic, StudentsGuardians) ← Métier cœur (Attendance, Billing, Payments) ← Transverse (Notifications, Reporting). Un module n'importe que des modules des couches inférieures et ne communique vers le haut que par événements.
- Dépendances explicitement interdites : Payments → Academic/Attendance ; Billing → Payments ; tout module → Notifications/Reporting ; `domain/` → NestJS, Drizzle, HTTP.

## Conséquences

### Positives

- Un seul langage, des types partagés front/back, un seul pipeline, un seul déploiement à comprendre.
- Les transactions critiques (paiement + allocation + outbox) restent locales et ACID.
- Les frontières de modules sont de vraies frontières (API publique `index.ts`, lint) : extraire un module en service séparé plus tard reste possible, sans l'avoir payé d'avance.
- Le worker scale indépendamment de l'API.

### Négatives et risques acceptés

- La discipline des frontières repose sur l'outillage et la revue : sans dependency-cruiser en CI bloquante, le monolithe redevient un plat de spaghettis.
- Un bug mémoire ou une boucle infinie dans un module affecte tout le processus (atténué par deux instances API et un worker séparé).
- Une seule base : la volumétrie extrême d'un tenant est gérée par index et partitionnement, pas par isolation physique (voir ADR-0002).

### Ce que cette décision interdit

- Créer un service déployé séparément pour un domaine métier sans ADR qui le justifie par un signal mesuré.
- Importer une classe interne d'un autre module (seul `index.ts` est importable).
- Mettre de la logique métier dans le frontend ou dans des handlers HTTP.

## Comment on saura qu'il faut la revoir

- Un module nécessite une technologie incompatible avec Node (ex. calcul lourd) ou un cycle de déploiement radicalement différent.
- Plus de 15 développeurs travaillent sur le même dépôt avec des conflits quotidiens.
- Le temps de build/test CI dépasse 25 minutes malgré le cache Turborepo.
