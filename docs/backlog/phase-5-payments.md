# Phase 5 — Paiements électroniques

**Fenêtre** : 22 mar → 30 avr 2027 (6 semaines, 3 sprints), puis paiement live sur un établissement en mai. **Objectif** : un parent paie une échéance par Mobile Money depuis son téléphone ; l'argent arrive sur le compte de l'établissement ; le reçu arrive sur son téléphone. **Porte G5** (deux semaines de live pilote) : 100 % des paiements réussis côté provider ont un paiement et un reçu chez nous (réconciliation quotidienne à 0 écart) ; 0 double paiement ; délai médian succès provider → reçu < 60 s ; aucune clé provider lisible hors du module.

**ADR mises en œuvre** : 0005, 0010, 0003, 0007. **Prérequis** : G4 ; contrats providers et comptes marchands des pilotes (Option A) ; décision sur les commissions et le porteur des frais.

| Epic | Titre                                                  | Points  | Must |
| ---- | ------------------------------------------------------ | ------- | ---- |
| E1   | Port provider, adaptateurs, registre, disjoncteur      | 21      | ✔    |
| E2   | Comptes marchands par établissement (secrets chiffrés) | 13      | ✔    |
| E3   | Tentatives, création, parcours parent                  | 21      | ✔    |
| E4   | Webhooks, confirmation, idempotence                    | 21      | ✔    |
| E5   | Réconciliation, expiration, DLQ, revue humaine         | 21      | ✔    |
| E6   | Écrans finance et administration, notifications        | 13      | ✔    |
| E7   | Sandbox bout en bout et bascule live                   | 13      | ✔    |
|      | **Total**                                              | **123** |      |

