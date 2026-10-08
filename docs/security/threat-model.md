# Modèle de menaces (STRIDE) — Polaris MVP

Revu en Phase 7 (octobre 2026). À revoir à chaque phase majeure et après tout incident S1/S2.

## Actifs, par ordre de priorité

1. **Données de mineurs** : identité, présence, lien familial, justificatifs.
2. **Argent** : créances, paiements, reçus, clés des comptes marchands.
3. **Confiance des établissements** : isolation stricte entre tenants, traçabilité.

## Acteurs et surfaces

| Acteur                                     | Accès                                     | Surface                                             |
| ------------------------------------------ | ----------------------------------------- | --------------------------------------------------- |
| Parent                                     | téléphone, OTP/mot de passe, appli web    | `/me/*`, paiement en ligne, justificatifs           |
| Personnel (enseignant, scolarité, finance) | e-mail + mot de passe (+ MFA si sensible) | toutes les routes tenant selon permissions          |
| Administrateur d'établissement             | idem + MFA                                | configuration, rôles, données personnelles, exports |
| Super Admin (Polaris)                      | MFA obligatoire                           | plateforme, impersonation                           |
| Provider de paiement                       | webhooks signés                           | `/webhooks/payments/:provider/:token`               |
| Attaquant externe                          | Internet                                  | API publique, web, connexion, OTP                   |
| Attaquant interne (employé, prestataire)   | accès production, dépôt                   | base, secrets, journaux                             |

## Menaces et contre-mesures

### S — Usurpation d'identité (Spoofing)

| Menace                                              | Contre-mesures                                                                                                                       | Résiduel                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Vol de mot de passe (phishing, réutilisation)       | argon2id, verrouillage progressif, **MFA TOTP** pour les rôles sensibles et le super admin, liste des sessions, révocation globale   | Moyen : CAPTCHA et HIBP non intégrés (Phase 8) |
| Vol de refresh token                                | cookie HttpOnly/SameSite=Strict, rotation à chaque usage, détection de réutilisation → révocation de la famille + événement sécurité | Faible                                         |
| Faux webhook provider                               | signature (HMAC horodaté FedaPay, secret KKiaPay), **`verify()` serveur-à-serveur fait foi**, jeton d'URL par tenant                 | Faible                                         |
| Faux OTP / énumération de numéros                   | 6 chiffres, 5 min, 5 essais, 3 envois/h, réponse identique                                                                           | Faible                                         |
| Super Admin se faisant passer pour un établissement | impersonation **tracée** (table + audit `impersonated_by`), bannière, 30 min, sans action financière, clôturable                     | Faible                                         |

### T — Altération (Tampering)

| Menace                                        | Contre-mesures                                                                                             | Résiduel                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Modification d'un paiement ou d'un reçu       | tables append-only (triggers), corrections compensatoires, numérotation séquentielle, hash de vérification | Faible                                                    |
| Montant d'allocation décidé par le client     | montants calculés serveur ; montant vérifié = montant demandé sinon revue humaine                          | Faible                                                    |
| Modification d'une feuille d'appel après coup | verrouillage, fenêtre de correction, révisions auditées, traçabilité par feuille                           | Faible                                                    |
| Altération du dépôt / de la chaîne de build   | CODEOWNERS sur modules critiques, CI (lint type-checked, tests, dépendances, gitleaks), images par SHA     | Moyen : signature des images et provenance (SLSA) à venir |
| Injection SQL                                 | requêtes paramétrées (Drizzle), `sql.raw` uniquement sur constantes, validation zod                        | Faible                                                    |

### R — Répudiation

| Menace                                         | Contre-mesures                                                                                              | Résiduel |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------- |
| « Je n'ai jamais encaissé/annulé ce paiement » | `audit_logs` append-only avec acteur, IP, avant/après ; reçus signés ; journal consultable (`/admin/audit`) | Faible   |
| « Le support a modifié ma configuration »      | `impersonated_by` dans l'audit, registre des sessions de support, motif obligatoire                         | Faible   |
| « Je n'ai pas demandé l'anonymisation »        | `privacy_requests` (qui, quand, motif, origine)                                                             | Faible   |

### I — Divulgation d'information

| Menace                                        | Contre-mesures                                                                                                                          | Résiduel                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Fuite inter-tenant                            | trois barrières (guard, repository scopé, **RLS forcée** avec rôle sans BYPASSRLS), 404 systématique, test d'isolation sur chaque route | Faible                                           |
| Parent voyant un enfant qui n'est pas le sien | lien créé par le personnel, invitation par code, droits par drapeau, audit des liens                                                    | Moyen (erreur humaine)                           |
| Clés provider exposées                        | chiffrement d'enveloppe, déchiffrement dans Payments seul, masquage `••••1234`, logs expurgés                                           | Faible ; KMS à brancher                          |
| Données personnelles dans les logs/SMS        | redaction pino, SMS « prénom + initiale », traces sans secret                                                                           | Faible                                           |
| Export complet volé                           | permission `MANAGE_TENANT_SETTINGS`, stockage en base, téléchargement authentifié, journalisé                                           | Moyen : chiffrer l'archive par mot de passe (V1) |
| XSS exfiltrant des jetons                     | jeton en mémoire, CSP avec nonce (report-only → bloquante), React sans HTML brut                                                        | Faible une fois la CSP bloquante                 |

### D — Déni de service

| Menace                            | Contre-mesures                                                                             | Résiduel                   |
| --------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------- |
| Rafale de connexions / OTP        | rate limiting Redis (IP, identifiant), verrouillage, limite d'envois SMS                   | Faible                     |
| Rafale de webhooks                | limite dédiée par provider, 200 immédiat, traitement en file, test de charge `webhooks.js` | Faible                     |
| Épuisement du quota SMS (coût)    | plafond mensuel par tenant, alerte à 90 %, bascule in-app                                  | Faible                     |
| Provider de paiement indisponible | disjoncteur, message « en cours de vérification », réconciliation, alerte `circuit`        | Moyen (dépendance externe) |
| Corps de requête géants           | 1 Mo max (413), pagination max 200                                                         | Faible                     |

### E — Élévation de privilèges

| Menace                                            | Contre-mesures                                                                                                       | Résiduel |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| Rôle tenant obtenant une permission plateforme    | catalogue typé, validation (`PLATFORM_*` refusé aux rôles tenant), matrice en CI                                     | Faible   |
| Permission conservée après retrait                | `permissions_version` dans le jeton, cache versionné, effet immédiat (test rbac)                                     | Faible   |
| Compte désactivé encore actif                     | `token_version`, état du membership relu toutes les 30 s                                                             | Faible   |
| Support (impersonation) encaissant ou remboursant | permissions d'impersonation = administrateur **moins** toute action financière/sensible ; jamais de route plateforme | Faible   |
| Accès production hors procédure                   | SSO + MFA, bastion, pas de psql sans ticket (infrastructure, décision avant production)                              | Moyen    |

## Hypothèses

- Le PaaS termine TLS 1.2+ et gère les sauvegardes/PITR du service managé (décision « avant production » n° 8).
- Les providers de paiement ne publient pas de liste d'IP fiable : la signature + `verify()` restent les barrières.
- Les employés Polaris ayant accès à la production sont peu nombreux, identifiés, et toute action en base passe par un ticket.

## Prochaines revues

- Après le test d'intrusion externe (Phase 7, prestataire) : intégrer les constats et mettre à jour les résiduels.
- Avant la V1 (stockage objet, remboursements, apps mobiles) : nouvelles surfaces (upload, deep links, push).
