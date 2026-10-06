#!/usr/bin/env bash
# Exécute une étape CI, capture sa sortie et, en cas d'échec, publie les dernières lignes en
# commentaire de la pull request (les journaux bruts d'Actions ne sont pas lisibles depuis
# l'assistant de développement). Usage : run-step.sh "<nom>" <commande...>
set -o pipefail
name="$1"; shift
log="$(mktemp)"
echo "::group::$name"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
echo "::endgroup::"
if [ "$status" -ne 0 ]; then
  echo "::error title=$name::échec (code $status) — extrait publié en commentaire de PR"
  if [ -n "${PR_NUMBER:-}" ] && [ -n "${GITHUB_TOKEN:-}" ]; then
    excerpt="$(grep -v -E '^\s*$' "$log" | tail -n 160 | cut -c1-400)"
    body="$(printf '### ❌ %s — job `%s`\n\nRun : %s/%s/actions/runs/%s\n\n<details><summary>Dernières lignes</summary>\n\n```text\n%s\n```\n\n</details>' \
      "$name" "${GITHUB_JOB:-?}" "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID" "$excerpt")"
    jq -n --arg body "$body" '{body: $body}' > "$log.json"
    curl -sS -o /dev/null -X POST \
      -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
      "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" --data @"$log.json" || true
  fi
fi
exit "$status"