> **État (PR #5, octobre 2026)** : E1 à E6 livrés avec leurs écrans et testés en CI sur le provider de démonstration (scénarios P1–P15). E7 reste à faire sur les comptes sandbox réels des pilotes (payloads enregistrés, bascule live). Reporté : E1-S05 remboursements provider (V1), E3-S06 choix du provider par le parent, E5-S06 charge et chaos (Phase 7). Détail : `docs/handover-phase-5.md`.

---

## E1 — Port provider et adaptateurs

| ID        | Story                                                                                                                          | Critères d'acceptation                                               | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | --- | ---- |
| P5-E1-S01 | [Tech] Port `PaymentProvider` (initiate, verify, parseWebhook, listTransactions, healthCheck) et statuts internes normalisés   | Mapping pur par adaptateur, testé exhaustivement ; inconnu → UNKNOWN | 3   | M    |
| P5-E1-S02 | [Tech] Adaptateur FedaPay : création serveur → URL, GET transaction, webhook HMAC horodaté, liste des transactions             | Tests sur payloads (signature, corps altéré, horodatage périmé)      | 5   | M    |
| P5-E1-S03 | [Tech] Adaptateur KKiaPay : widget client (clé publique, `data = attempt_id`), statut via trois clés, webhook à secret partagé | `parseWebhook` n'extrait que l'identifiant ; `verify` fait foi       | 5   | M    |
| P5-E1-S04 | [Tech] FakeProvider : états pilotables, panne simulable, webhooks signés rejouables ; caisse factice web                       | Sert aux tests et aux démos ; interdit en production                 | 3   | M    |
| P5-E1-S05 | Remboursements provider (`refund`) et avoirs                                                                                   | P18                                                                  | 5   | C    |
| P5-E1-S06 | [Tech] Registre d'adaptateurs et disjoncteur par (tenant, provider)                                                            | 5 échecs/min → ouvert 2 min → 503 immédiat ; refermé après délai     | 3   | M    |

## E2 — Comptes marchands (Option A)

| ID        | Story                                                                                                                                       | Critères d'acceptation                                                     | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --- | ---- |
| P5-E2-S01 | [Tech] `tenant_payment_configs` (mode, environnement, secrets chiffrés par enveloppe, jeton de webhook, statut)                             | Jamais une clé en clair en base ni dans `tenants.settings`                 | 5   | M    |
| P5-E2-S02 | En tant qu'administrateur, je veux saisir les clés de mon provider, voir l'URL de webhook à déclarer et tester la connexion avant d'activer | Clés masquées à l'affichage ; test réussi → actif ; un seul provider actif | 5   | M    |
| P5-E2-S03 | [Tech] Port `KeyWrapper` (clé maître locale → KMS), `PAYMENT_MASTER_KEY` obligatoire en production                                          | Rotation documentée                                                        | 3   | M    |

## E3 — Tentatives et parcours parent

| ID        | Story                                                                                                                                  | Critères d'acceptation                                                                      | Pts | Prio |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --- | ---- |
| P5-E3-S01 | [Tech] `payment_attempts`, `provider_transactions` (UNIQUE provider/external_id, UNIQUE attempt_id), machine d'états                   | Tests unitaires de la machine d'états                                                       | 5   | M    |
| P5-E3-S02 | En tant que parent, je veux démarrer un paiement (prochaine échéance, tout le solde, montant libre) afin de payer depuis mon téléphone | `min ≤ montant ≤ solde` ; `Idempotency-Key` ; création hors transaction ; expiration 30 min | 5   | M    |
| P5-E3-S03 | En tant que parent, je veux être redirigé vers le provider (ou voir le widget) puis revenir sur une page « en cours de vérification »  | Redirection automatique ; widget KKiaPay ; polling 3 s / 2 min ; reçu PDF au succès         | 5   | M    |
| P5-E3-S04 | En tant que parent, je veux comprendre pourquoi un paiement a échoué et pouvoir réessayer                                              | Messages traduits ; nouvelle tentative = nouvel enregistrement ; notification d'échec       | 3   | M    |
| P5-E3-S05 | En tant que parent, je veux retrouver l'historique de mes tentatives et vérifier celles en attente                                     | Historique sur la fiche enfant                                                              | 2   | S    |
| P5-E3-S06 | Choix du provider par le parent, routage automatique (`PaymentRoutingPolicy`)                                                          | V1                                                                                          | 5   | C    |

## E4 — Webhooks et confirmation

| ID        | Story                                                                                                                                                   | Critères d'acceptation                                                                      | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --- | ---- |
| P5-E4-S01 | [Tech] Endpoint webhook par (provider, jeton) : signature, trace `webhook_events` (UNIQUE événement), mise en file, 200 < 200 ms, aucune logique métier | Signature invalide → 400 + log sécurité ; endpoint inconnu → 404 ; doublon → 200 sans effet | 5   | M    |
| P5-E4-S02 | [Tech] `ConfirmAttempt` : `verify` hors transaction, `FOR UPDATE`, seul SUCCEEDED crée un paiement via le grand-livre                                   | Deux confirmations concurrentes → un paiement ; dix webhooks → un traitement                | 8   | M    |
| P5-E4-S03 | [Tech] Écart de montant ou statut inconnu → UNKNOWN + revue, jamais d'allocation                                                                        | Événement `PaymentReviewNeeded` ; alerte finance                                            | 3   | M    |
| P5-E4-S04 | [Tech] File `payments` avec retries exponentiels et DLQ ; webhook arrivé avant l'identifiant (KKiaPay) réessayé                                         | P15                                                                                         | 5   | M    |

## E5 — Réconciliation et revue humaine

| ID        | Story                                                                                                                                 | Critères d'acceptation                                           | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --- | ---- |
| P5-E5-S01 | [Tech] `ReconcilePendingAttempts` (5 min, backoff par tentative, arrêt pendant une panne)                                             | P3, P8                                                           | 5   | M    |
| P5-E5-S02 | [Tech] `ExpireStaleAttempts` (15 min) : sans identifiant → EXPIRED ; provider muet → UNKNOWN + revue                                  | Tests                                                            | 3   | M    |
| P5-E5-S03 | [Tech] `DailyProviderReconciliation` (J−1) : orphelins, écarts, confirmation des succès en attente                                    | `UNSUPPORTED` si le provider ne liste pas                        | 5   | M    |
| P5-E5-S04 | En tant que responsable financier, je veux un écran « transactions en attente » avec « Re-vérifier » et « Résoudre (motif) », audités | Revues ouvertes, en attente > 30 min, orphelines, santé provider | 5   | M    |
| P5-E5-S05 | [Tech] `LedgerIntegrityCheck` étendu : Σ paiements ELECTRONIC = Σ transactions SUCCEEDED, aucun paiement sans tentative SUCCEEDED     | Nocturne                                                         | 2   | S    |
| P5-E5-S06 | [Tech] Charge 100 webhooks/s et chaos « provider coupé 10 min »                                                                       | k6 ; aucun doublon, réconciliation complète                      | 3   | S    |

## E6 — Écrans et notifications

| ID        | Story                                                                                                                   | Critères d'acceptation                                    | Pts | Prio |
| --------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --- | ---- |
| P5-E6-S01 | En tant que responsable financier, je veux la liste des tentatives (filtres) et la chronologie complète d'une tentative | Sans clé ni corps brut provider                           | 5   | M    |
| P5-E6-S02 | En tant que parent, je veux être notifié d'un paiement réussi (reçu) ou non abouti                                      | `PAYMENT_RECEIVED` SMS + in-app ; `PAYMENT_FAILED` in-app | 3   | M    |
| P5-E6-S03 | En tant que responsable financier, je veux être alerté d'une transaction à traiter                                      | `PAYMENT_REVIEW_NEEDED` in-app + e-mail                   | 2   | M    |
| P5-E6-S04 | Reçu : mention « Encaissé par {établissement} via {provider} »                                                          | PDF et instantané                                         | 3   | M    |

## E7 — Sandbox réel et bascule live

| ID        | Story                                                                                                                            | Critères d'acceptation                       | Pts | Prio |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --- | ---- |
| P5-E7-S01 | Comptes sandbox FedaPay et KKiaPay des pilotes ; transaction et webhook réels enregistrés ; adaptateurs ajustés                  | Payloads rejoués dans les tests d'adaptateur | 5   | M    |
| P5-E7-S02 | Staging bout en bout sur les deux providers (`API_PUBLIC_URL`, webhooks déclarés, clé maître dédiée, provider de démo désactivé) | Un paiement sandbox par provider avec reçu   | 3   | M    |
| P5-E7-S03 | Bascule live d'un établissement volontaire sur des montants réels ; suivi quotidien des transactions en attente                  | G5 mesuré sur deux semaines                  | 5   | M    |
