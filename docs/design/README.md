# Design Polaris — système de design et maquettes

Référence visuelle de l'application web (Next.js) et des apps mobiles (Flutter). Tout écran nouveau ou refait suit ce dossier ; en cas de doute, **la maquette fait foi pour l'apparence, l'API fait foi pour les données**.

| Élément                        | Où                                                                                           | Rôle                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Maquette interactive (canevas) | Artefact « Polaris — maquette de l'application » (lien fourni par le propriétaire du projet) | Vue d'ensemble, commentaires                                                  |
| Sources des maquettes          | [`maquettes/`](./maquettes/)                                                                 | HTML de chaque écran : structure, libellés exacts, couleurs, tailles          |
| Jetons                         | [`tokens.css`](./tokens.css), [`tokens.json`](./tokens.json)                                 | Couleurs, typo, espacements, rayons — à importer, jamais à recopier à la main |
| Captures de l'existant         | [`captures-actuelles/`](./captures-actuelles/)                                               | État d'octobre 2026, avant refonte (workflow « Captures d'écran »)            |

Les fichiers `maquettes/*.dc.html` sont des composants de canevas : lisez-les comme du HTML (le `<div>` racine et son contenu) ; la ligne `support.js` et le bloc `<script type="text/x-dc">` sont propres à l'outil de maquette et ne sont pas à reproduire.

## Les écrans maquettés

| Fichier                 | Écran                                                                                                        | Cible web                               | Cible Flutter                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------ |
| `Main.dc.html`          | Système de design : couleurs, typo, boutons, statuts, champ, indicateur, règles                              | `apps/web/src/components/ui.tsx`        | `lib/core/theme/`, `lib/core/widgets/`     |
| `Direction.dc.html`     | Tableau de bord de direction (menu latéral nuit, 4 KPI, présence hebdo, encaissements, classes à surveiller) | `app/(app)/direction` + `app-shell.tsx` | — (web uniquement)                         |
| `FicheEleve.dc.html`    | Fiche élève (assiduité, frais, tuteurs)                                                                      | `app/(app)/students/[id]`               | —                                          |
| `Connexion.dc.html`     | Connexion parent par OTP SMS (6 cases)                                                                       | `app/login` (onglet parent)             | `features/auth/`                           |
| `ParentAccueil.dc.html` | Parent : alerte d'absence, cartes enfants, barre d'onglets                                                   | `app/(app)/children`                    | `features/children/`                       |
| `ParentEnfant.dc.html`  | Parent : frais (reste à payer, Mobile Money, échéancier, reçus)                                              | `app/(app)/children/[studentId]`        | `features/children/`, `features/payments/` |
| `Appel.dc.html`         | Enseignant : appel P/A/R, brouillon hors ligne, envoi                                                        | `app/(app)/attendance/sessions/[id]`    | `features/attendance/` (V1.1)              |

## Principes

1. **Mobile d'abord pour les parents et les enseignants.** 390 px de large est la référence ; aucun défilement horizontal ; cibles tactiles de 48 px ; texte courant 16 px minimum.
2. **Une seule action principale par écran.** Le **safran** est réservé aux deux gestes qui comptent : _envoyer l'appel_ et _payer_. Le bleu sert aux actions courantes.
3. **Les statuts ne reposent jamais sur la couleur seule** : pastille = fond clair + texte foncé + icône + libellé (Présent, Absent, Retard 10 min, Excusé, Payé, Partiel, En retard, À venir).
4. **Les montants** : chiffres tabulaires, espace entre milliers, « FCFA » après (`90 000 FCFA`) ; dates `jj/mm/aaaa`, heures `08:00`, fuseau de l'établissement.
5. **Le français est la langue de l'interface** : vouvoiement, phrases courtes, verbes d'action (« Justifier l'absence », « Payer par Mobile Money »). Une erreur dit quoi faire, pas un code.
6. **Accessibilité WCAG 2.1 AA** : contraste 4,5:1 (vérifié sur la palette), vrais `<button>`/`<a>`/`<label>`, `aria-label` sur les boutons-icônes, focus visible (`--focus-ring`).
7. **Pas d'emoji ni de dégradés** ; icônes SVG au trait, 20–22 px (web : un composant `Icon` en SVG en ligne, ou `lucide-react` si on décide de l'ajouter ; Flutter : icônes Material « outlined »).

## Polices

Sora (titres, chiffres clés) et Inter (texte) : Google Fonts, licence OFL. Web : `next/font/google`. Flutter : fichiers `.ttf` embarqués dans `assets/fonts/` (pas de téléchargement au lancement : les réseaux mobiles sont lents).

## Ce que la refonte doit corriger (relevé sur les captures actuelles)

- Espace parent sur téléphone : contenu plus large que l'écran (échéancier en tableau, champs de date) → listes empilées comme dans `ParentEnfant.dc.html`.
- Champs de date affichés selon la langue du navigateur (« mm/dd/yyyy ») → composant de date maison au format `jj/mm/aaaa`.
- Écrans vides peu explicites (« — », « Aucune donnée ») → états vides rédigés (« Aucun appel cette semaine : les données apparaîtront après le premier appel »).
- Pas d'identité visuelle → logo étoile, palette nuit/safran, typographie Sora/Inter.
