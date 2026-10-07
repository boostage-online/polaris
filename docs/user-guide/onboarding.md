# Mettre votre établissement en service (guide de l'administrateur)

Durée : environ **2 heures** avec vos fichiers sous la main. Vous pouvez vous arrêter et reprendre à tout moment : l'**assistant de démarrage** (menu Établissement → Assistant de démarrage) garde la trace de ce qui est fait et vous renvoie vers le bon écran pour chaque étape.

## Avant de commencer

Vous avez reçu un e-mail d'invitation de Polaris. Il contient un lien valable 7 jours.

1. Cliquez sur le lien, choisissez un **mot de passe d'au moins 10 caractères** (une phrase est idéale).
2. Connectez-vous. Vous arrivez sur votre tableau de bord ; un encart « Mise en service » indique l'avancement (par exemple « 2 étapes sur 12 »).
3. Préparez vos fichiers :
   - liste des élèves (tableur : matricule, nom, prénom, date de naissance, sexe, classe) ;
   - liste des parents ou tuteurs (nom, prénom, **téléphone au format international** `+229…`, lien avec l'élève : père, mère, tuteur) ;
   - la structure : niveaux, classes, éventuellement sous-groupes ;
   - les matières et l'emploi du temps ;
   - les grilles de frais par niveau (facultatif le premier jour).

## Les 12 étapes de l'assistant

L'assistant se met à jour automatiquement : une étape passe en vert dès que l'application constate que c'est fait (par exemple « au moins une classe créée »). Trois étapes sont facultatives et peuvent être **ignorées** (bouton « Ignorer ») si elles ne vous concernent pas encore.

| #   | Étape                               | Où                        | Ce qu'il faut faire                                                                                                                                                                                                                    |
| --- | ----------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Année scolaire courante             | Structure académique      | Créer l'année (dates de début et de fin, périodes) et la marquer **courante**.                                                                                                                                                         |
| 2   | Niveaux et classes                  | Structure académique      | Créer les programmes et niveaux, puis les classes. Les sous-groupes (langue, option) ne sont utiles que si l'emploi du temps les sépare.                                                                                               |
| 3   | Matières, cours et emplois du temps | Cours et emplois du temps | Créer les matières, puis un cours par (classe, matière, enseignant), puis ses créneaux hebdomadaires. Les séances se génèrent chaque nuit pour 14 jours ; « Générer maintenant » pour vérifier tout de suite.                          |
| 4   | Personnel invité                    | Personnel                 | Inviter chaque membre avec **un rôle** (direction, scolarité, finance, enseignant…). Chacun reçoit un e-mail et choisit son mot de passe.                                                                                              |
| 5   | Élèves importés                     | Imports                   | Importer le fichier des élèves. Faites d'abord un **essai à blanc** : l'application vous rend un rapport ligne par ligne (classe inconnue, doublon de matricule, date invalide). Corrigez le fichier, puis importez pour de bon.       |
| 6   | Tuteurs rattachés et invités        | Tuteurs                   | Importer les tuteurs et leurs liens avec les élèves, puis **inviter** par vagues (une classe à la fois) : chaque tuteur reçoit un SMS avec un code pour activer son espace parent.                                                     |
| 7   | Règles d'assiduité                  | Paramètres                | Seuil de retard comptant comme absence, fenêtre pendant laquelle un enseignant peut corriger un appel, délai de justification.                                                                                                         |
| 8   | Notifications et quota SMS          | Paramètres                | Choisir quels événements envoient un SMS (absence, retard, échéance, reçu) et fixer le plafond mensuel de SMS. Au-delà, les messages restent dans l'application.                                                                       |
| 9   | Grilles de frais et affectation     | Catalogue des frais       | _Facultatif au jour 1._ Créer les frais, les grilles par niveau, puis affecter en masse aux élèves inscrits.                                                                                                                           |
| 10  | Paiement en ligne                   | Paiement en ligne         | _Facultatif._ Renseigner les clés du compte marchand (FedaPay ou KKiaPay) en **bac à sable** d'abord, tester la connexion, puis passer aux clés réelles.                                                                               |
| 11  | MFA de l'administrateur             | Sécurité du compte        | Activer la double authentification. Elle est **obligatoire** pour les actions financières sensibles (encaisser, annuler, rembourser, clés de paiement en ligne) et recommandée pour tout administrateur. Voir `securite-du-compte.md`. |
| 12  | Premier appel soumis                | Feuilles d'appel          | Demander à un enseignant de faire son premier appel depuis son téléphone. Le parent de test reçoit la notification : votre établissement est en service.                                                                               |

## Après la mise en service

- **Point à J+7** avec le support : taux d'activation des parents (visible dans Direction), appels non réalisés, questions des enseignants.
- Les tuteurs qui n'ont pas activé leur espace peuvent être réinvités depuis leur fiche ; la liste « Activation des parents » (Rapports) donne les retardataires.
- Vous pouvez à tout moment exporter l'ensemble de vos données (Rapports → Export complet) : c'est votre copie, elle vous appartient.

## En cas de problème

| Symptôme                                         | Cause probable                                         | Solution                                                                    |
| ------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| Import refusé, « téléphone invalide »            | numéro sans indicatif ou avec espaces                  | Format `+22997000000` (pas d'espace, pas de 00)                             |
| Import refusé, « classe inconnue »               | libellé différent de celui créé à l'étape 2            | Utiliser exactement le code de la classe, ou créer la classe manquante      |
| « Double authentification requise » sur un écran | MFA non activée sur votre compte                       | Sécurité du compte → Activer                                                |
| Un enseignant ne voit pas ses séances            | cours sans créneau, ou créneau hors période de l'année | Vérifier le cours, puis « Générer maintenant »                              |
| Les parents ne reçoivent pas le SMS              | plafond mensuel atteint, ou numéro erroné              | Paramètres → Notifications ; fiche du tuteur                                |
| Vous ne retrouvez pas une action                 | votre rôle ne la permet pas                            | Le menu ne montre que ce que votre rôle permet ; voir avec l'administrateur |

Si cela ne suffit pas : `support@polaris.app` avec le code de votre établissement.
