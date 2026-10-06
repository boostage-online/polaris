# ADR-0007 — RBAC : rôles par tenant, catalogue de permissions en code, policies de portée

- **Statut** : Proposée
- **Date** : 2026-10-06
- **Décideurs** : lead technique, product owner
- **Références** : document directeur Partie 7 ; ADR-0002, ADR-0008

## Contexte et problème

Les établissements ont des organisations différentes : ici seul l'enseignant fait l'appel, là c'est la vie scolaire ; ici un caissier encaisse et un comptable annule, là une seule personne fait tout. Le brief interdit de coder en dur « seul l'enseignant fait l'appel ». Un parent n'a aucun rôle d'établissement : ses droits découlent de son lien avec un enfant. Les droits doivent être révocables immédiatement et testables exhaustivement.

## Options envisagées

1. **Rôles codés en dur** (`if (user.role === 'TEACHER')`) — rapide, rigide, impossible à adapter sans release.
2. **ACL par objet** (droits par ressource) — trop fin pour l'administration quotidienne d'un établissement.
3. **ABAC complet** (moteur de règles sur attributs) — puissant, mais opaque et difficile à tester pour une petite équipe.
4. **RBAC à deux étages + portée** : rôles (données, par tenant) → permissions (catalogue en code) ; les permissions qui dépendent d'une ressource sont évaluées par des _policies_ explicites.

## Décision

Nous retenons l'option 4 :

- **`permissions`** : catalogue global défini en TypeScript (`as const`), régénéré en base par migration ; ~45 au MVP, nommées `VERBE_OBJET` (`TAKE_ATTENDANCE`, `RECORD_MANUAL_PAYMENT`…). Une faute de frappe est une erreur de compilation.
- **`roles`** : données par tenant ; 7 rôles système copiés à la création du tenant (Administrateur, Scolarité, Enseignant, Vie scolaire, Responsable pédagogique, Direction, Caisse/Finance), modifiables et duplicables sauf le rôle Administrateur ; rôles personnalisés en V1.
- **`memberships`** (user × tenant) portent des rôles (`membership_roles`, avec `scope jsonb` optionnel, ex. campus) ; un token porte le membership actif et une **version de permissions** `pv`, incrémentée à chaque changement de rôle, qui invalide le cache Redis `perms:{mid}:{pv}`.
- **Trois questions dans l'ordre** : `TenantGuard` (bon tenant, sinon 404) → `PermissionGuard` (`@RequirePermission('X')`, sinon 403) → **policy de portée** dans le cas d'usage (`AttendancePolicy.canTakeFor(session, actor)`, `GuardianPolicy.canView(student, guardian, 'finance')`).
- Distinction **portée propre / portée globale** : `TAKE_ATTENDANCE` (ses cours) vs `TAKE_ATTENDANCE_ANY` ; `EDIT_ATTENDANCE` (fenêtre 48 h) vs `EDIT_ATTENDANCE_LOCKED` ; `VIEW_ATTENDANCE` vs `VIEW_ATTENDANCE_ANY`.
- **Parents** : aucune permission de rôle ; droits dérivés de `student_guardians` actifs et de leurs drapeaux (`can_view_attendance`, `can_view_finance`, `can_pay`, `can_justify`).
- **Séparation des tâches** codée dans les policies : la même personne ne peut pas `RECORD_MANUAL_PAYMENT` et `CANCEL_PAYMENT` sur le même paiement ; on ne peut pas retirer `MANAGE_ROLES` au dernier détenteur.
- **Tests** : un générateur produit, pour chaque route, la matrice rôle système × résultat attendu (200/403/404) ; la CI échoue si une route n'a pas d'entrée.
- Tout changement de rôle ou de permission est audité avec `before/after`.

## Conséquences

### Positives

- Donner l'appel à la vie scolaire est une case à cocher, pas une release.
- Révocation instantanée sans invalider les JWT (cache versionné).
- Les règles subtiles (enseignant ↔ ses cours, parent ↔ ses enfants) vivent dans des classes pures testées unitairement.

### Négatives et risques acceptés

- Les policies sont du code : une nouvelle règle de portée demande un développement (acceptable, elles changent rarement).
- Le catalogue de permissions grossit ; une revue trimestrielle évite les doublons.
- Les rôles personnalisés (V1) nécessiteront une UI de gestion et des garde-fous contre les configurations incohérentes.

### Ce que cette décision interdit

- Tester un nom de rôle dans le code applicatif.
- Attribuer une permission de rôle à un parent.
- Un endpoint sans `@RequirePermission` (hors routes publiques explicitement listées : auth, webhooks, vérification de reçu, health).

## Comment on saura qu'il faut la revoir

- Besoin de règles dépendant de nombreux attributs dynamiques (horaires, lieux, hiérarchies) qui ne tiennent plus dans des policies lisibles : envisager un moteur ABAC pour ces cas précis.
