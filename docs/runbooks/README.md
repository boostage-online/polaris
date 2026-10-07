# Runbooks

Un runbook par situation opérationnelle : symptômes, vérifications, actions, escalade. À maintenir à chaque incident (post-mortem) et à chaque alerte ajoutée.

| Runbook                                        | Quand                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| [deploy-rollback.md](./deploy-rollback.md)     | Déployer en staging/production, revenir en arrière                               |
| [database-roles.md](./database-roles.md)       | Créer la base, les rôles PostgreSQL, les droits (nouvel environnement)           |
| [restore.md](./restore.md)                     | Restaurer une sauvegarde, test de restauration mensuel                           |
| [rotate-secrets.md](./rotate-secrets.md)       | Tourner les clés JWT, secrets webhook, mots de passe DB                          |
| [incident.md](./incident.md)                   | Déclarer, gérer et clôturer un incident                                          |
| [data-breach.md](./data-breach.md)             | Fuite de données supposée : confinement, évaluation, notification 72 h, exercice |
| [alerts.md](./alerts.md)                       | Alertes de supervision : signification et action pour chaque clé                 |
| [provider-offline.md](./provider-offline.md)   | Provider de paiement hors ligne ; exercice « provider coupé 1 h »                |
| [sms-quota.md](./sms-quota.md)                 | Quota SMS atteint ou proche                                                      |
| [impersonation.md](./impersonation.md)         | Sessions de support Super Admin : règles, procédure, contrôle                    |
| [onboarding-tenant.md](./onboarding-tenant.md) | Onboarder un établissement en moins de 2 h                                       |
| [astreinte.md](./astreinte.md)                 | Astreinte : plage, rotation, délais, journée type, escalade (Phase 8)            |
| [hypercare.md](./hypercare.md)                 | Revue quotidienne après une mise en production : lecture, seuils, acquittement   |
| [exercise-log.md](./exercise-log.md)           | Journal des exercices (restauration, panne provider, fuite, charge)              |
