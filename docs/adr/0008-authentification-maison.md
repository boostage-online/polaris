# ADR-0008 — Authentification maison : argon2id, JWT court + refresh opaque rotatif, OTP SMS, MFA TOTP

- **Statut** : Proposée
- **Date** : 2026-10-06
- **Décideurs** : lead technique
- **Références** : document directeur Parties 7, 11, 16 ; ADR-0007

## Contexte et problème

Trois populations très différentes : personnel (e-mail, poste de travail, droits sensibles), parents (téléphone, smartphone, parfois sans e-mail, réseau dégradé, jusqu'à 300 000 comptes), super administrateurs. Un même parent peut appartenir à deux établissements. Il faut des sessions longues sur mobile, une révocation immédiate, une MFA pour les actions financières, et un coût qui ne croît pas linéairement avec le nombre de parents.

## Options envisagées

1. **Fournisseur d'identité SaaS** (Auth0, Clerk, Cognito) — rapide, mais tarification par utilisateur actif (×300 000 parents), modèle multi-tenant « un utilisateur dans deux organisations » mal supporté, OTP SMS en zone UEMOA via leur passerelle (cher, délivrabilité incertaine).
2. **Keycloak auto-hébergé** — complet, mais un service Java lourd à opérer pour une petite équipe, et une personnalisation OTP/téléphone non triviale.
3. **Implémentation dans NestJS** avec des briques standard (argon2, jose, TOTP), nos tables, notre passerelle SMS.
4. Sessions serveur classiques (cookie de session en Redis) — simple pour le web, inadaptée aux apps mobiles et à la révocation fine multi-appareils.

## Décision

Nous retenons l'option 3 :

- **Mots de passe** : argon2id (m = 64 Mo, t = 3, p = 4), ≥ 10 caractères, vérification k-anonymity contre les mots de passe compromis.
- **Access token** : JWT ES256, **10 minutes**, claims `sub` (user), `mid` (membership actif), `tid` (tenant), `kind`, `pv` (version des permissions), `exp` ; clés tournées tous les 90 jours (`kid`, double validité). **Pas de liste de permissions dans le token.**
- **Refresh token** : chaîne aléatoire 256 bits, stockée hachée, **rotation à chaque usage**, `family_id` ; réutilisation d'un token consommé = révocation de toute la famille + notification. Web : cookie `HttpOnly; Secure; SameSite=Strict` sur le chemin `/api/v1/auth` ; mobile : body + stockage sécurisé. Durées : 30 jours personnel, 90 jours parents, 8 h super admin.
- **Parents** : identifiant = téléphone E.164 ; première connexion par OTP SMS (6 chiffres, 5 min, 5 essais, 3 envois/heure, réponse identique que le numéro existe ou non) puis mot de passe ou PIN ; OTP seul autorisé si le tenant l'accepte.
- **MFA TOTP** obligatoire pour le super admin et pour toute permission financière sensible (`RECORD_MANUAL_PAYMENT`, `ISSUE_REFUND`, `CANCEL_PAYMENT`, `MANAGE_PAYMENT_PROVIDER`) ; codes de récupération.
- **Changement de tenant** : `POST /auth/switch-membership` émet un nouvel access token.
- **Révocation** : logout révoque le refresh ; « tous mes appareils » révoque toutes les familles et incrémente `users.token_version` vérifié côté API ; liste des sessions actives visible par l'utilisateur.
- **Anti-brute-force** : verrouillage progressif par compte et par IP (Redis), CAPTCHA après 3 échecs sur le formulaire web.
- Les appareils (`device_id`, `device_label`) et tokens push (`device_tokens`) sont modélisés dès le MVP (préparation mobile).

## Conséquences

### Positives

- Coût nul par utilisateur ; contrôle total du parcours parent (téléphone, SMS local, langue).
- Modèle multi-tenant exact (membership actif dans le token).
- Révocation fine, détection de vol de refresh, préparation mobile sans retouche.

### Négatives et risques acceptés

- Nous portons la responsabilité de la sécurité de l'authentification : revue de code obligatoire (CODEOWNERS) sur `identity/`, tests dédiés, pentest avant production.
- Pas de SSO au MVP (V1 pour le personnel).
- Dépendance à la délivrabilité SMS pour l'onboarding parent : repli e-mail ou code remis par l'établissement.

### Ce que cette décision interdit

- Stocker un token dans `localStorage`.
- Mettre les permissions dans le JWT.
- Un access token de plus de 15 minutes.
- Accepter un refresh token non rotatif.

## Comment on saura qu'il faut la revoir

- Exigence client de fédération d'identité à grande échelle (SAML/OIDC entrant) : s'ajouterait comme méthode de connexion pour le personnel sans remplacer le reste.
- Audit de sécurité recommandant une délégation complète.
