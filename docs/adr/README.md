# Architecture Decision Records

Une ADR capture **une** décision, son contexte, les alternatives écartées et ses conséquences. Elle est courte, datée, et ne bouge plus une fois acceptée.

## Index

| # | Titre | Statut | Date |
| --- | --- | --- | --- |
| [0001](./0001-modular-monolith-typescript.md) | Modular monolith TypeScript (NestJS + Next.js) dans un monorepo | Proposée | 2026-10-06 |
| [0002](./0002-postgresql-partage-tenant-id-rls.md) | PostgreSQL unique partagé, `tenant_id` sur chaque table, Row-Level Security en filet | Proposée | 2026-10-06 |
| [0003](./0003-outbox-transactionnel-bullmq.md) | Outbox transactionnel + Redis/BullMQ pour l'asynchrone | Proposée | 2026-10-06 |
| [0004](./0004-modele-academique-unifie.md) | Modèle académique unifié : Programme → Niveau → Groupe, `CourseOffering`, `Session` | Proposée | 2026-10-06 |
| [0005](./0005-modele-financier-dette-paiement.md) | Modèle financier : dette ≠ paiement, échéance = unité d'allocation, tentative ≠ paiement | Proposée | 2026-10-06 |
| [0006](./0006-statuts-assiduite.md) | Statuts d'assiduité : trois statuts + axe d'excuse + durées | Proposée | 2026-10-06 |
| [0007](./0007-rbac-roles-permissions-policies.md) | RBAC : rôles par tenant, catalogue de permissions en code, policies de portée | Proposée | 2026-10-06 |
| [0008](./0008-authentification-maison.md) | Authentification maison : argon2id, JWT court + refresh opaque rotatif, OTP SMS, MFA TOTP | Proposée | 2026-10-06 |
| [0009](./0009-api-rest-v1.md) | API REST `/api/v1`, additive, erreurs RFC 9457, pagination par curseur, idempotency keys | Proposée | 2026-10-06 |
| [0010](./0010-comptes-marchands-option-a.md) | Comptes marchands : Option A (compte provider par établissement), modèle prêt pour l'Option C | Proposée | 2026-10-06 |

## Cycle de vie

`Proposée` → `Acceptée` (revue d'architecture Phase 0, signature du lead et du product owner) → éventuellement `Remplacée par ADR-NNNN` ou `Dépréciée`.

## Créer une ADR

Copier `template.md`, numéroter à la suite, ouvrir une PR dédiée, demander la revue d'au moins un autre développeur et du product owner si la décision a un impact produit.
