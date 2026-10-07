# ADR-0006 — Statuts d'assiduité : trois statuts + axe d'excuse + durées

- **Statut** : Proposée
- **Date** : 2026-10-06
- **Décideurs** : lead technique, product owner, vie scolaire d'un établissement pilote (atelier A2)
- **Références** : document directeur Partie 8

## Contexte et problème

Le brief propose `Present, Absent, Late, Excused, EarlyDeparture`. Une absence peut être justifiée, en attente de justificatif ou refusée ; un retard a une durée ; une sortie anticipée concerne un élève présent. Mettre tout cela dans une seule énumération produit des combinaisons (`LATE_EXCUSED`, `ABSENT_PENDING`, `PRESENT_LEFT_EARLY_EXCUSED`…) qui explosent et rendent les statistiques fausses (un élève excusé compte-t-il comme absent ?).

## Options envisagées

1. **Énumération unique à cinq valeurs ou plus** — simple à lire, impossible à maintenir dès que l'on croise excuse et retard.
2. **Deux axes orthogonaux** (`status` : ce qui s'est passé ; `excuse_status` : ce que l'établissement en a décidé) + attributs quantitatifs.
3. Événements d'assiduité multiples par élève et par séance (arrivée, départ, …) — précis mais lourd pour un appel en 60 secondes.

## Décision

Nous retenons l'option 2 :

- `attendance_records.status ∈ {PRESENT, ABSENT, LATE}` — le fait.
- `attendance_records.excuse_status ∈ {NONE, PENDING, EXCUSED, REJECTED}` — la décision ; `EXCUSED` **n'est pas** un statut de présence : un élève excusé était bien absent ou en retard.
- `late_minutes` (1 … durée de la séance) obligatoire si `LATE` ; `left_early_at` optionnel, attribut d'un élève `PRESENT` ; `note` libre.
- Règles par tenant dans `tenants.settings.attendance` : seuil `late_to_absent_minutes` (défaut 30 : au-delà, `status = ABSENT`, `late_minutes` conservé), fenêtre de correction (défaut 48 h), autorisation des justificatifs côté parent (défaut désactivé), seuils d'alerte (défaut 3 absences non justifiées sur 30 jours).
- Une **feuille d'appel** (`attendance_sheets`, une par séance, `DRAFT → SUBMITTED → LOCKED`, `version` pour le verrouillage optimiste) regroupe les records ; les records sont pré-remplis `PRESENT` pour toutes les inscriptions actives à la date de la séance.
- Toute correction écrit une `attendance_record_revisions` (ancien/nouveau statut et minutes, motif obligatoire, auteur) ; les corrections hors fenêtre exigent `EDIT_ATTENDANCE_LOCKED`.
- Une justification (`absence_justifications`) couvre un intervalle et se rattache aux records concernés via `justification_records` ; son workflow `PENDING → APPROVED | REJECTED | INFO_REQUESTED` met à jour `excuse_status`.

Les rapports choisissent explicitement leur lecture : « présence physique » (EXCUSED compte comme absent) ou « assiduité disciplinaire » (EXCUSED exclu).

## Conséquences

### Positives

- Aucune combinatoire : 3 × 4 états cohérents, tous significatifs.
- Les statistiques peuvent répondre à deux questions différentes sans ambiguïté.
- Le retard est quantifié (durée) et son basculement en absence est une règle de tenant, pas un statut.

### Négatives et risques acceptés

- Deux champs à lire au lieu d'un dans l'UI : les écrans affichent un libellé composé (« Absent · justifié ») calculé côté front.
- `EarlyDeparture` du brief disparaît comme statut ; c'est un attribut, ce qui pourrait surprendre un établissement qui le traite comme une absence partielle (configurable plus tard par règle si besoin).

### Ce que cette décision interdit

- Ajouter une valeur à `status` sans ADR.
- Supprimer un record ou modifier un statut sans ligne de révision.

## Comment on saura qu'il faut la revoir

- Un pilote exige un comptage d'absence par demi-séance ou par heure : demanderait un modèle d'événements (option 3) pour certains tenants.
