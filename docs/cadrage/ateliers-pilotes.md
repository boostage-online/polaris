# Ateliers avec les établissements pilotes — Phase 0

Objectif des ateliers : **valider sur des données réelles** le modèle académique (ADR-0004), le modèle financier (ADR-0005), les statuts d'assiduité (ADR-0006) et les parcours critiques, et **collecter** ce dont les phases 2 à 5 ont besoin (exports, règles, comptes providers). Sortie attendue : porte **G0** (décisions « avant développement » signées, structure et échéanciers des pilotes modélisables sans exception).

Cibles : **2 à 3 établissements** — un lycée (ou collège-lycée), une université ou grande école, idéalement un centre de formation. Chaque établissement reçoit trois ateliers d'1 h 30 et un panel parents de 45 min, sur deux semaines.

## Avant le premier atelier

- [ ] Lettre d'intention signée (périmètre pilote, confidentialité, pas d'engagement financier, droit de retrait).
- [ ] Interlocuteurs nommés : direction (sponsor), scolarité, vie scolaire, 2–3 enseignants, caisse/comptabilité, 1 référent informatique s'il existe.
- [ ] Exports demandés **avant** l'atelier A1 (formats existants, même Excel approximatif) : liste des classes/groupes et niveaux ; liste des élèves avec classe ; liste des parents avec téléphone ; emploi du temps d'une semaine type ; liste des enseignants et de leurs cours ; grille des frais de l'année et échéancier ; extrait anonymisé du registre de caisse d'un mois ; modèle de reçu actuel.
- [ ] Maquettes basse fidélité prêtes : appel enseignant (mobile), dashboard parent, écran de paiement, caisse, liste des impayés.
- [ ] Questionnaire de pré-cadrage envoyé (voir plus bas).

## Atelier A1 — Structure académique et scolarité (scolarité, direction, référent info)

Valide : ADR-0004, Phase 2.

| Question                                                                                                                    | Ce qu'on cherche à décider                                                                                                                        | Où ça atterrit                                                              |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Dessinez votre organisation : cycles/filières, niveaux, classes ou groupes, sous-groupes (TD, options, langues)             | Le modèle Programme → Niveau → Groupe (CLASS/SUBGROUP) couvre-t-il tout ? Cas limites : options individuelles, redoublants, classes multi-niveaux | Test de modélisation sur l'export réel pendant l'atelier ; exceptions → ADR |
| Combien de campus ? Des élèves ou enseignants circulent-ils entre eux ?                                                     | Besoin réel de `campuses` et de portée de rôle par campus                                                                                         | Phase 2 E1-S06                                                              |
| Année et périodes : dates, trimestres/semestres, sessions de rattrapage                                                     | `academic_years`, `terms`                                                                                                                         | Phase 2 E1-S02                                                              |
| Comment un élève entre, change de classe, part en cours d'année ? Qui le saisit, avec quel document ?                       | Workflow `enrollments`, proratisation éventuelle des frais                                                                                        | Phase 2 E3 ; Phase 4                                                        |
| Matricule : généré par vous, par le ministère, réutilisé d'une année sur l'autre ?                                          | Règle d'unicité et de génération                                                                                                                  | Phase 2 E3-S02                                                              |
| Emploi du temps : existe-t-il ? stable ? qui le maintient ? séances hors emploi du temps (rattrapages, sorties) ?           | Faisabilité de la génération de séances ; besoin d'une « séance générique par jour »                                                              | Phase 2 E2                                                                  |
| Co-enseignement, intervenants extérieurs, enseignants sur plusieurs établissements                                          | `course_teachers`, memberships multiples                                                                                                          | Phase 2 E2-S03                                                              |
| Qualité des données : format des téléphones, homonymes, parents multiples, familles recomposées                             | Règles d'import et de détection de doublons                                                                                                       | Phase 2 E5                                                                  |
| Qui a le droit de créer un lien parent-enfant ? Quelle preuve demandez-vous ? Un parent peut-il demander l'accès lui-même ? | Processus de rattachement (décision « avant production »)                                                                                         | ADR-0007 ; Partie 11                                                        |
| Logiciel actuel (le cas échéant) : export possible ? double saisie acceptable pendant le pilote ?                           | Scope des imports                                                                                                                                 | Phase 2 E5                                                                  |

Critère de sortie A1 : 100 % des groupes et des élèves de l'export se placent dans le modèle sans champ libre ; liste écrite des exceptions.

## Atelier A2 — Assiduité (vie scolaire, 2–3 enseignants, responsable pédagogique)

