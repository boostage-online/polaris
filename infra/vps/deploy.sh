#!/usr/bin/env bash
# Déploiement d'une version sur le VPS : tire les images, migre (expand), redémarre api/worker/web, vérifie.
# Appelé par GitHub Actions (job « Déploiement VPS ») ou à la main : bash /opt/polaris/deploy.sh <sha|main>
# Rollback : bash /opt/polaris/deploy.sh <sha précédent>  (les migrations sont expand-only : pas de down en prod).
set -euo pipefail
cd /opt/polaris
TAG="${1:-main}"
export POLARIS_TAG="$TAG"
echo "→ déploiement de $TAG ($(date -u +%FT%TZ))"

# Fenêtre interdite 7h–9h heure locale (appels du matin) sauf FORCE_DEPLOY=1.
H=$(TZ=Africa/Porto-Novo date +%H)
if [ "${FORCE_DEPLOY:-0}" != "1" ] && [ "$H" -ge 7 ] && [ "$H" -lt 9 ]; then
  echo "✖ fenêtre 7h–9h (heure de Porto-Novo) : déploiement refusé (FORCE_DEPLOY=1 pour passer outre)"; exit 3
fi

docker compose pull -q api worker web
# Sauvegarde avant migration (rapide : quelques secondes sur les volumes des pilotes).
docker compose run --rm --entrypoint /bin/sh backup -c 'command -v openssl >/dev/null || apk add --no-cache openssl >/dev/null; /usr/local/bin/polaris-backup once' || echo "⚠ sauvegarde pré-déploiement en échec (on continue : les migrations sont expand-only)"
# Migration expand avec le rôle propriétaire ; les anciennes instances continuent de tourner pendant ce temps.
docker compose run --rm --no-deps api node dist/database/migrate.js up
# Rolling : api puis worker puis web ; le healthcheck de l'API conditionne le worker.
docker compose up -d --no-deps --wait api
docker compose up -d --no-deps worker web
# Nettoyage des images de plus de 2 versions.
docker image prune -f --filter "until=168h" >/dev/null || true
# Smoke : via Caddy (HTTPS public) si le domaine répond, sinon en interne.
set +e
APP_DOMAIN=$(grep -E '^APP_DOMAIN=' .env | cut -d= -f2-)
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://${APP_DOMAIN}/api/v1/health/ready")
set -e
if [ "$code" = "200" ]; then
  echo "✔ https://${APP_DOMAIN}/api/v1/health/ready → 200"
else
  echo "⚠ santé publique : HTTP ${code:-?} ; vérification interne…"
  docker compose exec -T api wget -qO- http://127.0.0.1:4000/api/v1/health/ready
fi
# Trace de la version déployée (lue par le runbook et la revue quotidienne).
echo "$(date -u +%FT%TZ) $TAG" >> deployments.log
echo "✔ $TAG déployé"
