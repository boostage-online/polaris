#!/bin/sh
# Exécuté une seule fois à la création du volume PostgreSQL : rôles applicatifs (ADR-0002).
#   polaris_app      : API et worker, SANS BYPASSRLS (l'isolation entre établissements repose dessus)
#   polaris_platform : module Platform, relais outbox, requêtes transverses — BYPASSRLS
# Les mots de passe viennent de .env (POSTGRES_APP_PASSWORD, POSTGRES_PLATFORM_PASSWORD).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE polaris_app LOGIN PASSWORD '$POSTGRES_APP_PASSWORD' NOBYPASSRLS;
CREATE ROLE polaris_platform LOGIN PASSWORD '$POSTGRES_PLATFORM_PASSWORD' BYPASSRLS;
SQL
echo "✔ rôles polaris_app (sans BYPASSRLS) et polaris_platform créés"
