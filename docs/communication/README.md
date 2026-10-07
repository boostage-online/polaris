# Modèles de communication aux établissements

Modèles à adapter (remplacer les `{…}`), envoyés depuis l'adresse support aux administrateurs des établissements concernés. Règles : dire ce qui est su, ce qui ne l'est pas encore, ce que l'établissement doit faire, et quand aura lieu le prochain message. Pas de jargon technique ; pas de promesse de délai qu'on ne tient pas.

| Modèle                                                   | Déclencheur                                 | Runbook                             |
| -------------------------------------------------------- | ------------------------------------------- | ----------------------------------- |
| [incident-en-cours.md](./incident-en-cours.md)           | incident S1/S2 affectant les établissements | `docs/runbooks/incident.md`         |
| [provider-indisponible.md](./provider-indisponible.md)   | paiement en ligne indisponible > 30 min     | `docs/runbooks/provider-offline.md` |
| [notification-violation.md](./notification-violation.md) | violation de données personnelles confirmée | `docs/runbooks/data-breach.md`      |
| [session-de-support.md](./session-de-support.md)         | demande d'accord avant une impersonation    | `docs/runbooks/impersonation.md`    |
