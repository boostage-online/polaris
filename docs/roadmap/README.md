# Plan de la suite — phases 9 à 14

Le MVP (phases 1 à 8, `docs/backlog/`) est livré : multi-établissements avec RLS, auth (mot de passe, OTP, MFA), structure académique, élèves et tuteurs, appel et justificatifs, notifications, frais et caisse, paiement en ligne FedaPay/KKiaPay, reporting, durcissement, outils de lancement. 138 tests d'intégration, CI verte, images Docker publiées, kit de déploiement VPS (`infra/vps`).

Ce plan dit **dans quel ordre** finir le produit. Chaque phase est une branche et une PR, se termine CI verte avec une passation (`docs/handover-phase-N.md`), et a une **porte de sortie** vérifiable. Les prompts prêts à donner à Claude Code sont dans [`docs/claude-code/`](../claude-code/README.md).

```
Phase 9   Fournisseurs réels et mise en ligne des pilotes     ~2 sem.   ← bloquant : aujourd'hui SMS et e-mails sont simulés
Phase 10  Refonte visuelle web (design system, mobile parent)  ~2 sem.
Phase 11  API mobile (push, fichiers, version, appareils)       ~1,5 sem.
Phase 12  App Flutter parents (Android puis iOS)                ~4 sem.
Phase 13  App Flutter personnel : appel hors ligne              ~3 sem.
Phase 14  V1 métier : remboursements, choix du provider, …     ~4 sem.
```

## État réel au départ (ce qui manque vraiment)

| Sujet                                           | État                                                                                                     | Phase  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| Envoi de SMS                                    | adaptateur `log` seulement (`SMS_PROVIDER=log`) : aucun SMS ne part                                      | 9      |
| Envoi d'e-mails                                 | adaptateur `log` seulement                                                                               | 9      |
| Paiement en ligne                               | adaptateurs FedaPay et KKiaPay écrits sur la documentation ; jamais testés avec des clés sandbox réelles | 9      |
| Hébergement                                     | kit VPS prêt, serveur non commandé                                                                       | 9      |
| Identité visuelle                               | aucune ; espace parent mobile qui déborde                                                                | 10     |
| Notifications push                              | canal `PUSH` prévu dans le modèle, non implémenté                                                        | 11     |
| Pièces jointes (justificatifs)                  | seul le nom du document est stocké                                                                       | 11     |
| Apps mobiles                                    | aucune                                                                                                   | 12, 13 |
| Remboursements, choix du provider par le parent | modélisés, non implémentés                                                                               | 14     |

---

## Phase 9 — Fournisseurs réels et mise en ligne des pilotes

**But** : un vrai établissement peut utiliser Polaris de bout en bout ; les parents reçoivent de vrais SMS.

