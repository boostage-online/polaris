# Alertes de supervision

Le worker évalue toutes les 5 minutes (`platform-alerts`) un jeu de conditions et tient la table `platform_alerts`. Une alerte **s'ouvre** quand la condition apparaît, **se résout seule** quand elle disparaît, et prévient par e-mail les administrateurs plateforme à l'ouverture puis toutes les 6 h tant qu'elle n'est ni résolue ni acquittée. Vue : Plateforme → **Alertes** (acquitter, évaluer maintenant). Seuils : `ALERT_THRESHOLDS` (`platform-alerts.service.ts`).

| Clé                              | Sévérité           | Condition                                             | Que faire                                                                                                                                              |
| -------------------------------- | ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `redis:down`                     | CRITICAL           | `PING` Redis en échec                                 | Vérifier le service Redis (PaaS). Sans Redis : files à l'arrêt, limiteurs en fail-open, sessions toujours valides. Incident S1 si > 5 min.             |
| `outbox:lag`                     | WARNING / CRITICAL | plus ancien événement non publié > 5 min / > 15 min   | Le relais outbox (worker) est arrêté ou saturé : vérifier les journaux du worker, redémarrer ; les événements sont rejoués automatiquement.            |
| `queue:<nom>:waiting`            | WARNING            | un job attend depuis > 10 min                         | Worker arrêté ou bloqué sur un job long : journaux, redémarrage ; vérifier la concurrence de la file.                                                  |
| `dlq:<nom>`                      | CRITICAL           | file d'échec non vide                                 | Ouvrir le job en DLQ (identifiant, erreur) ; corriger la cause ; rejouer ou supprimer en le documentant. Paiements : voir `provider-offline.md`.       |
| `tenant:<id>:stale-reports`      | WARNING            | agrégats non rafraîchis depuis > 20 min               | Cron `reports-refresh` : journaux du worker (« reports refresh failed », requête en erreur ?). `POST /reports/refresh` pour forcer.                    |
| `tenant:<id>:review-open`        | WARNING            | transactions `UNKNOWN` en revue depuis > 1 h          | L'établissement doit traiter « Transactions en attente » (finance). Relancer par e-mail le gestionnaire ; voir `provider-offline.md` si massif.        |
| `tenant:<id>:sms-cap`            | WARNING / CRITICAL | ≥ 90 % / 100 % du plafond mensuel de SMS              | Voir `sms-quota.md`.                                                                                                                                   |
| `tenant:<id>:scheduled-reports`  | WARNING            | rapport planifié en erreur dans les 24 h              | `last_error` dans Rapports → Rapports planifiés ; souvent une adresse e-mail invalide ou le fournisseur e-mail.                                        |
| `tenant:<id>:ledger-integrity`   | CRITICAL           | écarts d'intégrité du grand-livre au dernier contrôle | **Ne rien clôturer**. Comparer soldes stockés et écritures (`ledger_integrity_checks.details`), ouvrir un incident S1 si des paiements sont concernés. |
| `tenant:<id>:circuit:<provider>` | WARNING            | disjoncteur provider ouvert                           | Voir `provider-offline.md`.                                                                                                                            |
| `notifications:failed`           | WARNING            | ≥ 20 notifications en échec dans l'heure              | Fournisseur SMS/e-mail en panne ou crédits épuisés : journal des notifications, renvoi manuel une fois rétabli.                                        |

## Acquittement

Acquitter une alerte = « je m'en occupe » : plus de rappel e-mail, l'alerte reste ouverte jusqu'à la disparition de la condition. L'acquittement est nominatif.

## Ajouter une condition

1. Ajouter la condition dans `PlatformAlertsService.collect()` (clé stable, sévérité, titre lisible, détail JSON).
2. Documenter la ligne ci-dessus (que faire).
3. Couvrir par un test dans `test/hardening.test.ts` (ouverture → résolution).
