# Gestion d'incident

## Sévérités

| Niveau | Définition                                                              | Réaction                                                    |
| ------ | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| S1     | Service indisponible, fuite de données suspectée, argent mal alloué     | Réveil immédiat, canal `#incident`, point toutes les 30 min |
| S2     | Fonction majeure dégradée (appel impossible, paiements en échec > 30 %) | Prise en charge < 1 h en heures ouvrées                     |
| S3     | Gêne sans blocage                                                       | Ticket, prochain sprint                                     |

## Déroulé

1. **Déclarer** : message dans `#incident` avec sévérité, symptôme, heure de début, responsable (incident commander).
2. **Stabiliser** : rollback si lié à un déploiement ; bascule de provider par tenant si provider en cause ; passage en lecture seule si intégrité menacée.
3. **Communiquer** : établissements affectés informés sous 1 h pour S1 (modèle de message dans `docs/communication/`), parents via les établissements.
4. **Données personnelles** : si une fuite est possible, notification à l'autorité et aux personnes sous 72 h ; conserver les journaux (ne rien purger).
5. **Clôturer** : post-mortem sans blâme sous 5 jours pour S1/S2 : chronologie, cause racine, ce qui a bien marché, actions datées avec responsable.

## Informations à collecter d'emblée

`trace_id` des requêtes concernées, `attempt_id` des paiements, extraits `audit_logs`, graphiques Grafana (5xx, files, DB), version déployée (`sha`).
