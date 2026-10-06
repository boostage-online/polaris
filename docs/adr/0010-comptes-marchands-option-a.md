# ADR-0010 — Comptes marchands : Option A (compte provider par établissement), modèle prêt pour l'Option C

- **Statut** : Proposée — **décision à confirmer formellement par la direction avant la Phase 4**
- **Date** : 2026-10-06
- **Décideurs** : direction, lead technique, conseil juridique/financier
- **Références** : document directeur Partie 10 (comptes marchands), Partie 2 ; ADR-0005

## Contexte et problème

L'argent des parents doit arriver aux établissements. Trois montages sont possibles : chaque établissement a son propre compte FedaPay/KKiaPay (A) ; la plateforme encaisse tout sur un compte central et reverse (B) ; hybride (C). Le choix conditionne le statut réglementaire de la plateforme (détention de fonds de tiers dans l'UEMOA), les contrats providers, la responsabilité en cas de litige, la comptabilité, l'onboarding des établissements et la mention portée sur les reçus. Il doit être pris **avant d'écrire le module Payments** et impérativement avant la production.

## Options envisagées

| Critère | A — compte par établissement | B — compte central + reversement | C — hybride |
| --- | --- | --- | --- |
| Flux | provider → établissement | provider → plateforme → établissement | selon tenant |
| Réglementation | plateforme = prestataire technique | plateforme détient des fonds de tiers : agrément ou adossement à un établissement agréé (BCEAO) | B pour une partie du parc |
| Commissions | négociées par établissement ; marge = abonnement SaaS | marge prélevée au passage | mixte |
| Onboarding | KYC provider par établissement, saisie de clés | un clic | friction pour A |
| Rapprochement | par établissement, avec ses clés | centralisé + ventilation par tenant | double |
| Reversements | aucun | module payouts, calendrier, litiges, fonds en transit | pour B |
| Sécurité | N jeux de clés chiffrés | un compte qui concentre tout | les deux |
| Complexité comptable | faible | élevée | élevée |

## Décision

Nous retenons l'**Option A** pour le lancement, avec un modèle de données qui autorise l'Option C sans migration structurelle :

- Table `tenant_payment_configs (tenant_id, provider, mode ∈ {OWN_ACCOUNT, PLATFORM_ACCOUNT}, credentials_encrypted, webhook_secret_encrypted, status, created_by)` dès le MVP ; **seul `OWN_ACCOUNT` est implémenté**.
- Clés et secrets chiffrés par **chiffrement d'enveloppe** (clé de données par tenant, clé maître dans un KMS) ; déchiffrés uniquement dans le module Payments ; jamais renvoyés par l'API (affichage masqué).
- Le choix du compte passe par `PaymentRoutingPolicy.select(tenant, guardian, amount, method)` qui, au MVP, renvoie le provider et la config du tenant ; passer à C ne touche que cette policy, l'onboarding et un futur module Payouts.
- Les reçus mentionnent « Encaissé par {établissement} via {provider} » ; en mode `PLATFORM_ACCOUNT` (futur), la mention deviendra « Encaissé pour le compte de {établissement} par {plateforme} ».
- La réconciliation quotidienne tourne avec les clés de chaque tenant.
- L'onboarding d'un établissement comprend une étape guidée « Connecter votre compte FedaPay / KKiaPay » avec test de transaction sandbox avant activation.

## Conséquences

### Positives

- Pas de détention de fonds : pas d'agrément, pas de comptabilité de fonds tiers, pas de module de reversement au lancement.
- Responsabilité claire : l'établissement est le créancier et le bénéficiaire ; la plateforme est un prestataire technique.
- Le passage à C reste une évolution locale.

### Négatives et risques acceptés

- Friction d'onboarding : chaque établissement doit ouvrir et faire valider un compte provider (à démarrer dès la Phase 0 pour les pilotes).
- Stockage de N jeux de clés : exigence de chiffrement d'enveloppe, rotation documentée, accès restreint.
- La marge de la plateforme ne peut pas être prélevée sur le flux : elle vient de l'abonnement SaaS (V1) ou d'un accord commercial avec les providers.
- Les petits établissements sans capacité de KYC ne pourront pas encaisser en ligne avant l'Option C.

### Ce que cette décision interdit

- Encaisser un paiement parent sur un compte appartenant à la plateforme.
- Stocker une clé provider en clair ou dans `tenants.settings`.
- Afficher une clé provider complète dans une interface.

## Comment on saura qu'il faut la revoir

- Plus de 30 % des prospects sont bloqués par le KYC provider.
- Un partenariat avec un établissement financier agréé rend l'Option C rentable et conforme.
- Les providers proposent un modèle de sous-comptes (marketplace) qui donne les avantages de B sans détention de fonds.

## À faire avant acceptation

- [ ] Avis juridique sur le statut de prestataire technique (UEMOA / Bénin) en Option A.
- [ ] Grille de commissions FedaPay et KKiaPay et porteur des frais (hypothèse : établissement, frais affichés au parent).
- [ ] Confirmation que chaque établissement pilote peut ouvrir un compte provider avant la Phase 5.
- [ ] Signature direction + lead technique.
