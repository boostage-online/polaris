# Fuite de données supposée (procédure d'incident et notification 72 h)

S'applique dès qu'une **exposition de données personnelles est possible** : fuite inter-tenant suspectée, secret compromis, accès non autorisé à la base ou aux journaux, perte d'un export, vulnérabilité exploitée.

## 0 — Déclarer (immédiat)

- Incident **S1** dans `#incident` (voir `incident.md`) : incident commander nommé, horodatage de découverte (**T0**, point de départ des 72 h).
- Ne rien purger : journaux, audit, sauvegardes sont des preuves.

## 1 — Contenir (< 1 h)

| Cause suspectée           | Action de confinement                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Compte compromis          | `POST /auth/logout-all` pour le compte (révocation globale) ; désactiver le compte ; forcer la MFA ; révoquer ses sessions de support            |
| Secret ou clé exposés     | Rotation immédiate (`rotate-secrets.md`) : clés JWT (invalide tous les jetons), clé maître (ré-enveloppement), secrets webhook, mots de passe DB |
| Vulnérabilité applicative | Désactiver la route ou le flag concerné ; déployer le correctif ; si impossible, mode lecture seule (`default_transaction_read_only`)            |
| Accès base non autorisé   | Révoquer les rôles, changer les mots de passe, fermer le bastion ; snapshot immédiat de la base pour l'enquête                                   |
| Export ou fichier perdu   | Identifier le contenu exact (`tenant_exports.entries`, `privacy_requests`) ; prévenir l'établissement                                            |

## 2 — Évaluer (< 24 h)

Objectif : **borner l'exposition** — quelles personnes, quelles données, quelle période, quelle probabilité d'exploitation.

- `audit_logs` (filtrer par acteur, période, `impersonated_by`), journaux API (`request_id`, `trace_id`), sessions (`refresh_tokens` : IP, agent).
- Quantifier : nombre d'élèves/tuteurs concernés par tenant (requêtes à conserver dans le dossier d'incident).
- Qualifier le risque pour les personnes (mineurs : élevé par défaut).

## 3 — Notifier

| Destinataire                                          | Délai                      | Contenu                                                                                                                              |
| ----------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Établissements concernés (responsables de traitement) | **< 24 h**                 | Nature, données, personnes, période, mesures prises, contact ; modèle `docs/communication/notification-violation.md`                 |
| Autorité (APDP ; CNIL si établissement UE)            | **< 72 h** après T0        | Via l'établissement (responsable) avec l'appui de Polaris ; Polaris notifie aussi en tant que sous-traitant si requis                |
| Personnes (parents, personnel)                        | Sans délai si risque élevé | Par l'établissement, texte fourni par Polaris : ce qui s'est passé, ce qu'on fait, ce qu'ils doivent faire (mot de passe, vigilance) |

## 4 — Clôturer

- Post-mortem sans blâme sous 5 jours : chronologie, cause racine, détection (pourquoi pas plus tôt ?), actions datées.
- Mettre à jour `threat-model.md`, `checklist.md`, et ajouter une alerte si la détection peut être automatisée.
- Dossier d'incident archivé (preuves, notifications envoyées, décisions) 5 ans.

## Exercice « fuite supposée » (semestriel, 90 min)

Scénario : un administrateur signale qu'un parent a vu un enfant qui n'est pas le sien.

1. Déclarer, nommer l'incident commander (5 min).
2. Confiner : délier, révoquer les sessions du tuteur, vérifier les liens créés par le même agent (15 min).
3. Évaluer : `audit_logs` → `guardian.link_created`, période, autres enfants vus (`notifications`, `/me/children` dans les journaux) (30 min).
4. Rédiger la notification à l'établissement (20 min) ; décider de la notification à l'autorité (grille de risque).
5. Débrief : ce qui a manqué (requêtes toutes prêtes ? modèles ?), consigner dans `exercise-log.md`.
