#!/usr/bin/env bash
# Installation d'un VPS neuf (Ubuntu 24.04, root) pour Polaris — une seule commande, idempotente :
#
#   curl -fsSL https://raw.githubusercontent.com/boostage-online/polaris/main/infra/vps/install.sh \
#     | bash -s -- app.exemple.bj ops@exemple.bj admin@exemple.bj
#
#   1. domaine de l'application (DNS A déjà pointé vers ce serveur, ou à pointer juste après)
#   2. e-mail Let's Encrypt
#   3. e-mail du premier administrateur plateforme (mot de passe affiché à la fin, une seule fois)
#   4. (facultatif) clé SSH publique de la CI ; sinon une paire est générée ICI et la clé privée est affichée
#      une seule fois, à coller dans le secret GitHub VPS_SSH_KEY (rien ne transite par les journaux publics d'Actions)
#
# Ce que fait le script : Docker Engine, pare-feu (22/80/443), fail2ban, mises à jour de sécurité automatiques,
# swap 2 Go, utilisateur `polaris`, /opt/polaris avec compose + secrets générés, premier démarrage, migrations,
# premier administrateur. Relancer le script ne régénère pas les secrets existants.
set -euo pipefail
# Tout le script est une fonction : avec `curl | bash`, bash l'a lue en entier avant d'exécuter quoi que ce soit
# (les commandes qui lisent l'entrée standard ne peuvent pas « manger » la suite du script).
main() {
DOMAIN="${1:?domaine requis}"; ACME_EMAIL="${2:?e-mail Let’s Encrypt requis}"
ADMIN_EMAIL="${3:?e-mail du premier administrateur requis}"; CI_KEY="${4:-}"
REPO="${POLARIS_REPO:-boostage-online/polaris}"; BRANCH="${POLARIS_BRANCH:-main}"
[ "$(id -u)" = 0 ] || { echo "à lancer en root"; exit 1; }
. /etc/os-release; [ "${ID:-}" = ubuntu ] || echo "⚠ testé sur Ubuntu 24.04 (ici : ${PRETTY_NAME:-?})"

echo "→ paquets de base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg ufw fail2ban unattended-upgrades rsync openssl jq

if ! command -v docker >/dev/null; then
  echo "→ Docker Engine"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q && apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" }, "live-restore": true }
JSON
systemctl enable --now docker; systemctl reload docker || true

if ! swapon --show | grep -q '^'; then
  echo "→ swap 2 Go"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null; echo 'vm.swappiness=10' > /etc/sysctl.d/90-polaris.conf
fi

echo "→ utilisateur polaris et clé de la CI"
id polaris >/dev/null 2>&1 || useradd -m -s /bin/bash -G docker polaris
install -d -m 700 -o polaris -g polaris /home/polaris/.ssh
touch /home/polaris/.ssh/authorized_keys
CI_PRIVATE=""
if [ -z "$CI_KEY" ]; then
  if ! grep -q 'ci@polaris' /home/polaris/.ssh/authorized_keys; then
    KEYF=$(mktemp -u); ssh-keygen -q -t ed25519 -N '' -C 'ci@polaris' -f "$KEYF"
    CI_KEY=$(cat "$KEYF.pub"); CI_PRIVATE=$(cat "$KEYF"); rm -f "$KEYF" "$KEYF.pub"
  fi
fi
[ -z "$CI_KEY" ] || grep -qF "$CI_KEY" /home/polaris/.ssh/authorized_keys || echo "$CI_KEY" >> /home/polaris/.ssh/authorized_keys
chmod 600 /home/polaris/.ssh/authorized_keys; chown -R polaris:polaris /home/polaris/.ssh

echo "→ pare-feu, fail2ban, mises à jour automatiques"
ufw --force reset >/dev/null; ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
# Mot de passe SSH désactivé seulement si une clé root existe (sinon on se verrouillerait dehors).
if [ -s /root/.ssh/authorized_keys ]; then
  sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
  systemctl reload ssh || systemctl reload sshd || true
fi

echo "→ /opt/polaris (compose, Caddyfile, scripts) depuis ${REPO}@${BRANCH}"
install -d -o polaris -g polaris /opt/polaris /opt/polaris/backups
TMP=$(mktemp -d)
curl -fsSL "https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}" | tar -xz -C "$TMP"
rsync -a --exclude '.env' --exclude 'README.md' "$TMP"/*/infra/vps/ /opt/polaris/
rm -rf "$TMP"; chown -R polaris:polaris /opt/polaris; chmod +x /opt/polaris/*.sh /opt/polaris/postgres-init/*.sh

cd /opt/polaris
if [ ! -f .env ]; then
  echo "→ génération des secrets"
  gen() { openssl rand -base64 32 | tr -d '\n='; }
  # Mots de passe PostgreSQL : alphabet sans caractères réservés dans une URL.
  genurl() { openssl rand -base64 32 | tr -d '\n=' | tr '+/' '-_'; }
  JWT=$(docker run --rm "ghcr.io/${REPO}/api:${BRANCH}" node dist/cli/generate-keys.js)
  cp .env.example .env
  set_var() { sed -i "s|^$1=.*|$1=$2|" .env; }
  set_var APP_DOMAIN "$DOMAIN"; set_var ACME_EMAIL "$ACME_EMAIL"; set_var GHCR_REPOSITORY "$REPO"; set_var POLARIS_TAG "$BRANCH"
  set_var POSTGRES_OWNER_PASSWORD "$(genurl)"; set_var POSTGRES_APP_PASSWORD "$(genurl)"; set_var POSTGRES_PLATFORM_PASSWORD "$(genurl)"
  set_var RECEIPT_SECRET "$(gen)"; set_var PAYMENT_MASTER_KEY "$(gen)"; set_var APP_MASTER_KEY "$(gen)"; set_var BACKUP_PASSPHRASE "$(gen)"
  # Les JWK contiennent des guillemets : on les écrit entre apostrophes.
  while IFS= read -r line; do
    k=${line%%=*}; v=${line#*=}
    [ -n "$k" ] && sed -i "s|^$k=.*|$k=$v|" .env
  done <<< "$JWT"
  chmod 600 .env; chown polaris:polaris .env
  echo "   secrets écrits dans /opt/polaris/.env — SAUVEGARDEZ BACKUP_PASSPHRASE hors du serveur"
else
  echo "   .env existant conservé"
fi

echo "→ premier démarrage"
sudo -u polaris docker compose pull -q
sudo -u polaris docker compose up -d --wait postgres redis
sudo -u polaris docker compose run --rm --no-deps api node dist/database/migrate.js up
sudo -u polaris docker compose up -d --wait api
sudo -u polaris docker compose up -d
(crontab -u polaris -l 2>/dev/null | grep -v 'docker system prune'; echo '30 4 * * 0 docker system prune -f --filter until=336h >/dev/null 2>&1') | crontab -u polaris -

echo "→ premier administrateur plateforme"
sudo -u polaris docker compose run --rm --no-deps api node dist/cli/bootstrap-admin.js "$ADMIN_EMAIL" "Administrateur plateforme"

IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
cat <<MSG

✔ Polaris est installé.
   DNS : enregistrement A  ${DOMAIN} → ${IP}  (Caddy obtient le certificat dès que le DNS répond ; il réessaie seul)
   Application : https://${DOMAIN}        État public : https://${DOMAIN}/status
   Santé : curl -fsS https://${DOMAIN}/api/v1/health/ready
   Journaux : cd /opt/polaris && docker compose logs -f --tail=100 api worker
   Déploiements automatiques : variables GitHub VPS_HOST=${IP}, APP_DOMAIN=${DOMAIN} ; secret VPS_SSH_KEY (clé privée de la CI)
   Sauvegardes : /opt/polaris/backups (chiffrées) — activer la copie hors site : docker compose --profile offsite up -d
   Suite : docs/runbooks/deploy-vps.md
MSG
if [ -n "$CI_PRIVATE" ]; then
  cat <<MSG

➜ Clé privée de la CI (affichée UNE SEULE FOIS, nulle part ailleurs) : copiez tout le bloc, y compris les lignes
  BEGIN/END, dans GitHub → Settings → Secrets and variables → Actions → New repository secret → VPS_SSH_KEY.
  Perdue ? Relancez le script sans 4e argument après avoir retiré la ligne « ci@polaris » de /home/polaris/.ssh/authorized_keys.

$CI_PRIVATE

MSG
fi
}

main "$@" </dev/null
