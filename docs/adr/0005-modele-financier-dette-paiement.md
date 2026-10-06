# ADR-0005 — Modèle financier : dette ≠ paiement, échéance = unité d'allocation, tentative ≠ paiement

- **Statut** : Proposée
- **Date** : 2026-10-06
- **Décideurs** : lead technique, product owner, responsable financier d'un établissement pilote (atelier A3)
- **Références** : document directeur Parties 6, 9, 10 ; ADR-0010

## Contexte et problème

Le module financier doit supporter des paiements partiels, groupés, des trop-perçus, des paiements manuels et électroniques, plusieurs tentatives pour une même dette, des remboursements futurs, et produire des reçus auditables. Un modèle `invoice.paid = true/false` ne le permet pas. Il faut aussi pouvoir **prouver** un solde à un parent ou à un commissaire aux comptes.

## Options envisagées

1. **Facture avec statut payé/impayé et un montant payé mis à jour** — simple, mais impossible de reconstituer qui a payé quoi, quand, et de gérer partiels et trop-perçus proprement.
2. **Grand-livre comptable complet** (écritures débit/crédit, plan comptable) — rigoureux, mais sur-dimensionné : nous ne faisons pas la comptabilité de l'établissement.
3. **Sous-grand-livre de créances** : échéances d'un côté, paiements de l'autre, allocations entre les deux ; montants dérivés.

## Décision

Nous retenons l'option 3 avec les règles suivantes :

- **Créance** : `fee_structures` (grille) → `fee_assignments` (trace d'affectation) → `student_fees` (agrégat par élève et par frais) → **`installments`** (échéance : montant, date d'échéance). **L'échéance est l'unité sur laquelle on alloue.** Les montants et dates sont copiés de la grille au moment de l'affectation (figés).
- **Argent reçu** : `payments` (montant, moyen, source `ELECTRONIC | MANUAL`, payeur, date de valeur), **immuable**.
- **Lien** : `payment_allocations (payment_id, installment_id, amount > 0)`, append-only. Σ allocations d'un paiement ≤ son montant ; Σ allocations d'une échéance ≤ son dû ; l'excédent devient `student_credits`.
- **Tentative ≠ paiement** : `payment_attempts` (intention, statut interne CREATED → … → SUCCEEDED/FAILED/CANCELLED/EXPIRED/UNKNOWN) et `provider_transactions` (miroir provider). **Seul un attempt SUCCEEDED vérifié serveur-à-serveur crée un `payment`**, protégé par `UNIQUE (attempt_id)`.
- **Modifications** : une échéance partiellement allouée n'est jamais modifiée ; on émet un `fee_adjustments` (montant signé, motif, approbateur). Une erreur de paiement manuel se corrige par annulation compensatoire (`CANCEL_PAYMENT` → statut REVERSED + reversal) puis nouvelle saisie.
- **Dérivation** : statut et `amount_allocated` d'une échéance et d'une `student_fee` sont recalculés par le service dans la transaction d'allocation ; un job nocturne vérifie l'égalité stocké = recalculé et alerte.
- **Reçus** : un par paiement, numéro `{CODE_ETAB}-{ANNEE}-{SEQ:6}` séquentiel par tenant et année (séquence sous advisory lock), `snapshot` figé, PDF en S3, QR de vérification, immuable ; un paiement reversé produit un reçu d'annulation.
- **Montants** : entiers (`BIGINT`) en XOF, colonne `currency` pour l'avenir.
- Les tables `payments`, `payment_allocations`, `receipts`, `fee_adjustments`, `webhook_events`, `audit_logs` sont **append-only** (trigger PostgreSQL qui refuse UPDATE/DELETE, sauf champs techniques listés).

## Conséquences

### Positives

- Partiels, groupés, trop-perçus, remboursements, annulations : tous représentables sans cas spécial.
- Un solde est prouvable ligne à ligne ; l'intégrité est vérifiable chaque nuit.
- Le module Payments ne connaît pas la notion de frais : il reçoit un montant et des cibles opaques.

### Négatives et risques acceptés

- Plus de tables et de règles qu'un simple statut « payé » ; l'UI doit présenter des agrégats simples (dû / payé / solde) par-dessus.
- Toute correction passe par une écriture compensatoire, ce qui surprend parfois les caissiers habitués à « modifier la ligne » (formation, écran d'annulation guidée).
- Pas de TVA, pas d'écritures comptables, pas de lettrage bancaire : exports CSV pour le comptable.

### Ce que cette décision interdit

- Saisir un « montant payé » à la main sur une créance.
- Modifier ou supprimer un paiement, une allocation, un reçu.
- Créer un paiement depuis un webhook sans vérification serveur-à-serveur.
- Créer deux paiements pour une même tentative.

## Comment on saura qu'il faut la revoir

- Obligation réglementaire de tenir une comptabilité générale dans la plateforme (peu probable : hors scope produit).
- Besoin de multi-devise avec conversions (V2) : ajouterait des taux, pas un changement de modèle.