Valide : ADR-0006, Phase 3, maquette d'appel.

| Question                                                                                                                                       | Ce qu'on cherche à décider                                     | Où ça atterrit             |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------- |
| Comment se fait l'appel aujourd'hui (papier, cahier, rien) ? À quel moment du cours ? Qui le fait quand l'enseignant est absent ?              | Qui porte `TAKE_ATTENDANCE` / `TAKE_ATTENDANCE_ANY` par défaut | Phase 3 E1                 |
| Test de la maquette : chronométrer un appel de 40 élèves sur téléphone                                                                         | < 60 s ? gestes compris ?                                      | Maquette ; Phase 3 E1-S05  |
| Retard : à partir de combien de minutes ? au-delà de combien devient-il une absence ?                                                          | `late_to_absent_minutes` par défaut                            | Règles tenant              |
| Sortie anticipée : un statut à part entière ou une mention ? Compte-t-elle comme absence ?                                                     | Confirmer le choix « attribut » d'ADR-0006                     | ADR-0006                   |
| Absence justifiée : compte-t-elle dans le taux d'assiduité ? dans les sanctions ?                                                              | Deux lectures des rapports                                     | Phase 3 E4                 |
| Justificatifs : qui les reçoit (papier, WhatsApp, parent en personne) ? Délai ? Motifs acceptés ? Les parents peuvent-ils soumettre en ligne ? | Activation des justificatifs côté parent ; liste de motifs     | Règles tenant ; Phase 3 E3 |
| Erreurs d'appel : combien, comment corrigées, par qui, jusqu'à quand ?                                                                         | Fenêtre de correction (48 h ?), `EDIT_ATTENDANCE_LOCKED`       | Règles tenant ; Phase 3 E2 |
| Seuils : à partir de quand une absence devient-elle « répétée » ? qui est alerté ? que fait-on ?                                               | Seuils par défaut et destinataires                             | Phase 3 E4                 |
| Notification aux parents : quel délai est utile (immédiat / fin de matinée) ? quel canal ? que doit dire le message ?                          | Règles de notification, formulation (prénom + initiale)        | Phase 3 E5                 |
| Réseau dans les salles : couverture mobile, Wi-Fi ? téléphones des enseignants (Android ? âge ?)                                               | Priorité du mode hors ligne, cible de performance              | Phase 3 E1-S06             |
| Quels rapports regardez-vous aujourd'hui ? lesquels vous manquent ?                                                                            | Les 8 rapports MVP                                             | Phase 6                    |

Critère de sortie A2 : règles d'assiduité par défaut remplies pour ce tenant ; appel chronométré < 90 s sur maquette (cible 60 s après polissage) ; au moins deux enseignants volontaires pour le pilote.

## Atelier A3 — Frais et paiements (caisse, comptable, direction)

Valide : ADR-0005, ADR-0010, Phases 4–5.

| Question                                                                                                                               | Ce qu'on cherche à décider                                                                | Où ça atterrit                   |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------- |
| Listez tous vos frais, par niveau/programme, avec montants et échéances                                                                | `fee_categories`, `fee_structures`, échéanciers types ; cas de remises, bourses, fratries | Phase 4                          |
| Un même frais varie-t-il selon la classe, l'option, la nationalité, la date d'inscription ?                                            | Granularité des grilles ; ajustements                                                     | Phase 4                          |
| Que se passe-t-il pour un élève arrivé en janvier ? parti en mars ?                                                                    | Proratisation, annulation de créance                                                      | Phase 4 ; ADR-0005               |
| Comment encaissez-vous aujourd'hui ? espèces, dépôt bancaire, Mobile Money sur le numéro de l'école, chèque ? Qui saisit ? Quel reçu ? | Moyens de paiement manuels, format de reçu, numérotation actuelle                         | Phase 4 paiements manuels, reçus |
| Montrez un mois de registre de caisse : rapprochez-vous les dépôts avec les élèves ?                                                   | Besoin réel de rapprochement (V1/V2)                                                      | Backlog V1                       |
| Paiements partiels : acceptés ? minimum ? ordre d'imputation (plus ancienne échéance d'abord ?)                                        | Montant minimum, règle d'allocation                                                       | Phase 4 ; ADR-0005               |
| Trop-perçu, erreurs de caisse, remboursements : fréquence, procédure, qui autorise ?                                                   | Crédit automatique, annulation compensatoire, refund V1                                   | ADR-0005                         |
| Avez-vous déjà un compte FedaPay ou KKiaPay ? Au nom de qui ? Qui peut faire le KYC ? Quel délai ?                                     | Faisabilité Option A pour ce pilote                                                       | ADR-0010                         |
| Qui doit supporter la commission du provider : l'établissement, le parent, partagé ?                                                   | Décision « avant production »                                                             | Partie 2                         |
| Relances d'impayés : quand, par qui, par quel canal, quel ton ? Exclusion des cours pour impayé ?                                      | Rappels par défaut, événements                                                            | Phase 4                          |
| Numéro de reçu : exigences du commissaire aux comptes / de l'administration ? mentions obligatoires ?                                  | Convention `{CODE}-{ANNEE}-{SEQ}` et gabarit                                              | Partie 2 ; Phase 4               |
| Quels états financiers voulez-vous exporter vers votre comptable ? dans quel outil ?                                                   | Exports CSV MVP                                                                           | Phase 4                          |

