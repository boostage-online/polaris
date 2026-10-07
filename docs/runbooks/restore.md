# Restauration

Objectifs : **RTO 2 h, RPO 5 min** (PITR). Test de restauration **mensuel**, automatisé, résultat posté dans le canal ops.

## Restaurer dans une base jetable (test mensuel)

1. Depuis la console du service managé : restaurer le snapshot J−1 (ou PITR à `T−1h`) vers une nouvelle instance `polaris-restore-YYYYMMDD`.
2. Vérifier : `psql … -c "select count(*) from tenants; select max(occurred_at) from audit_logs;"`
3. Lancer `pnpm --filter @polaris/api db:status` sur cette instance : toutes les migrations doivent être appliquées.
4. Lancer `ops/db/restore-drill.sh <URL source> <URL base jetable> rapport.md` : sauvegarde logique, restauration, `ops/db/restore-check.sql` (volumétrie, dernières écritures, invariants financiers) exécuté sur la source et la cible, comparaison, **RTO mesuré**. Le même script tourne à chaque run de CI sur la base de test (rapport dans le résumé du job).
5. Supprimer l'instance. Consigner durée et résultat dans `docs/runbooks/exercise-log.md`.

Sauvegarde logique complémentaire (hors région, résiliation) : `ops/db/backup.sh <DATABASE_URL> <dossier>` (format custom compressé, empreinte SHA-256, rotation 35 jours).

## Restauration réelle (incident)

1. Déclarer l'incident (voir `incident.md`), geler les déploiements, passer l'API en lecture seule si possible (`SET default_transaction_read_only` sur le rôle `polaris_app`).
2. Restaurer PITR au dernier instant sain vers une nouvelle instance.
3. Rejouer les événements outbox non publiés (`published_at is null`) : le relais le fait automatiquement au redémarrage du worker.
4. Basculer `DATABASE_URL*` vers la nouvelle instance, redémarrer api et worker, vérifier `/health/ready`.
5. Les paiements : exécuter la réconciliation provider (Phase 5) pour la période perdue.

## Objets S3

Versioning activé : restaurer une version précédente d'un reçu ou d'un justificatif depuis la console. Réplication inter-région pour `receipts/` et `justifications/`.
