# Déployer Polaris sur un VPS (Hostinger KVM 1/2)

Un seul serveur fait tourner toute la plateforme pour les pilotes et la rentrée : Caddy (HTTPS), le site web, l'API, le worker, PostgreSQL 16, Redis, et une sauvegarde nocturne chiffrée copiée hors du serveur. Rien ne se compile sur la machine : elle tire les images publiées par la CI (`ghcr.io/boostage-online/polaris/{api,worker,web}`). Le dossier `infra/vps/` contient tout ; ce runbook est le pas-à-pas. Aucune étape ne demande d'exécuter quoi que ce soit sur un ordinateur personnel : tout se fait depuis le panneau Hostinger (terminal du navigateur) et depuis GitHub.

## 0. Ce qu'il faut avoir

- Un VPS Hostinger **KVM 1** (1 vCPU, 4 Go) ou **KVM 2**, système **Ubuntu 24.04** sans panneau (pas de CyberPanel/Plesk), centre de données européen.
- Un nom de domaine dont vous gérez le DNS (par exemple celui offert avec l'hébergement web) ; l'application vivra sur un sous-domaine, par exemple `app.exemple.bj`.
- Un compte GitHub avec les droits d'administration du dépôt `boostage-online/polaris` (pour les variables et secrets).
- Pour la copie hors site des sauvegardes : un bucket **Cloudflare R2** (10 Go gratuits) ou tout S3, avec un jeton d'accès.

## 1. Clé SSH de la CI

GitHub Actions déploie en se connectant au serveur avec une clé dédiée (utilisateur `polaris`). Vous n'avez rien à générer : le script d'installation (étape 3) crée la paire **sur le serveur**, installe la clé publique, et affiche la clé privée **une seule fois** dans le terminal du navigateur Hostinger — à coller dans le secret GitHub `VPS_SSH_KEY`. Rien ne transite par les journaux (publics) de GitHub Actions. Si vous préférez fournir votre propre clé publique, passez-la en 4e argument du script.

## 2. Commander et préparer le VPS

1. Hostinger → VPS → choisir **Ubuntu 24.04** comme système, région Europe. Quand le panneau propose une **clé SSH**, collez votre propre clé si vous en avez une ; sinon notez le mot de passe root (le script d'installation le désactivera dès qu'une clé root existe).
2. Notez l'**adresse IP** du serveur.
3. Dans le DNS du domaine : enregistrement **A** `app` → IP du VPS (TTL 300). Caddy obtiendra le certificat dès que le DNS répondra ; s'il n'est pas encore propagé, il réessaie seul.

## 3. Installer (une commande, 5 à 8 minutes)

Hostinger → VPS → **Terminal du navigateur** (connexion root), puis :

```bash
curl -fsSL https://raw.githubusercontent.com/boostage-online/polaris/main/infra/vps/install.sh \
  | bash -s -- app.exemple.bj ops@exemple.bj admin@exemple.bj
```

Arguments : le domaine de l'application, l'e-mail de contact Let's Encrypt, l'e-mail du premier administrateur plateforme (et, facultatif, une clé SSH publique pour la CI).

Le script : met le système à jour, installe Docker, le pare-feu (22/80/443), fail2ban, les mises à jour de sécurité automatiques et 2 Go de swap ; crée l'utilisateur `polaris` ; copie `infra/vps/` dans `/opt/polaris` ; **génère tous les secrets** dans `/opt/polaris/.env` (mots de passe PostgreSQL, clés JWT ES256, clés maîtres, phrase de chiffrement des sauvegardes) ; démarre PostgreSQL et Redis, applique les migrations, démarre l'API, le worker, le web et Caddy ; crée le **premier administrateur plateforme** et affiche son mot de passe **une seule fois**.

À la fin : notez le mot de passe de l'administrateur, copiez la **clé privée de la CI** dans le secret GitHub `VPS_SSH_KEY` (étape 4), et **copiez `BACKUP_PASSPHRASE`** (`grep BACKUP_PASSPHRASE /opt/polaris/.env`) dans un gestionnaire de mots de passe hors du serveur — sans elle, les sauvegardes sont illisibles.

Vérifications :

```bash
curl -fsS https://app.exemple.bj/api/v1/health/ready      # {"status":"ok",...}
cd /opt/polaris && docker compose ps                       # tout « healthy » / « running »
docker compose logs --tail=50 api worker
```

Ouvrez `https://app.exemple.bj`, connectez-vous avec l'administrateur créé, et **activez la MFA** immédiatement (Sécurité du compte) : toute route plateforme l'exige.

## 4. Déploiements automatiques depuis GitHub

Dans le dépôt, _Settings → Secrets and variables → Actions_ :

| Type     | Nom           | Valeur                                  |
| -------- | ------------- | --------------------------------------- |
| Variable | `VPS_HOST`    | IP du VPS                               |
| Variable | `APP_DOMAIN`  | `app.exemple.bj`                        |
| Variable | `VPS_USER`    | `polaris` (facultatif, c'est le défaut) |
| Secret   | `VPS_SSH_KEY` | clé privée de la CI (étape 1)           |

Dès lors, chaque fusion dans `main` dont la CI est verte (lint, tests, sécurité, images) déclenche le job **« Déploiement VPS (main) »** : synchronisation de `infra/vps/` vers `/opt/polaris`, puis `deploy.sh <sha>` sur le serveur — pull des images, **sauvegarde**, **migration expand**, redémarrage progressif api → worker → web, vérification de santé publique. Le job est refusé entre **7 h et 9 h** (heure de Porto-Novo), fenêtre des appels du matin ; en cas d'urgence, `FORCE_DEPLOY=1 bash /opt/polaris/deploy.sh <sha>` depuis le serveur.

Tant qu'il n'y a qu'un VPS, **`main` est la production des pilotes**. Un second serveur (staging) pourra reprendre le même dossier ; les tags `v*` serviront alors à promouvoir une image déjà validée.

## 5. Mettre à jour, revenir en arrière

- **Mettre à jour** : fusionner dans `main` ; ou à la main `bash /opt/polaris/deploy.sh main`.
- **Rollback** : `bash /opt/polaris/deploy.sh <sha précédent>` (le SHA d'un commit de `main` ; l'historique est dans `/opt/polaris/deployments.log`). Les migrations sont expand-only : l'ancienne version tourne sur le nouveau schéma.
- **Voir ce qui tourne** : `docker compose ps`, `docker compose images`.

## 6. Sauvegardes et restauration

- **Nocturne** : le conteneur `backup` produit chaque jour à 2 h (heure locale) `/opt/polaris/backups/polaris-<date>.dump.enc` (pg_dump chiffré AES-256) avec son empreinte ; rotation 14 jours. Avant chaque déploiement, une sauvegarde supplémentaire est prise.
- **Hors site (obligatoire avant les pilotes)** : renseigner `RCLONE_*` dans `/opt/polaris/.env` (R2 : endpoint `https://<compte>.r2.cloudflarestorage.com`, jeton avec droit d'écriture sur un bucket privé), puis `cd /opt/polaris && docker compose --profile offsite up -d`. La synchronisation tourne toutes les heures. Vérifier dans le tableau de bord R2 que les fichiers arrivent.
- **Restauration (exercice trimestriel, `docs/runbooks/restore.md`)** sur le serveur :

```bash
cd /opt/polaris && F=backups/polaris-<date>.dump.enc
sha256sum -c "$F.sha256"
set -a; . ./.env; set +a
docker compose run --rm --entrypoint /bin/sh -e BACKUP_PASSPHRASE backup -c \
  "apk add --no-cache openssl >/dev/null; openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in /$F -out /tmp/r.dump \
   && createdb -h postgres -U polaris_owner polaris_restore && pg_restore --no-owner --no-privileges -h postgres -U polaris_owner -d polaris_restore /tmp/r.dump"
# contrôles (ops/db/restore-check.sql), chronométrage (objectif RTO < 2 h), puis bascule ou suppression de polaris_restore
```

- **Snapshots Hostinger** : activer en plus les sauvegardes du VPS dans le panneau (hebdomadaires, payantes selon l'offre) : elles restaurent la machine entière, pas seulement la base.

## 7. Exploitation courante

| Besoin                               | Commande (dans `/opt/polaris`)                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Journaux en direct                   | `docker compose logs -f --tail=200 api worker`                                                                                                                 |
| Redémarrer un service                | `docker compose restart worker`                                                                                                                                |
| Entrer en base (lecture, sur ticket) | `docker compose exec postgres psql -U polaris_owner polaris`                                                                                                   |
| Nouvel administrateur plateforme     | `docker compose run --rm --no-deps api node dist/cli/bootstrap-admin.js x@y.bj`                                                                                |
| Nouvelles clés JWT (rotation)        | `docker run --rm ghcr.io/boostage-online/polaris/api:main node dist/cli/generate-keys.js` puis `.env`, `docker compose up -d api worker` (`rotate-secrets.md`) |
| Espace disque                        | `df -h /` ; `docker system df` ; les images de plus de 2 semaines sont purgées le dimanche                                                                     |
| Mémoire                              | `free -m` ; `docker stats --no-stream`                                                                                                                         |
| Certificat                           | `docker compose logs caddy                                                                                                                                     | grep -i certificate` |

Capacité du KVM 1 : ≈ 2,5 Go utilisés au repos sur 4 Go, un cœur. Si `docker stats` montre l'API ou PostgreSQL durablement au-dessus de 80 % CPU aux heures d'appel, passer en KVM 2 depuis le panneau Hostinger (redimensionnement sans migration), puis ajuster `shared_buffers`/`effective_cache_size` dans `docker-compose.yml`.

## 8. Sécurité du serveur

Pare-feu UFW (22, 80, 443 uniquement), fail2ban sur SSH, mises à jour de sécurité automatiques, SSH par clé seulement, conteneurs non-root, PostgreSQL et Redis non exposés (réseau Docker interne), secrets dans `/opt/polaris/.env` (mode 600). Points à tenir : rotation des secrets (`rotate-secrets.md`), revue des connexions SSH (`last`, `/var/log/auth.log`), et jamais de `psql` en écriture sans ticket (`astreinte.md`).