Critère de sortie A3 : la grille et l'échéancier réels de l'établissement se modélisent sans exception ; compte provider existant ou démarche KYC lancée ; porteur des commissions proposé par la direction.

## Panel parents (4 à 6 parents, 45 min, par établissement)

- [ ] Montrer la maquette du dashboard parent et du paiement sur leur propre téléphone : compréhension, confiance, points de friction.
- [ ] Canal préféré pour être prévenu (SMS, push, WhatsApp, e-mail) et moment acceptable (immédiat ? jamais après 21 h ?).
- [ ] Ont-ils déjà payé en Mobile Money une institution ? Ce qui les a rassurés ou inquiétés ; ce qu'ils attendent d'un reçu.
- [ ] Combien d'enfants, dans combien d'établissements ; un seul compte pour tous ?
- [ ] Qui dans la famille doit avoir accès (deux parents, tuteur, grand-parent) ; qui paie.
- [ ] Message SMS type : lire « Kevin C. a été marqué absent au cours de Mathématiques à 08h05 » et recueillir la réaction (ton, informations manquantes ou en trop).

Sortie : 5 verbatims par panel, liste des frictions classées, préférence de canal par défaut.

## Validation technique en parallèle (équipe, semaine 2–3)

- [ ] Comptes sandbox FedaPay et KKiaPay ouverts ; une transaction de test par provider ; webhooks reçus sur un endpoint temporaire ; **enregistrer les payloads et en-têtes réels** (ils servent aux tests d'adaptateur) ; mesurer latence d'initiation, délai du webhook, comportement en annulation et en expiration.
- [ ] Confirmer les statuts provider réellement observés (tableau de mapping Partie 10) et les corriger dans le document directeur.
- [ ] Fournisseur SMS : devis, API, accusés de réception, test de 20 SMS vers les opérateurs locaux, délai moyen.
- [ ] Hébergement : latence mesurée depuis Cotonou vers 2–3 régions candidates ; coût mensuel estimé ; PITR disponible.
- [ ] KMS disponible chez l'hébergeur retenu (chiffrement d'enveloppe des clés provider).
- [ ] Pentester externe identifié et pré-réservé pour juin 2027.

## Synthèse et porte G0 (fin de semaine 3)

- [ ] Compte rendu par établissement (modèle, règles par défaut, exceptions, données reçues, contacts).
- [ ] ADR 0001–0010 passées en **Acceptée** ou amendées ; ADR-0010 signée par la direction.
- [ ] Document directeur mis à jour (statuts provider, hypothèses H1–H10 confirmées ou corrigées) et versionné dans `docs/architecture/`.
- [ ] Backlog Phase 1 ré-estimé en planning poker ; sprint 1 planifié.
- [ ] Liste des décisions « avant production » avec responsable et date cible pour chacune.
- [ ] Go/no-go formel pour la Phase 1 (lead, PO, direction).

## Questionnaire de pré-cadrage (à envoyer avant A1)

1. Type d'établissement, nombre d'élèves, de classes/groupes, d'enseignants, de campus.
2. Calendrier de l'année (début, fin, périodes, vacances).
3. Logiciel ou fichiers utilisés aujourd'hui pour les élèves, les présences, les frais.
4. Pourcentage approximatif de parents joignables par SMS ; par e-mail ; équipés d'un smartphone.
5. Moyens d'encaissement actuels et part estimée de chacun.
6. Compte Mobile Money ou provider de paiement existant (nom du titulaire).
7. Contraintes particulières : réglementation, tutelle, auditeurs, langue.
8. Les trois problèmes que vous voulez voir résolus en premier.