1. **Adaptateur SMS réel** derrière le port `SmsGateway` (`apps/api/src/modules/shared/domain/ports.ts`) : un agrégateur couvrant les opérateurs béninois (MTN, Moov) — choix à valider par le propriétaire du produit, par exemple un fournisseur local ou un agrégateur international (Africa's Talking, Twilio, Infobip). Configuration `SMS_PROVIDER=<nom>` + clés en variables d'environnement ; accusés de réception (DLR) par webhook signé qui mettent à jour `notifications.status` ; coût unitaire enregistré ; tests sur réponses enregistrées.
2. **Adaptateur e-mail réel** (SMTP générique : fonctionne avec l'e-mail Hostinger, Brevo ou Mailgun) derrière `EmailGateway`, avec pièces jointes (rapports planifiés).
3. **Validation des providers de paiement en sandbox** : enregistrer les réponses réelles de FedaPay et KKiaPay, ajuster les adaptateurs, rejouer les tests ; documenter la procédure de passage en clés réelles.
4. **Stockage objet** (S3 compatible : MinIO en local, Cloudflare R2 en production) : port `ObjectStorage` (prérequis des pièces jointes de la phase 11 et des exports volumineux).
5. **Mise en ligne** selon `docs/runbooks/deploy-vps.md` (opération humaine, guidée) : VPS, DNS, `install.sh`, variables GitHub, sauvegarde hors site, Sentry (`SENTRY_DSN`).
6. Mettre à jour `infra/vps/.env.example` et `docs/runbooks/` pour chaque nouvelle variable.

**Porte G9** : un SMS réel reçu sur un téléphone béninois après un appel ; un e-mail d'invitation reçu ; un paiement sandbox FedaPay confirmé de bout en bout ; l'application servie en HTTPS sur le VPS avec déploiement automatique depuis `main`.

## Phase 10 — Refonte visuelle web

**But** : appliquer le système de design (`docs/design/`) à toute l'application web, en commençant par les écrans parents et enseignants sur téléphone.

1. Importer `docs/design/tokens.css` dans `apps/web/src/app/globals.css`, configurer Tailwind 4 (`@theme`) sur ces variables, polices Sora et Inter via `next/font/google`, logo (étoile, `Main.dc.html`) en composant SVG + favicon + manifeste PWA.
2. Refaire les composants de `apps/web/src/components/ui.tsx` (Button, Card, Badge de statut avec icône, Field/Input, Stat, Table responsive → liste empilée sous 640 px, Tabs, Modal, états vides, squelettes de chargement) ; **composant de date maison** au format `jj/mm/aaaa`.
3. Écrans dans l'ordre : connexion (onglets parent OTP / personnel e-mail, `Connexion.dc.html`), espace parent (`ParentAccueil`, `ParentEnfant`), appel enseignant (`Appel`), coquille avec menu latéral nuit (`Direction`), tableau de bord de direction, fiche élève (`FicheEleve`), puis le reste par cohérence.
4. Zéro défilement horizontal à 360 px (test Playwright de non-régression dans le workflow de captures : largeur du document ≤ largeur de l'écran pour chaque écran mobile).
5. Mettre à jour `ops/screenshots/screenshots.mjs` et `docs/design/captures-actuelles/`.

**Porte G10** : captures à 390 px fidèles aux maquettes, aucun débordement horizontal, contraste AA vérifié, CI verte.

## Phase 11 — API mobile

**But** : tout ce dont les apps Flutter ont besoin côté serveur, sans casser le web. Spécification : [`docs/mobile/README.md`](../mobile/README.md), section « Contrat API ».

1. **Appareils et push** : table `devices` (utilisateur, plateforme, jeton FCM, version de l'app, dernière activité, RLS par utilisateur), `POST /me/devices`, `DELETE /me/devices/:id` ; adaptateur **FCM HTTP v1** derrière un port `PushGateway` ; canal `PUSH` activé dans le moteur de notifications (préférences, repli SMS si aucun appareil actif — économise la facture SMS).
2. **Pièces jointes des justificatifs** : `POST /me/children/:studentId/justifications` accepte un fichier (image ou PDF, 5 Mo max, type vérifié par signature) via URL d'envoi présignée du stockage objet ; téléchargement authentifié côté personnel.
3. **Configuration et version** : `GET /app/config` (public) — version minimale supportée par plateforme, fonctionnalités actives, URL de support ; l'app bloque proprement si elle est trop ancienne.
4. **Session mobile** : vérifier et documenter le parcours `X-Client: mobile/<version>` (refresh dans le corps, rotation, révocation à la déconnexion), lien profond de retour de paiement (`polaris://pay/return`).
5. Publier `docs/api/openapi.json` à jour (`pnpm openapi` + copie) ; tests d'intégration et matrice de permissions pour chaque route.

**Porte G11** : une notification push reçue sur un émulateur Android depuis un appel soumis ; un justificatif avec photo déposé puis consulté par la vie scolaire ; contrat OpenAPI publié.

## Phase 12 — App Flutter parents

**But** : l'app « Polaris Parents » sur Google Play (puis App Store), qui remplace le site web pour les parents. Spécification complète : [`docs/mobile/README.md`](../mobile/README.md).

Écrans : connexion OTP, choix d'établissement si plusieurs, accueil (cartes enfants, alertes), suivi d'un enfant (présences, justifier une absence avec photo), frais (échéancier, payer par Mobile Money via le parcours provider, reçus PDF), notifications, compte (préférences, appareils, données personnelles, déconnexion). Hors ligne en lecture (dernier état mis en cache), push, liens profonds.

**Porte G12** : app de test interne Google Play installée par 3 parents pilotes ; parcours « absence notifiée → justificatif envoyé » et « paiement Mobile Money → reçu » réussis sur de vrais téléphones Android d'entrée de gamme (2 Go de RAM).

## Phase 13 — App Flutter personnel (appel hors ligne)

Écrans enseignant : séances du jour, appel P/A/R (présents par défaut), brouillon local SQLite et envoi différé au retour du réseau (versionnage de feuille déjà géré par l'API : conflits → 409 affiché proprement), correction dans la fenêtre autorisée. Vie scolaire : justificatifs à traiter. Connexion e-mail + MFA.

**Porte G13** : un appel complet fait en mode avion puis synchronisé ; appel de 30 élèves en moins de 60 secondes.

## Phase 14 — V1 métier

Remboursements (internes et via provider) et crédits, choix du provider par le parent et routage, motifs d'absence configurables par établissement, convocations simples, comparaison inter-années dans les tableaux de bord, export comptable. Détail : Partie 18 du document directeur (lien dans `README.md`).

---

## Décisions qui restent au propriétaire du produit

À trancher avant ou pendant la phase indiquée (Claude Code ne les prend pas seul) :

| Décision                                                                                   | Phase |
| ------------------------------------------------------------------------------------------ | ----- |
| Fournisseur SMS (prix au SMS, couverture MTN/Moov, nom d'expéditeur)                       | 9     |
| Fournisseur e-mail (SMTP Hostinger suffisant au début)                                     | 9     |
| Comptes FedaPay / KKiaPay de test puis réels                                               | 9     |
| Nom commercial définitif et logo (la maquette propose « Polaris », étoile safran sur nuit) | 10    |
| Comptes Google Play Console (25 $ une fois) et Apple Developer (99 $/an), projet Firebase  | 11–12 |
| Identifiant d'application (`bj.polaris.parents` par exemple)                               | 12    |
