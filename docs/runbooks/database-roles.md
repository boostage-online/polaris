# Base de données : rôles et droits

Trois rôles de connexion (ADR-0002) :

| Rôle               | Usage                                                                                                         | BYPASSRLS          |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------ |
| `polaris_owner`    | propriétaire du schéma, migrations (`DATABASE_URL_PLATFORM` en local ; en prod, un rôle dédié aux migrations) | n/a (propriétaire) |
| `polaris_app`      | API et worker (`DATABASE_URL`)                                                                                | **non**            |
| `polaris_platform` | module Platform, relais outbox, requêtes transverses listées (`DATABASE_URL_PLATFORM`)                        | oui                |

## Création (nouvel environnement)

```sql
CREATE ROLE polaris_owner LOGIN PASSWORD '<secret>';
CREATE ROLE polaris_app LOGIN PASSWORD '<secret>' NOBYPASSRLS;
CREATE ROLE polaris_platform LOGIN PASSWORD '<secret>' BYPASSRLS;
CREATE DATABASE polaris OWNER polaris_owner;
```

Puis `pnpm db:migrate` avec `DATABASE_URL_PLATFORM` pointant sur `polaris_owner` : la migration 0001 accorde les droits aux deux autres rôles et pose les `DEFAULT PRIVILEGES`.

## Vérifications

```sql
select rolname, rolbypassrls, rolsuper from pg_roles where rolname like 'polaris_%';
-- polaris_app doit être false/false
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename not in (select table_name from rls_exemptions);
```

Le test `test/rls.test.ts` rejoue ces vérifications en CI.
