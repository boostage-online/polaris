#!/usr/bin/env bash
# Sauvegarde logique PostgreSQL (format custom, compressée) + empreinte SHA-256.
# Complète les snapshots/PITR du service managé (RPO 5 min) : sert aux exercices de restauration,
# aux copies hors région et aux exports de résiliation d'un environnement complet.
#
# Usage : ops/db/backup.sh <DATABASE_URL> [dossier de sortie]   (variables : BACKUP_KEEP_DAYS, défaut 35)
set -euo pipefail
URL="${1:?DATABASE_URL requis}"
OUT="${2:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-35}"
mkdir -p "$OUT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT/polaris-$STAMP.dump"
START=$(date +%s)
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$FILE" "$URL"
sha256sum "$FILE" > "$FILE.sha256"
END=$(date +%s)
SIZE=$(du -h "$FILE" | cut -f1)
echo "✔ sauvegarde $FILE ($SIZE) en $((END-START)) s — empreinte $(cut -d' ' -f1 "$FILE.sha256")"
# Rotation locale (les copies distantes ont leur propre politique : 35 jours + hebdo hors région).
find "$OUT" -name 'polaris-*.dump*' -mtime +"$KEEP_DAYS" -delete
