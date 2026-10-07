# Onboarder un établissement (support, < 2 h, sans développeur)

Objectif G7 : un établissement non pilote opérationnel en moins de 2 heures. Le guide utilisateur détaillé est dans `docs/user-guide/onboarding.md` ; ce runbook est la checklist côté support.

## Avant le rendez-vous (15 min)

1. Plateforme → Établissements → **Créer** : code (minuscules-tirets, définitif), nom, type, fuseau, pays, e-mail de l'administrateur → une invitation part.
2. Vérifier que l'administrateur a reçu l'e-mail et créé son mot de passe (≥ 10 caractères) ; lui demander d'activer la **MFA** (Sécurité du compte) : obligatoire pour les actions sensibles.
3. Demander les fichiers : liste des élèves (CSV : matricule, nom, prénom, date de naissance, classe), liste des tuteurs (téléphone E.164, lien), structure (niveaux, classes), matières et emploi du temps, grilles de frais.

## Pendant (1 h 15)

Suivre l'**assistant de démarrage** (Établissement → Assistant de démarrage) avec l'administrateur ; chaque étape renvoie vers l'écran :

| Étape                         | Qui       | Durée  | Points d'attention                                                                        |
| ----------------------------- | --------- | ------ | ----------------------------------------------------------------------------------------- |
| Année scolaire                | admin     | 2 min  | marquer « courante »                                                                      |
| Niveaux et classes            | admin     | 10 min | programmes → niveaux → classes ; sous-groupes seulement si l'emploi du temps l'exige      |
| Matières, cours, créneaux     | admin     | 15 min | les séances se génèrent la nuit (14 jours glissants) ; « Générer maintenant » pour tester |
| Personnel invité              | admin     | 10 min | un rôle par personne ; la finance et la direction recevront l'obligation MFA              |
| Élèves importés               | scolarité | 15 min | **essai à blanc d'abord** (rapport d'erreurs), puis import réel ; matricules uniques      |
| Tuteurs rattachés, invités    | scolarité | 15 min | import des liens, vérification des homonymes, invitations SMS par vague                   |
| Règles d'assiduité, SMS       | admin     | 5 min  | seuil retard → absence, fenêtre de correction, plafond SMS                                |
| Frais (optionnel au jour 1)   | finance   | 10 min | catalogue, grilles par niveau, affectation de masse                                       |
| Paiement en ligne (optionnel) | admin     | 10 min | clés sandbox d'abord, test de connexion, puis clés live                                   |

## Après (15 min)

1. Un enseignant fait un premier appel (téléphone), le parent de test reçoit la notification : le circuit est validé (`first-sheet`).
2. Vérifier Plateforme → Vue d'ensemble : l'établissement apparaît avec ses effectifs ; pas d'alerte.
3. Remettre le guide utilisateur et le contact support ; planifier un point à J+7.

## Si ça bloque

- Import en erreur : télécharger le rapport (ligne, colonne, cause) ; les causes fréquentes sont les téléphones non E.164 (`+229…`) et les classes inexistantes.
- L'administrateur ne peut pas agir sur une action sensible : MFA non activée → Sécurité du compte.
- Besoin d'intervenir à sa place : session de support (`impersonation.md`), avec son accord.
