# ADR-0003 — Outbox transactionnel + Redis/BullMQ pour l'asynchrone

- **Statut** : Proposée
- **Date** : 2026-10-06
- **Décideurs** : lead technique
- **Références** : document directeur Parties 3, 5, 12 ; ADR-0001

## Contexte et problème

Plusieurs effets métier doivent se produire **après** une transaction validée, sans ralentir la requête et sans jamais être perdus : notifications aux parents après un appel, génération du reçu et notification après un paiement, recalcul des statistiques, rappels d'échéances. Publier un message dans une file _depuis_ le code applicatif crée une fenêtre entre le `COMMIT` et le `publish` où un crash perd l'événement (ou, dans l'autre ordre, publie un événement pour une transaction annulée).

Il faut aussi des jobs planifiés (réconciliation des paiements toutes les 5 minutes, génération des séances, rappels quotidiens) et des retries avec backoff.

## Options envisagées

1. **Publication directe** dans Redis/BullMQ depuis le service, après commit — simple, mais perd des événements au crash.
2. **Transactional outbox** : l'événement est écrit dans une table `outbox_events` dans la même transaction que l'état métier ; un relais le pousse ensuite vers une file.
3. **Event sourcing** — l'état est dérivé des événements ; puissant, mais inutile ici et coûteux pour une petite équipe.
4. **Kafka / RabbitMQ** comme bus — robustes, mais un service de plus à opérer pour des besoins de routage simples.
5. **pg-boss** (file dans PostgreSQL) — zéro infra supplémentaire ; à garder en alternative si l'on veut supprimer Redis.

## Décision

- **Outbox transactionnel** : tout événement métier (`AttendanceSheetSubmitted`, `PaymentSucceeded`…) est inséré dans `outbox_events` dans la transaction du cas d'usage. Un relais (poller court + `LISTEN/NOTIFY`) publie les lignes non publiées vers BullMQ et marque `published_at`. Purge après 7 jours.
- **Redis 7 + BullMQ** pour les files (`domain-events`, `payments`, `notif-sms`, `notif-email`, `notif-push`, `notif-inapp`, `reports`), les jobs planifiés (répétables) et les delayed jobs (rappels). Redis sert aussi de cache des permissions et de stockage du rate limiting.
- **Handlers idempotents** : chaque consommateur enregistre `(handler, event_id)` dans `processed_events` ; un doublon sort sans effet.
- **Retry** : 5 tentatives avec backoff exponentiel par défaut ; échec définitif → file dead-letter dédiée + alerte. Les jobs de paiement ont leur propre file et leur propre DLQ.
- **Pas d'event sourcing** : les événements sont des notifications ; la vérité est dans les tables.
- Le worker (`apps/worker`) est le seul à consommer ; l'API ne fait que produire.

## Conséquences

### Positives

- Un événement est publié si et seulement si la transaction est validée (at-least-once garanti par l'outbox, exactly-once-effect par l'idempotence des handlers).
- Aucune requête utilisateur n'attend un SMS ou un appel provider.
- Retry, backoff, delayed jobs et planification sont fournis par BullMQ, maîtrisable par tout développeur Node.

### Négatives et risques acceptés

- Latence de quelques centaines de millisecondes entre le commit et le traitement (acceptable : le délai cible appel → notification est de 2 minutes).
- Redis est un composant de plus (managé) ; sa perte n'entraîne aucune perte de données puisque l'outbox et la réconciliation rejouent.
- Le relais est un point à surveiller (métrique « plus vieil événement non publié »).

### Ce que cette décision interdit

- Appeler un service externe (SMS, provider de paiement, e-mail) à l'intérieur d'une transaction de base de données.
- Publier directement dans BullMQ depuis un cas d'usage métier (hors relais).
- Un handler non idempotent.

## Comment on saura qu'il faut la revoir

- Besoin de routage complexe, de fan-out massif ou de rétention longue des événements (Kafka deviendrait pertinent).
- Volonté de supprimer Redis pour simplifier l'infra (migrer vers pg-boss).
- Plus de 1 000 événements par seconde en pointe soutenue.
