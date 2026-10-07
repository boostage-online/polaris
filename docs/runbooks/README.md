# Runbooks

Un runbook par situation opérationnelle : symptômes, vérifications, actions, escalade. À maintenir à chaque incident (post-mortem) et à chaque alerte ajoutée.

| Runbook                                    | Quand                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| [deploy-rollback.md](./deploy-rollback.md) | Déployer en staging/production, revenir en arrière                     |
| [database-roles.md](./database-roles.md)   | Créer la base, les rôles PostgreSQL, les droits (nouvel environnement) |
| [restore.md](./restore.md)                 | Restaurer une sauvegarde, test de restauration mensuel                 |
| [rotate-secrets.md](./rotate-secrets.md)   | Tourner les clés JWT, secrets webhook, mots de passe DB                |
| [incident.md](./incident.md)               | Déclarer, gérer et clôturer un incident                                |
