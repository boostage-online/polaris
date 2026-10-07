# Tests de charge (k6)

Objectif G7 : **p95 API < 400 ms à 2 000 utilisateurs simultanés**, 0 erreur, webhooks absorbés en rafale.

| Script              | Ce qu'il mesure                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `k6/api.js`         | Parcours de lecture par rôle (enseignant, scolarité, direction, parent) : `/me`, appels du jour, élèves, tableau de bord, rapports, enfants |
| `k6/webhooks.js`    | Rafale de webhooks signés (provider de démonstration) : réponse 200 rapide, traitement en file     |

## Profils

| Profil    | VUs   | Durée | Webhooks/s | Usage                                             |
| --------- | ----- | ----- | ---------- | ------------------------------------------------- |
| `smoke`   | 10    | 45 s  | 10         | CI (`load.yml`, hebdomadaire et à la demande)     |
| `nominal` | 200   | 5 min | 50         | Staging, avant chaque mise en production          |
| `full`    | 2 000 | 10 min| 100        | Staging dimensionné comme la production (G7)      |

## Lancer

```bash
# Prérequis : API démarrée sur $API_URL, base seedée, fichier de seed (identifiants, jeton de webhook).
pnpm --filter @polaris/api db:seed            # SEED_OUTPUT=./apps/api/.test-seed.json pour écrire le fichier
k6 run -e API_URL=https://api-staging.polaris.app -e PROFILE=nominal -e SEED_FILE=./apps/api/.test-seed.json load/k6/api.js
k6 run -e API_URL=https://api-staging.polaris.app -e PROFILE=nominal -e SEED_FILE=./apps/api/.test-seed.json load/k6/webhooks.js
```

Le profil `full` n'a de sens que sur une infrastructure équivalente à la production (taille de la base, Redis, nombre d'instances). Les résultats (p95, p99, erreurs, saturation CPU/DB) sont consignés dans `docs/runbooks/load-log.md` avec la version déployée.

## Lire les résultats

- `http_req_duration` p(95) par `name` : identifier l'endpoint qui dépasse 400 ms ; les requêtes lourdes attendues sont `dashboards.direction` et `reports.run` (agrégats) — si elles dépassent, vérifier la fraîcheur des agrégats et les index (`report_*`).
- `http_req_failed` : tout taux > 1 % est un échec ; distinguer 429 (limiteur, attendu si le profil dépasse `RATE_LIMIT_GLOBAL_PER_MINUTE` par IP : lancer depuis plusieurs machines ou augmenter la limite sur staging) et 5xx (incident).
- Webhooks : la file `payments` doit se vider après la rafale (vue plateforme → Santé technique) ; des jobs en DLQ sont un défaut.
