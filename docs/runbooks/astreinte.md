# Astreinte (Phase 8, à partir de la mise en production des pilotes)

Objectif G8 : disponibilité ≥ 99,5 % sur le mois, 0 incident S1, et surtout **quelqu'un qui répond** quand un établissement ne peut plus faire l'appel ou encaisser. L'astreinte n'est pas une surveillance permanente : la plateforme surveille (`alerts.md`, revue quotidienne `hypercare.md`) et prévient ; l'astreinte intervient.

## Organisation

| Élément        | Décision Phase 8                                                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plage couverte | **Lundi–samedi 6 h 30 – 20 h** (heure de Porto-Novo) : couvre le premier appel du matin et la fermeture de la caisse. Dimanche et nuit : alertes critiques uniquement.                       |
| Rotation       | 1 semaine par personne, du lundi 6 h 30 au lundi suivant ; 2 personnes minimum dans la rotation, un suppléant nommé.                                                                         |
| Canal          | E-mail des alertes (`platform-alert`) + canal `#astreinte` ; les établissements écrivent à `support@polaris.app` (lu par l'astreinte en journée).                                            |
| Délais         | Alerte **CRITICAL** : prise en compte < 15 min dans la plage, < 1 h hors plage. **WARNING** : < 2 h dans la plage, lendemain matin hors plage. Ticket établissement : accusé < 1 h en plage. |
| Pouvoirs       | Compte plateforme (MFA), accès au PaaS (logs, redéploiement, rollback), `psql` lecture seule ; écriture en base **sur ticket uniquement**.                                                   |
| Relève         | Lundi 9 h : 15 minutes, le sortant transmet les alertes ouvertes, les tickets en cours, les établissements en hypercare, la dernière revue acquittée.                                        |

## La journée type

1. **7 h** : lire la revue quotidienne (e-mail « Revue du … ») ; ouvrir Plateforme → Hypercare ; pour chaque établissement signalé, agir (`alerts.md`, `provider-offline.md`, `sms-quota.md`) ou décider que rien n'est à faire ; **acquitter** avec une note (ce qui a été fait, ce qui attend).
2. **En continu** : e-mails d'alerte ; tickets support (`docs/support/playbook-n1.md`).
3. **17 h** : Plateforme → Alertes : plus rien de CRITICAL ouvert ; Paiements en ligne → tentatives UNKNOWN traitées ou escaladées à l'établissement.
4. **Vendredi** : consulter Adoption ; établissements sous 70 % de parents activés après 3 semaines → appel au chef d'établissement (relance des invitations par vague, affiche à l'accueil, SMS de rappel).

## Escalade

| Situation                                                                | Vers                              | Comment                                        |
| ------------------------------------------------------------------------ | --------------------------------- | ---------------------------------------------- |
| S1 (`incident.md`) : indisponibilité, fuite suspectée, argent mal alloué | Responsable technique + direction | Appel téléphonique, puis `#incident`           |
| Correctif de code nécessaire                                             | Équipe de développement           | Ticket avec `trace_id`, étapes de reproduction |
| Provider de paiement injoignable > 2 h                                   | Contact provider + établissements | `provider-offline.md`, modèle de message       |
| Demande juridique / données personnelles                                 | Référent données personnelles     | `data-breach.md`                               |

## Ce que l'astreinte ne fait pas

- Pas de session de support sans accord de l'administrateur (sauf S1 documenté) : `impersonation.md`.
- Pas de modification en base sans ticket revu par une seconde personne.
- Pas de promesse de délai à un établissement sans l'avoir vérifié avec l'équipe.

## Indicateurs mensuels (revue du 1er du mois)

Disponibilité mesurée (Plateforme → Hypercare, objectif ≥ 99,5 %), nombre d'alertes CRITICAL et délai moyen de prise en compte, incidents S1/S2 et post-mortems rendus, tickets support et délai d'accusé, établissements sous le seuil G8 d'activation des parents.
