# Apps mobiles Flutter — spécification

Deux apps, un seul projet Flutter, **un seul serveur** (l'API existante, `docs/api/`) :

| App                 | Pour qui                  | Phase | Identifiant proposé  |
| ------------------- | ------------------------- | ----- | -------------------- |
| **Polaris Parents** | parents et tuteurs        | 12    | `bj.polaris.parents` |
| **Polaris École**   | enseignants, vie scolaire | 13    | `bj.polaris.ecole`   |

Elles ne remplacent pas le site : la direction, la scolarité, la finance et l'administration restent sur le web. Une app = un « flavor » du même projet (`--flavor parents|ecole`), ce qui partage le thème, le client API, l'authentification et les widgets.

## Pile

| Besoin            | Choix                                                                                                                                         | Pourquoi                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Langage           | Flutter 3 stable, Dart 3, null-safety stricte, `flutter_lints`                                                                                | —                                                              |
| État              | `flutter_riverpod` (+ `riverpod_annotation`)                                                                                                  | testable, pas de contexte global                               |
| Navigation        | `go_router` (routes typées, liens profonds `polaris://`)                                                                                      | retour de paiement, notification → écran                       |
| HTTP              | `dio` + intercepteur d'authentification (refresh automatique, une seule rotation à la fois)                                                   | —                                                              |
| Client API        | **généré** depuis `docs/api/openapi.json` (`openapi_generator` → `packages/polaris_api` en Dart, `dio`, `json_serializable`)                  | le contrat ne dérive pas ; régénérer à chaque phase serveur    |
| Stockage sécurisé | `flutter_secure_storage` (refresh token, identifiant d'appareil)                                                                              | Keychain / Keystore                                            |
| Cache hors ligne  | `drift` (SQLite)                                                                                                                              | lecture hors ligne (parents), brouillons d'appel (enseignants) |
| Push              | `firebase_messaging` (FCM pour Android **et** iOS via APNs)                                                                                   | adaptateur serveur FCM HTTP v1 (phase 11)                      |
| Fichiers          | `image_picker`, `file_picker`, compression `flutter_image_compress` (≤ 1 Mo)                                                                  | justificatifs photographiés                                    |
| Paiement          | `url_launcher` (navigateur externe vers la page du provider) puis lien profond de retour ; `webview_flutter` seulement si le provider l'exige | pas de données de carte dans l'app                             |
| PDF               | ouverture du reçu via `open_filex` après téléchargement authentifié                                                                           | —                                                              |
| i18n              | `flutter_localizations` + fichiers ARB, **français seul** au départ                                                                           | prêt pour une seconde langue                                   |
| Erreurs           | `sentry_flutter`                                                                                                                              | même projet Sentry que l'API                                   |
| Tests             | `flutter_test`, `mocktail`, tests de widgets par écran, `integration_test` sur un émulateur                                                   | CI GitHub Actions                                              |

Contraintes de terrain : téléphones Android d'entrée de gamme (Android 8+, 2 Go de RAM), réseaux 3G instables, données mobiles chères. Donc : APK léger (`--split-per-abi`), images compressées, aucune police téléchargée au lancement, cache d'abord puis rafraîchissement, délais réseau de 15 s et messages clairs hors connexion.

## Structure du projet (`apps/mobile`)

```
apps/mobile/
  pubspec.yaml                  flavors parents / ecole ; assets/fonts (Sora, Inter)
  lib/
    main_parents.dart  main_ecole.dart
    app/                        router.dart (go_router), app.dart (MaterialApp, thème, l10n)
    core/
      theme/                    tokens.dart (généré depuis docs/design/tokens.json), theme.dart
      widgets/                  PolarisButton, StatusBadge, AmountText, EmptyState, ErrorView, Skeleton…
      api/                      client dio, intercepteurs (auth, X-Client, Idempotency-Key, erreurs RFC 9457 → AppFailure)
      auth/                     SessionRepository (jetons, deviceId, switch-membership), AuthGuard du router
      storage/                  drift : cache lecture, file d'envoi hors ligne
      push/                     enregistrement de l'appareil (POST /me/devices), routage des notifications
    features/
      auth/                     otp_request_page, otp_verify_page, staff_login_page, mfa_page, membership_picker
      home/                     parent_home_page (cartes enfants, alertes)
      children/                 child_page (présences, justificatifs), justification_form
      payments/                 fees_page, pay_page (options → tentative → navigateur → retour → suivi), receipts
      notifications/            notifications_page, preferences_page
      account/                  account_page (appareils, données personnelles, déconnexion)
      attendance/               (app École) today_page, sheet_page (P/A/R, brouillon local, envoi différé)
  packages/polaris_api/         client Dart généré (ne pas modifier à la main)
  test/  integration_test/
```

## Écrans de l'app Parents (maquettes : `docs/design/maquettes/`)

| Écran                                                                         | Maquette                                  | Appels API                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Saisie du numéro                                                              | `Connexion.dc.html` (étape 1)             | `POST /auth/otp/request`                                                                                                                                                                                                                                         |
| Code SMS (6 cases, renvoi après 60 s, collage automatique du SMS sur Android) | `Connexion.dc.html`                       | `POST /auth/otp/verify` (avec `deviceId`, `deviceLabel` = modèle du téléphone)                                                                                                                                                                                   |
| Choix de l'établissement (si plusieurs)                                       | —                                         | `memberships` de la réponse, `POST /auth/switch-membership`                                                                                                                                                                                                      |
| Accueil                                                                       | `ParentAccueil.dc.html`                   | `GET /me/children`, `/me/children/summary`, `/me/children/finance`, `/me/notifications`                                                                                                                                                                          |
| Enfant — présences                                                            | `ParentEnfant.dc.html` (onglet Présences) | `GET /me/children/:id/attendance`, `/justifications`                                                                                                                                                                                                             |
| Justifier une absence (motif + photo)                                         | —                                         | `POST /me/children/:id/justifications` (+ envoi de fichier, phase 11)                                                                                                                                                                                            |
| Enfant — frais                                                                | `ParentEnfant.dc.html` (onglet Frais)     | `GET /me/children/:id/fees`                                                                                                                                                                                                                                      |
| Payer                                                                         | —                                         | `GET …/payment-options` → `POST …/payment-attempts` (`Idempotency-Key`) → navigateur → `polaris://pay/return?attempt=…` → `POST …/confirm` → `GET …/payment-attempts/:attemptId` toutes les 3 s (2 min max) → succès : reçu ; sinon « en cours de vérification » |
| Reçus                                                                         | `ParentEnfant.dc.html` (Derniers reçus)   | `GET …/payments/:paymentId/receipt.pdf`                                                                                                                                                                                                                          |
| Notifications                                                                 | —                                         | `GET /me/notifications`, `POST /me/notifications/:id/read`, `read-all`                                                                                                                                                                                           |
| Compte                                                                        | —                                         | `GET /me`, `GET                                                                                                                                                                                                                                                  | PUT /me/notifications/preferences`, `GET /me/sessions`, `GET /me/personal-data`, `POST /auth/logout` |

Règles d'interface : barre d'onglets en bas (Accueil, Présences, Frais, Compte), cibles de 48 dp, texte 16 sp minimum, une action principale safran (_Payer_), statuts avec libellé + icône, montants `90 000 FCFA`, dates `jj/mm/aaaa`.

## Contrat API côté serveur (phase 11, à ajouter à l'API)

| Route                                                 | Rôle                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /app/config` (public)                            | `{ minVersion: { android, ios }, latestVersion, features: { payments, justificationFiles, push }, supportUrl }` — l'app propose la mise à jour ou bloque sous `minVersion` |
| `POST /me/devices`                                    | `{ platform: "android"                                                                                                                                                     | "ios", pushToken, appVersion, deviceId, label }` → enregistre ou met à jour l'appareil |
| `DELETE /me/devices/:id`                              | à la déconnexion                                                                                                                                                           |
| `POST /me/children/:studentId/justifications/uploads` | URL d'envoi présignée (stockage objet), types image/PDF, 5 Mo max ; la clé retournée accompagne la création du justificatif                                                |
| Canal `PUSH` du moteur de notifications               | envoi FCM ; repli SMS si aucun appareil actif depuis 30 jours ; préférences par type                                                                                       |

Toutes ces routes : tests d'intégration, matrice de permissions, test d'isolation, ajout dans `openapi.json`.

## Authentification dans l'app

1. Au premier lancement : `deviceId` = UUID v4 stocké dans le stockage sécurisé (stable pour la vie de l'installation).
2. Toutes les requêtes : `X-Client: mobile/<version>` ; `Authorization: Bearer <accessToken>` gardé **en mémoire seulement**.
3. Sur 401 : un seul refresh à la fois (verrou), rejouer la requête ; si le refresh échoue (révoqué, expiré, réutilisé) → retour à la connexion, stockage effacé.
4. Déconnexion : `POST /auth/logout {refreshToken}`, `DELETE /me/devices/:id`, effacement local.
5. Jamais de jeton dans les journaux ni dans Sentry (filtre `beforeSend`).

## CI et publication

- Workflow `mobile.yml` : `flutter analyze`, `flutter test`, build APK `--flavor parents` à chaque PR touchant `apps/mobile` ; build AAB signé sur tag `mobile-v*` et envoi en **test interne Google Play** (secrets : keystore, compte de service Play). iOS : build sur `macos-latest`, envoi TestFlight (certificats Apple, à partir de la phase 12 bis).
- Version : `pubspec.yaml` `x.y.z+build` ; `minVersion` serveur relevé seulement en cas de changement incompatible (rare : l'API est additive).

## Porte de sortie (phase 12)

App de test interne installée par 3 parents pilotes sur leurs propres téléphones Android ; parcours « absence notifiée par push → justificatif avec photo » et « paiement Mobile Money sandbox → reçu PDF » réussis ; démarrage à froid < 3 s sur un téléphone 2 Go ; aucun plantage sur 7 jours (Sentry).
