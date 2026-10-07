# Déploiement et rollback

## Principes (Partie 14 du document directeur)

- Une image Docker par processus (`api`, `worker`), construite **une fois** sur `main`, promue telle quelle en production sur un tag `vX.Y.Z`.
- Les migrations sont **expand only** au moment du déploiement : le code N−1 fonctionne sur le schéma N. Un `contract` (`DROP`, `RENAME`) n'est appliqué qu'une release après, marqué `-- contract` dans le fichier SQL.
- Fenêtre interdite en production : 7h–9h heure locale des établissements (pic d'appels).

## Staging (automatique à chaque merge sur `main`)

1. CI verte (`quality`, `test`), images poussées sur GHCR taguées `sha`.
2. Migration : `docker run --rm -e DATABASE_URL_PLATFORM=… ghcr.io/<org>/<repo>/api:<sha> node dist/database/migrate.js up`
3. Déploiement rolling `api` (≥ 2 instances) puis `worker` (drainage des jobs en cours : BullMQ attend la fin des jobs actifs à l'arrêt).
4. Smoke : `curl -f $URL/api/v1/health/ready` doit renvoyer `{"status":"ok","checks":{"database":true,"redis":true,"migrations":true}}`.

## Production (tag)

```bash
git tag v1.4.0 && git push origin v1.4.0
```

Le workflow `deploy-production` promeut l'image `sha` du commit tagué. Avant de taguer : staging stable ≥ 24 h, changelog relu, décision écrite dans le canal `#deploy`.

## Rollback

```bash
# 1. Redéployer l'image précédente (aucune reconstruction)
<commande PaaS> deploy api  --image ghcr.io/<org>/<repo>/api:<sha-precedent>
<commande PaaS> deploy worker --image ghcr.io/<org>/<repo>/worker:<sha-precedent>
# 2. Ne PAS annuler la migration expand : le code précédent l'ignore.
# 3. Vérifier /health/ready et les métriques 5xx pendant 10 minutes.
```

Un `migrate down` n'est utilisé qu'en développement/CI, jamais en production sur une migration déjà exploitée.

## Vérifications après déploiement

- `polaris_http_errors_total` stable, p95 < 400 ms sur 10 min.
- File `domain-events` drainée (`âge du plus vieux job` < 1 min).
- Une connexion réelle (compte de test) et un `GET /me`.
