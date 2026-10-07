# Sécurité du compte

Menu : **Sécurité du compte** (visible par tout le personnel et par les administrateurs plateforme).

## Mot de passe

Au moins 10 caractères. Une phrase mémorisable (« les manguiers fleurissent en mars ») vaut mieux qu'un mot compliqué. Après plusieurs échecs, la connexion est bloquée quelques minutes, puis de plus en plus longtemps : c'est normal, attendez puis réessayez. Si vous avez oublié votre mot de passe, demandez à votre administrateur de vous **réinviter**.

## Double authentification (MFA)

La MFA ajoute un code à 6 chiffres, généré par une application sur votre téléphone, à chaque connexion. Elle est **obligatoire** pour :

- les actions financières sensibles : enregistrer un paiement en caisse, annuler un paiement, rembourser, configurer les clés de paiement en ligne (rôles finance et administrateur) ;
- les administrateurs de la plateforme Polaris, sur toutes leurs actions.

Elle est recommandée à tout le personnel ayant accès aux fiches des élèves.

Sans elle, ces écrans affichent « Double authentification requise ».

### Activer

1. Installez une application d'authentification (Google Authenticator, Microsoft Authenticator, Aegis, FreeOTP…).
2. Sécurité du compte → **Activer la double authentification**. L'écran affiche une **clé** à recopier dans l'application (ou un lien à ouvrir depuis le téléphone). Compte : votre e-mail ; émetteur : Polaris.
3. Saisissez le code à 6 chiffres affiché par l'application pour confirmer.
4. **Enregistrez les 8 codes de récupération** affichés une seule fois (imprimez-les ou rangez-les dans un gestionnaire de mots de passe). Chaque code ne sert qu'une fois.

### Se connecter

Après l'e-mail et le mot de passe, saisissez le code de l'application. Le code change toutes les 30 secondes ; un code déjà utilisé est refusé. Si l'heure de votre téléphone est fausse, les codes seront refusés : activez l'heure automatique.

### Téléphone perdu

Connectez-vous avec un **code de récupération** à la place du code à 6 chiffres, puis : Sécurité du compte → **Régénérer les codes** (les anciens sont annulés) et, si vous avez un nouveau téléphone, **Désactiver** puis **Activer** la MFA pour l'enrôler. Plus de codes de récupération : votre administrateur (Personnel → **Réinitialiser la MFA**, ou le support Polaris pour un administrateur) vérifie votre identité et réinitialise votre MFA ; toutes vos sessions sont fermées, vous vous reconnectez avec votre mot de passe et réactivez la MFA ; l'opération est journalisée.

### Désactiver

Possible uniquement en saisissant un code valide. Si votre rôle l'exige, vous serez de nouveau bloqué sur les actions sensibles jusqu'à réactivation.

## Appareils connectés

La liste montre chaque appareil connecté (navigateur, date, adresse IP approximative). **Déconnecter** un appareil que vous ne reconnaissez pas, puis changez votre mot de passe. « Déconnecter partout » ferme toutes les sessions, y compris la vôtre.

## Session de support

Quand un employé Polaris intervient sur votre établissement avec votre accord, une **bannière orange** l'indique pendant toute la session (30 minutes maximum), et chaque action apparaît dans le **Journal d'audit** avec la mention « via le support ». Le support ne peut ni encaisser, ni rembourser, ni modifier les rôles, ni voir les clés de paiement.

## Bonnes pratiques pour l'établissement

- Un compte par personne ; jamais de compte partagé « secrétariat ».
- Retirer le rôle d'une personne qui quitte l'établissement (Personnel → Désactiver) : l'effet est immédiat.
- Vérifier le Journal d'audit une fois par mois : connexions inhabituelles, modifications de rôles, exports.
