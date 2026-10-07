# Passation — Phase 5 (paiements électroniques)

Branche `feat/phase-5-payments`, empilée sur `feat/phase-4-billing` (PR #5 → PR #4 → … → PR #1). Backlog : `docs/backlog/phase-5-payments.md` ; document directeur Partie 10 ; ADR mises en œuvre : 0005 (tentative ≠ paiement, append-only), 0010 (comptes marchands, Option A), 0003 (outbox), 0007 (permissions).

**Règle d'or du module** : un webhook n'est qu'un signal ; la vérité vient d'un appel serveur-à-serveur (`verify`) ; un paiement n'est créé que par ce chemin, sous contraintes uniques.

## Ce qui est livré

**Base (migration `0005_payments`)** — 5 tables tenant sous RLS forcée :

- `tenant_payment_configs` : un enregistrement par (tenant, provider) ; `mode` (`OWN_ACCOUNT` seul implémenté, `PLATFORM_ACCOUNT` réservé à l'Option C), `environment` (SANDBOX/LIVE), clé publique en clair (non secrète), **secrets chiffrés par enveloppe** (`credentials_encrypted`, `webhook_secret_encrypted`), `webhook_token` (jeton aléatoire de l'URL de webhook), `status` (`PENDING_TEST` → `ACTIVE` après test de connexion → `DISABLED`).
- `payment_attempts` : machine d'états `CREATED → PENDING → PROCESSING → SUCCEEDED | FAILED | CANCELLED | EXPIRED`, `UNKNOWN` (revue humaine : `review_status`, `review_note`), `checkout` (ce que le web affiche), `expires_at`, `verified_amount`, `fees`, `payment_id`, `next_check_at`/`check_count` (backoff de réconciliation), `trace_id`.
- `provider_transactions` : `UNIQUE(provider, external_id)` et `UNIQUE(attempt_id)` — une transaction provider appartient à une seule tentative.
- `webhook_events` : `UNIQUE(provider, external_event_id)` (sans identifiant d'événement provider : `sha256(provider, transaction, statut, horodatage)`), en-têtes expurgés, corps, `processed_at` / `processing_error`.
- `payment_reconciliation_runs` : rapprochement quotidien (orphelins, écarts) ; les orphelins traités y sont marqués `resolved`.

**Port `PaymentProvider`** (`modules/payments/domain/provider.ts`) : `capabilities()`, `initiate()`, `verify()`, `parseWebhook()` (authentifie et extrait, ne décide rien), `listTransactions?()`, `healthCheck()`. Trois adaptateurs dans `infrastructure/` :

| Adaptateur    | Création                                               | Vérification                                    | Webhook                                                                           | Liste des transactions |
| ------------- | ------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------- |
| `FedaPay`     | serveur : `POST /transactions` + `/token` → URL        | `GET /transactions/{id}`                        | `X-FEDAPAY-SIGNATURE: t=…,s=…` HMAC-SHA256 de `t.corps`, tolérance 5 min          | oui (pagination)       |
| `KKiaPay`     | widget côté client (clé publique, `data = attempt_id`) | `POST /transactions/status` avec les trois clés | `x-kkiapay-secret` (secret statique : ne prouve pas le corps → `verify` fait foi) | non (`UNSUPPORTED`)    |
| `Fake` (démo) | état en Redis, URL vers la caisse factice web          | état en Redis ; panne simulable                 | `x-fake-signature = sha256(secret\|corps)`, rejouable                             | oui (scan Redis)       |

Les champs FedaPay/KKiaPay suivent la documentation publique et sont **à confirmer sur les comptes sandbox** (le document directeur demande d'enregistrer les payloads réels pour les tests d'adaptateur). `ProviderRegistry` instancie les adaptateurs depuis l'environnement et porte le **disjoncteur** par (tenant, provider) dans Redis : 5 échecs réseau par minute → provider déclaré indisponible 2 min (`503 PROVIDER_UNAVAILABLE` immédiat).

**Secrets** (`infrastructure/secrets.ts`) : enveloppe `{v, kid, wrappedKey, iv, tag, data}` — DEK aléatoire par enregistrement (AES-256-GCM), enveloppée par la clé maître `PAYMENT_MASTER_KEY` via le port `KeyWrapper` (`LocalKeyWrapper` aujourd'hui ; un KMS remplace cette classe sans toucher au reste). Déchiffrement uniquement dans `PaymentConfigService.credentials()` ; l'API ne renvoie que des valeurs masquées (`••••1234`) ; une clé masquée renvoyée par l'écran conserve la valeur précédente.

**Services**

- `PaymentConfigService` : liste masquée, `upsert` (clés attendues par provider, repasse en `PENDING_TEST`), `test` (health check → `ACTIVE`, désactive l'autre provider : un seul actif par tenant), `setStatus`, `byWebhookToken` (lecture plateforme), `webhookUrl`.
- `PaymentsService`
  - `options(studentId)` : le parent peut-il payer (droit `can_pay`, provider actif, bornes `min ≤ montant ≤ solde`).
  - `create` — **route sans transaction** : (1) contrôles et insertion `CREATED` ; (2) `initiate` sous disjoncteur, hors transaction ; (3) `PENDING` + `checkout` + `provider_transactions` si l'identifiant est connu, ou `FAILED(PROVIDER_UNAVAILABLE)` → 503. `Idempotency-Key` obligatoire (422 sans).
  - `confirm` (`ConfirmAttempt`) — déclenché par le webhook (file), le retour du parent, la réconciliation ou « Re-vérifier » : `verify` hors transaction, puis en une transaction `SELECT … FOR UPDATE`, sortie si terminal (idempotent), mise à jour de `provider_transactions`, et si `SUCCEEDED` **avec montant vérifié = montant demandé** : `LedgerService.recordElectronicPayment` (paiement `source = ELECTRONIC`, allocation sous verrou, reçu, audit, `PaymentRecorded` → notification parent). Écart de montant ou statut inconnu → `UNKNOWN` + `review_status = OPEN` + `PaymentReviewNeeded`, **jamais d'allocation**. Échecs → `FAILED`/`CANCELLED`/`EXPIRED` + `PaymentAttemptFailed` (notification au payeur).
  - `confirmFromReturn`, `getForGuardian`, `listForGuardian` (espace parent) ; `list`, `timeline` (initiate, webhooks, verify, paiement, audit — sans clé ni corps brut), `reverify`, `resolve` (finance).
- `WebhookService.receive` : résolution du tenant par le jeton d'URL, `parseWebhook` (signature invalide → 400 + log sécurité ; endpoint inconnu → 404), rapprochement de la tentative (`attempt_id` en métadonnée, sinon transaction connue), insertion `webhook_events` (`ON CONFLICT DO NOTHING` → `DUPLICATE`, 200), mise en file `payments`, 200 immédiat. Aucune logique métier.
- `ReconciliationService` : `reconcilePending` (5 min : tentatives dont `next_check_at` est passé, backoff 2/5/10/20/40 min puis horaire ; s'arrête si le provider est en panne), `expireStale` (15 min : au-delà de `expires_at + 24 h`, sans identifiant → `EXPIRED`, avec identifiant mais provider muet → `UNKNOWN` + revue), `daily` (5 h 30, J−1 : transactions provider réussies inconnues chez nous → orphelines + `PaymentReviewNeeded` ; écarts de montant → rapport ; succès provider sur tentative ouverte → confirmation immédiate), `pending` (écran), `resolveOrphan`.
- Worker : `PaymentsProcessor` consomme la file `payments` (`confirm-attempt`, 6 essais exponentiels ≈ 10 min, DLQ `payments-dlq`) ; `SchedulesService` porte les trois crons.
- `FakeCheckoutService` + `/dev/fake-provider/*` (désactivés en production) : la caisse factice web poste le webhook signé sur notre propre endpoint, exactement comme un provider.

**Notifications** : `PAYMENT_FAILED` (in-app au payeur : « aucun montant n'a été prélevé par Polaris ; vous pouvez réessayer »), `PAYMENT_REVIEW_NEEDED` (in-app + e-mail aux membres `VIEW_PAYMENTS`). Le succès réutilise `PAYMENT_RECEIVED` (SMS + in-app avec le numéro de reçu). Le reçu porte « Encaissé par {établissement} via {provider} » (ADR-0010, Option A).

**Web**

- Parent : bouton « Payer en ligne » sur la fiche enfant (prochaine échéance / tout le solde / montant libre, clé d'idempotence fixée à l'ouverture), `/pay/[attemptId]` (redirection automatique ou widget KKiaPay avec `data = attempt_id`), `/pay/[attemptId]/return` (« en cours de vérification », confirmation immédiate, polling 3 s pendant 2 min, reçu PDF ; messages d'échec traduits ; au-delà, « vous serez notifié »), historique des tentatives avec « Vérifier ».
- Caisse factice `/pay/fake/[externalId]` (publique, sandbox) : confirmer / échouer / annuler / fermer sans répondre.
- Finance `/finance/payments` : **Transactions en attente** (revues ouvertes, en attente > 30 min, orphelines, santé du provider, « Re-vérifier », « Résoudre (motif) », « Rapprocher hier »), toutes les tentatives (filtres), réconciliations ; `/finance/payments/attempts/[id]` : chronologie.
- Administrateur `/settings/payments` : providers, clés (masquées, mot de passe), environnement, URL de webhook à déclarer, test de connexion, activation/désactivation, montant minimal, panne simulée.

**Seed** — par tenant : configuration `FAKE` active en sandbox (jeton `seed-<code>-…`, secret `whsec-<code>-demo`), une tentative annulée (historique) et une réconciliation « OK » de la veille.

## Permissions et routes

18 routes nouvelles dans `test/permissions-matrix.yaml` : parent (`/me/children/:studentId/payment-options`, `payment-attempts`, `…/confirm`) en portée identité avec `assertGuardianAccess(…, 'pay' | 'finance')` ; lecture finance (`VIEW_PAYMENTS`, `VIEW_FINANCIAL_REPORTS`) pour ADMIN, DIRECTION, FINANCE ; actions (`CANCEL_PAYMENT` ou `MANAGE_PAYMENT_PROVIDER`) pour ADMIN, FINANCE ; configuration (`MANAGE_PAYMENT_PROVIDER`, sensible) pour ADMIN seul. Webhooks et caisse factice sont `@Public()`. L'isolation ignore `:provider` (ce n'est pas l'identifiant d'une ressource).

## Décisions d'implémentation à connaître

- **Quatre verrous d'idempotence** (Partie 10) : `Idempotency-Key` (24 h) à la création ; `UNIQUE(provider, external_event_id)` à la réception ; `UNIQUE(provider, external_id)` sur les transactions ; `UNIQUE(attempt_id)` sur `payments` + `FOR UPDATE` à la confirmation. Testés : dix webhooks identiques → un traitement ; cinq confirmations concurrentes → un paiement.
- **Création hors transaction** : l'appel provider ne tient jamais une transaction ouverte ; si `initiate` échoue, la tentative est `FAILED` et le parent a un message clair ; une nouvelle tentative est un nouvel enregistrement, jamais réutilisé.
- **Montant vérifié ≠ montant demandé** : aucune allocation, revue humaine ; « Résoudre » clôture la revue sans écriture (si le parent a payé, la caisse enregistre un encaissement manuel avec la référence provider).
- **Un provider actif par établissement** (routage MVP) ; `PaymentRoutingPolicy` viendra avec le choix par le parent (V1).
- **KKiaPay sans liste de transactions** : la réconciliation quotidienne y est `UNSUPPORTED` (rapprochement via le tableau de bord provider) ; les tentatives individuelles restent réconciliées par `verify`.
- **Remboursements** : modélisés (`refunds.kind = PROVIDER_REFUND`, `capabilities().refunds`) mais non implémentés (V1) ; un double paiement devient un crédit.
- **Secrets** : clé maître locale aujourd'hui ; obligatoire et dédiée par environnement en production (`PAYMENT_MASTER_KEY`), rotation = ré-enveloppement des DEK (à outiller avec le KMS).
- **Chronologie sans secret** : les en-têtes de signature sont tracés comme « présent », jamais en valeur ; les logs expurgent `x-kkiapay-secret` et `x-fedapay-signature`.

## Non couvert (reporté)

Remboursements provider et avoirs (P18, V1) ; choix du provider par le parent et routage automatique ; Option C (compte plateforme) et module de reversements ; QR du reçu renvoyant vers le paiement ; export comptable des frais provider ; rejeu des payloads réels enregistrés en sandbox (les tests d'adaptateur utilisent des payloads construits d'après la documentation) ; test de charge 100 webhooks/s et chaos « provider coupé 10 min » (outillage k6 en Phase 7) ; revue de sécurité par un second développeur.

## État de vérification (CI GitHub Actions, PR #5)

Voir le dernier commentaire de CI sur la PR et la section « Vérification » de sa description.

Tests : unitaires (`domain/attempts.test.ts` — mappings, machine d'états, backoff, règles de montant ; `infrastructure/providers.test.ts` — enveloppe de secrets, signature FedaPay avec corps altéré et horodatage périmé, secret KKiaPay, widget) ; intégration `test/payments.test.ts` sur le provider de démonstration avec le worker réel : configuration (clés masquées, chiffrées en base, un seul actif), options et bornes, P1 (nominal, rejeu idempotent, reçu, chronologie), P5/P14 (dix webhooks, signature invalide, endpoint inconnu), P2/P4 (échec, annulation, notification), P6/P9 (retour sans webhook, cinq confirmations concurrentes), P13 (écart de montant → revue → résolution), P7 (panne → 503, disjoncteur), P3/P8 (réconciliation, expiration), rapprochement quotidien (orpheline → traitée), espace parent et 403 ; matrice et isolation étendues.

## Prochaines étapes

1. Ouvrir les comptes sandbox FedaPay et KKiaPay des pilotes, enregistrer une transaction et un webhook réels par provider, ajuster les adaptateurs si un champ diffère (`infrastructure/*.provider.ts`, mappings dans `domain/attempts.ts`), rejouer les payloads dans `providers.test.ts`.
2. Staging : `PAYMENT_MASTER_KEY` dédiée, `PAYMENT_FAKE_PROVIDER_ENABLED=false` hors démo, `API_PUBLIC_URL` publique (URL de webhook), déclarer les webhooks chez les providers, tester bout en bout.
3. Live sur un établissement pilote volontaire (montants réels, deux semaines) : suivre « Transactions en attente » chaque matin, réconciliation à 0 écart comme KPI (G5).
4. Phase 6 — reporting et dashboards de direction (par provider, frais, délais de confirmation).
