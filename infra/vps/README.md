# Déploiement sur un VPS (Hostinger KVM, Ubuntu 24.04)

Tout ce dossier est copié dans `/opt/polaris` sur le serveur. Le pas-à-pas complet (commande du VPS, DNS, installation, variables GitHub, premier administrateur, mise à jour, rollback, restauration, sauvegardes hors site) est dans **`docs/runbooks/deploy-vps.md`**.

| Fichier                     | Rôle                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `install.sh`                | Installation complète d'un serveur neuf en une commande (Docker, pare-feu, secrets, premier démarrage) |
| `docker-compose.yml`        | caddy, web, api, worker, postgres, redis, backup, offsite (profil)                                     |
| `Caddyfile`                 | HTTPS automatique ; `/api/*` → API, le reste → web                                                     |
| `.env.example`              | Variables commentées ; `install.sh` génère les secrets dans `.env`                                     |
| `postgres-init/01-roles.sh` | Rôles `polaris_app` (sans BYPASSRLS) et `polaris_platform` à la création du volume                     |
| `deploy.sh`                 | Mise à jour d'une version (pull, sauvegarde, migration expand, rolling, smoke) — appelé par la CI      |
| `backup.sh`                 | Sauvegarde nocturne chiffrée, rotation, mode `once` / `loop`                                           |

Une seule origine (`https://app.votre-domaine`) sert les pages et l'API : l'image web est construite avec `NEXT_PUBLIC_API_URL` vide (appels relatifs `/api/v1`), ce qui rend les cookies, la CSP et l'anti-CSRF plus simples et plus sûrs.
