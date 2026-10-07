# Provider de paiement hors ligne (exercice « provider coupé 1 h »)

## Symptômes

- Alerte `tenant:<id>:circuit:<provider>` ; parents : « paiement en cours de vérification » ou 503 à la création ; finance : tentatives `PENDING` qui s'accumulent, puis `UNKNOWN` en revue après expiration.
- Métrique `payments_provider_errors_total` en hausse ; file `payments` avec jobs en retry.

## Ce que fait le système tout seul

1. **Disjoncteur** : 5 erreurs réseau/min → provider déclaré indisponible 2 min → 503 immédiat à la création (le parent voit un message clair, aucune tentative fantôme).
2. **Confirmation différée** : les webhooks reçus sont stockés et rejoués par la file (6 essais, ≈ 10 min) ; le retour du parent sans réponse provider met la confirmation en file.
3. **Réconciliation** toutes les 5 min (backoff 2/5/10/20/40 min puis horaire) : dès que le provider répond, les tentatives ouvertes sont confirmées.
4. **Expiration** : au-delà de `expires_at + 24 h`, sans identifiant → `EXPIRED` ; avec identifiant mais provider muet → `UNKNOWN` + revue humaine.

## Actions

| Quand                          | Action                                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| < 30 min                       | Rien à faire côté Polaris. Vérifier la page de statut du provider ; prévenir les établissements concernés si l'incident provider est annoncé.                                                        |
| 30 min – 2 h                   | Message aux établissements (modèle `docs/communication/provider-indisponible.md`) : « paiements en ligne momentanément indisponibles, la caisse reste ouverte ».                                     |
| > 2 h, un seul provider touché | Bascule manuelle du tenant sur l'autre provider s'il a un compte : Paramètres → Paiement en ligne → activer l'autre provider (clés déjà saisies).                                                    |
| Retour du provider             | Vérifier que la file `payments` se vide, que « Transactions en attente » diminue ; lancer « Rapprocher hier » le lendemain matin ; aucune transaction `UNKNOWN` ne doit rester sans décision > 24 h. |
| Transactions `UNKNOWN`         | Finance → Paiements en ligne → Transactions en attente : « Re-vérifier » ; si le provider confirme un succès non enregistré, le paiement est créé automatiquement ; sinon « Résoudre » avec motif.   |

## Exercice (trimestriel, staging)

1. `POST /dev/fake-provider/outage {on:true}` (provider de démonstration) ou couper la sortie réseau vers le sandbox du provider.
2. Faire créer 3 tentatives par un compte parent de démo, envoyer 1 webhook pendant la panne.
3. Vérifier : 503 après le 5ᵉ échec, alerte `circuit` ouverte, aucun paiement créé, message parent.
4. Rétablir ; vérifier : tentatives confirmées en < 5 min, alerte résolue, réconciliation à 0 écart le lendemain.
5. Consigner durée et constats dans `docs/runbooks/exercise-log.md`.
