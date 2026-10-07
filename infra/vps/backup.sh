#!/bin/sh
# Sauvegarde logique nocturne de PostgreSQL, chiffrée (AES-256, phrase secrète BACKUP_PASSPHRASE), avec empreinte
# SHA-256 et rotation. Tourne dans le conteneur `backup` (image postgres:16-alpine : pg_dump + openssl présents).
#
#   polaris-backup once   → une sauvegarde maintenant
#   polaris-backup loop   → une sauvegarde par jour à BACKUP_HOUR_UTC (défaut 01 h UTC = 02 h à Porto-Novo)
#
# Restauration (voir docs/runbooks/deploy-vps.md) :
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in X.dump.enc -out X.dump
#   pg_restore --clean --if-exists --no-owner --no-privileges -d "$PGURL" X.dump
set -eu
OUT=/backups
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_HOUR_UTC:-01}"

backup_once() {
  : "${PGURL:?PGURL requis}"
  : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE requis}"
  mkdir -p "$OUT"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  tmp="$OUT/.polaris-$stamp.dump"
  file="$OUT/polaris-$stamp.dump.enc"
  start=$(date +%s)
  pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$tmp" "$PGURL"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$tmp" -out "$file"
  rm -f "$tmp"
  sha256sum "$file" > "$file.sha256"
  end=$(date +%s)
  echo "✔ $(date -u +%FT%TZ) sauvegarde $(basename "$file") ($(du -h "$file" | cut -f1)) en $((end-start)) s"
  find "$OUT" -name 'polaris-*.dump.enc*' -mtime +"$KEEP_DAYS" -delete
  # Un dump vide ou minuscule est suspect : on le signale (la revue quotidienne lit ce journal).
  size=$(stat -c %s "$file" 2>/dev/null || wc -c < "$file")
  [ "$size" -gt 10000 ] || echo "✖ sauvegarde anormalement petite ($size octets)"
}

case "${1:-once}" in
  once) backup_once ;;
  loop)
    echo "sauvegarde quotidienne à ${HOUR}h UTC, rotation ${KEEP_DAYS} jours"
    while true; do
      now_h=$(date -u +%H)
      if [ "$now_h" = "$HOUR" ] && [ ! -f "$OUT/.done-$(date -u +%F)" ]; then
        backup_once && touch "$OUT/.done-$(date -u +%F)" || echo "✖ échec de la sauvegarde $(date -u +%FT%TZ)"
        find "$OUT" -name '.done-*' -mtime +2 -delete
      fi
      sleep 300
    done
    ;;
  *) echo "usage : polaris-backup once|loop" >&2; exit 2 ;;
esac
