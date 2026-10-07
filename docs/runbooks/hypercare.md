# Hypercare : revue quotidienne après une mise en production

Pendant **4 semaines** après la bascule d'un établissement (`hypercare_until`, modifiable à la mise en production), la plateforme produit chaque matin à **7 h** une revue qui répond à la question du document directeur : « les alertes, les tentatives UNKNOWN, les quotas SMS, les erreurs d'import ont-ils été revus aujourd'hui ? ». La revue couvre tout le parc, et détaille chaque établissement en hypercare même quand tout va bien.

## Où

- E-mail « [Polaris] Revue du JJ : journée saine » ou « … : N établissement(s) à regarder », envoyé aux comptes plateforme.
- Plateforme → **Hypercare** : liste des 30 dernières revues, détail, acquittement ; en haut, la disponibilité mesurée sur 30 jours (objectif G8 : ≥ 99,5 %).
- Bouton « Générer la revue du jour » pour une revue à la demande (régénère sans renvoyer d'e-mail).

## Lire une revue en 5 minutes

| Indicateur                          | Seuil d'action                                     | Action                                                                                                                               |
| ----------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Disponibilité 24 h                  | < 99,5 %                                           | Regarder les sondes en échec (Plateforme → Hypercare, dernière sonde) ; corréler aux déploiements ; `incident.md` si > 1 h cumulée   |
| Alertes ouvertes (critiques)        | ≥ 1 critique, ou avertissement > 24 h              | `alerts.md`                                                                                                                          |
| Tentatives UNKNOWN                  | ≥ 1                                                | Paiements en ligne → à vérifier : `verify()` provider, décision humaine, puis l'établissement informe le parent                      |
| Tentatives en attente > 1 h         | ≥ 1                                                | Souvent un parent qui a abandonné : l'expiration automatique les clôt à 24 h ; si nombreuses, provider lent → `provider-offline.md`  |
| Réconciliation avec écarts / erreur | ≥ 1                                                | Finance de l'établissement → Réconciliation : orphelins (paiement provider sans tentative) et écarts de montant ; résoudre avec note |
| Écarts d'intégrité du grand-livre   | ≥ 1                                                | **Incident S1 potentiel** : figer (pas de correction manuelle), ticket équipe, `incident.md`                                         |
| Quota SMS ≥ 80 %                    | 1 établissement                                    | `sms-quota.md` : prévenir l'administrateur, bascule in-app, relever le plafond si budget validé                                      |
| Imports en échec (24 h)             | ≥ 1                                                | Rapport d'erreurs de l'import (Imports) ; appeler la scolarité si récurrent (format de fichier)                                      |
| Notifications en échec (24 h)       | ≥ 5                                                | Journal des notifications → tracer ; fournisseur SMS ou numéros invalides                                                            |
| Appels non réalisés (hier)          | > 20 % des séances d'un établissement en hypercare | Appeler la direction : adoption enseignants (champions, formation 30 min, délégation à la vie scolaire)                              |
| Parents activés (+N)                | 0 pendant 3 jours en hypercare                     | Relancer les invitations par vague (Tuteurs → Inviter), vérifier le fournisseur SMS                                                  |

## Acquitter

L'acquittement dit **qui a lu, quand, et ce qui a été décidé**. Une note suffit : « UNKNOWN #… vérifiée OK ; SMS lycée X : plafond relevé à 3 000 après accord ; rien d'autre ». Une revue non acquittée à 17 h apparaît en « à lire » : c'est le signal de relève (`astreinte.md`).

## Sortie d'hypercare

À `hypercare_until`, l'établissement reste dans la revue (indicateurs du parc) mais n'est plus détaillé s'il n'a aucun point d'attention. Avant la sortie : point avec le chef d'établissement (adoption, retours), vérification du seuil G8 (≥ 70 % de parents activés), budget SMS du mois suivant confirmé.

## Exercice

Une fois par trimestre, simuler une journée « malade » sur staging (alerte critique + tentative UNKNOWN + import en échec) et vérifier que la revue du lendemain les liste, que l'e-mail part, et que l'acquittement est tracé. Consigner dans `exercise-log.md`.
