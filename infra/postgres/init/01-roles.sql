-- Exécuté une seule fois à la création du volume Postgres (docker compose).
-- En production, ces rôles sont créés par le runbook `docs/runbooks/database-roles.md`.
--
--   polaris_owner : propriétaire du schéma, exécute les migrations (superuser en local uniquement)
--   polaris_app   : rôle applicatif, SANS BYPASSRLS — l'API et le worker se connectent avec lui
--   polaris_platform : BYPASSRLS, réservé au module Platform et aux jobs transverses listés
CREATE ROLE polaris_app LOGIN PASSWORD 'polaris_app' NOBYPASSRLS;
CREATE ROLE polaris_platform LOGIN PASSWORD 'polaris_platform' BYPASSRLS;
CREATE DATABASE polaris_test OWNER polaris_owner;
