#!/usr/bin/env bash
# Exercice de restauration chronométré (Partie 11 : test mensuel automatisé, RTO < 2 h) :
#   1. sauvegarde logique de la source ;
#   2. restauration dans une base jetable ;
#   3. contrôles (migrations, volumétrie, intégrité financière) via restore-check.sql ;
#   4. comparaison des compteurs source / restaurée ;
#   5. rapport (durées, écarts) ; code de sortie ≠ 0 si un écart est constaté.
#
# Usage : ops/db/restore-drill.sh <SOURCE_URL> <TARGET_URL> [rapport.md]
#   TARGET_URL doit pointer vers une base qui peut être écrasée (créée si absente).
set -euo pipefail
SRC="${1:?SOURCE_URL requis}"
DST="${2:?TARGET_URL requis}"
REPORT="${3:-restore-report.md}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

T0=$(date +%s)
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$TMP/src.dump" "$SRC"
T1=$(date +%s)

# Base cible : (re)création. L'URL d'administration est la même avec la base `postgres`.
DB_NAME="$(echo "$DST" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
ADMIN_URL="$(echo "$DST" | sed -E "s#/$DB_NAME(\?.*)?\$#/postgres\1#")"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE);" -c "CREATE DATABASE \"$DB_NAME\";"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$DST" "$TMP/src.dump"
T2=$(date +%s)

psql "$SRC" -v ON_ERROR_STOP=1 -At -F $'\t' -f "$HERE/restore-check.sql" > "$TMP/src.txt"
psql "$DST" -v ON_ERROR_STOP=1 -At -F $'\t' -f "$HERE/restore-check.sql" > "$TMP/dst.txt"
T3=$(date +%s)

DIFF=$(diff "$TMP/src.txt" "$TMP/dst.txt" || true)
{
  echo "# Exercice de restauration — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "| Étape | Durée |"
  echo "| --- | --- |"
  echo "| Sauvegarde logique | $((T1-T0)) s |"
  echo "| Restauration | $((T2-T1)) s |"
  echo "| Contrôles | $((T3-T2)) s |"
  echo "| **Total (RTO mesuré, hors bascule applicative)** | **$((T3-T0)) s** |"
  echo
  echo "## Contrôles (base restaurée)"
  echo
  echo '```'
  cat "$TMP/dst.txt"
  echo '```'
  echo
  if [ -z "$DIFF" ]; then
    echo "✅ Aucun écart entre la source et la base restaurée."
  else
    echo "❌ Écarts source / restaurée :"
    echo '```'
    echo "$DIFF"
    echo '```'
  fi
} > "$REPORT"
cat "$REPORT"
[ -z "$DIFF" ]
