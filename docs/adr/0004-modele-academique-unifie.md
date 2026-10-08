# ADR-0004 — Modèle académique unifié : Programme → Niveau → Groupe, `CourseOffering`, `Session`

- **Statut** : Proposée
- **Date** : 2026-10-06
- **Décideurs** : lead technique, product owner, validation par les établissements pilotes (atelier A1)
- **Références** : document directeur Partie 6 ; cadrage/ateliers-pilotes.md

## Contexte et problème

Le produit doit servir des écoles (Classe → Élèves → Matières → Enseignants → Emploi du temps → Séances) et des universités (Programme → Niveau → Semestre → UE → Groupe → Enseignant → Séance → Étudiants) sans devenir deux produits. L'appel, les statistiques, les notifications et la facturation doivent fonctionner à l'identique dans les deux cas.

## Options envisagées

1. **Deux modèles** (`SchoolClass` vs `UniversityGroup`, etc.) — double code sur tout le reste.
2. **Modèle université imposé aux écoles** — les écoles doivent créer des « programmes » et « UE » qui n'ont pas de sens pour elles.
3. **Hiérarchie générique à trois étages optionnels** (Programme → Niveau → Groupe) et **une seule unité d'enseignement** (`CourseOffering`), l'appel ne voyant que `Group`, `Enrollment`, `Session`.
4. Modèle entièrement libre (arbre de nœuds typés) — maximal en flexibilité, illisible en pratique et impossible à requêter efficacement.

## Décision

Nous retenons l'option 3 :

- `programs` (filière ou cycle ; une école a un programme par défaut créé automatiquement), `levels` (niveau ordonné dans un programme), `groups` (classe ou groupe de TD/TP : **l'unité à laquelle on inscrit et on fait l'appel**), avec `kind ∈ {CLASS, SUBGROUP}` et `parent_group_id` optionnel.
- `terms` (trimestre / semestre) optionnels, rattachés à une `academic_year`.
- `subjects` (matière / UE).
- **`course_offerings`** = une matière enseignée à un groupe pendant une année (et éventuellement une période), avec un ou plusieurs enseignants (`course_teachers`, rôle MAIN/ASSISTANT).
- `schedule_slots` : créneaux récurrents ; **`sessions`** : séances concrètes générées 14 jours à l'avance ou créées à la main. **La séance est la seule unité d'appel** ; un établissement sans emploi du temps crée une séance générique par jour et par groupe.
- `enrollments` : une inscription active par élève et par groupe `CLASS` et par année (index partiel unique) ; plusieurs `SUBGROUP` autorisés ; un changement de classe = clôture (`left_at`) + nouvelle ligne.
- L'élève appartient au tenant ; pas de référentiel d'identité élève inter-établissements.

Terminologie d'interface configurable par type de tenant (« Classe » / « Groupe », « Matière » / « UE », « Élève » / « Étudiant ») sans changer le modèle.

## Conséquences

### Positives

- Un seul code pour l'appel, les stats, les dashboards, la facturation par groupe/niveau/programme.
- Les cas universitaires (co-enseignement, TD rattachés à une promo, semestres) sont couverts sans tordre les écoles.
- Le modèle est validable rapidement sur un export réel (critère de sortie de la Phase 0).

### Négatives et risques acceptés

- Les UE optionnelles choisies individuellement par les étudiants demandent des `SUBGROUP` par UE et des inscriptions multiples : plus de lignes, mais pas de nouveau concept.
- Pas de gestion des prérequis, crédits ECTS, notes : hors scope assumé.
- Les établissements devront comprendre la notion de « séance » même sans emploi du temps formel.

### Ce que cette décision interdit

- Ajouter une entité spécifique à un type d'établissement sans ADR.
- Faire l'appel sur autre chose qu'une `Session`.
- Modéliser un élève hors de son tenant.

## Comment on saura qu'il faut la revoir

- Un établissement pilote présente une structure réelle qui ne se modélise pas sans exception (critère G0 non atteint).
- Besoin avéré de suivre un même élève sur plusieurs établissements (groupe scolaire) : ferait l'objet d'une ADR « organisation multi-établissements » en V2.
