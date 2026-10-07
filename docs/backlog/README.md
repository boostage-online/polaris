# Backlog — Phases 1 à 6

Six fichiers, un par phase, découpés en **epics** puis **user stories** avec critères d'acceptation. Les phases 7 (durcissement) et 8 (lancement) seront détaillées à la fin de la Phase 6.

| Phase                           | Fichier                                          | Fenêtre cible            | Porte de sortie                                                               |
| ------------------------------- | ------------------------------------------------ | ------------------------ | ----------------------------------------------------------------------------- |
| 1 — Socle technique             | [phase-1-socle.md](./phase-1-socle.md)           | 2 nov → 4 déc 2026       | G1 : isolation tenant prouvée, auth complète, CI/CD et observabilité en place |
| 2 — Académique, élèves, parents | [phase-2-academique.md](./phase-2-academique.md) | 7 déc 2026 → 15 jan 2027 | G2 : données des pilotes importées, parents invités                           |
| 3 — Assiduité et notifications  | [phase-3-assiduite.md](./phase-3-assiduite.md)   | 18 jan → 19 fév 2027     | G3 : appel < 60 s, notification < 2 min, pilote en production restreinte      |
| 4 — Frais et paiements manuels  | [phase-4-billing.md](./phase-4-billing.md)       | 22 fév → 26 mar 2027     | G4 : créances complètes, caisse = brouillard, 0 écart d'intégrité, rappels    |
| 5 — Paiements électroniques     | [phase-5-payments.md](./phase-5-payments.md)     | 22 mar → 30 avr 2027     | G5 : réconciliation à 0 écart, 0 double paiement, reçu < 60 s, clés scellées  |
| 6 — Reporting et Super Admin    | [phase-6-reporting.md](./phase-6-reporting.md)   | 3 mai → 28 mai 2027      | G6 : dashboards compris sans explication, agrégats < 5 min, export < 10 min   |

## Conventions

- **Identifiant** : `P<phase>-E<epic>-S<story>` (ex. `P1-E3-S02`). Stable ; repris dans le titre du ticket et de la branche.
- **Format de story** : _En tant que_ ‹rôle›, _je veux_ ‹action› _afin de_ ‹bénéfice›. Les stories techniques (sans rôle utilisateur) sont préfixées `[Tech]`.
- **Critères d'acceptation** : liste vérifiable ; une story est terminée quand tous ses critères sont couverts par un test automatisé ou une vérification manuelle documentée dans la PR.
- **Estimation** : points de complexité (1, 2, 3, 5, 8, 13). Au-delà de 8, découper. Les totaux par epic servent à vérifier la capacité (hypothèse : 3,5 devs × ~25 points/semaine/équipe).
- **Priorité** : `M` must (sans elle la porte ne passe pas), `S` should (attendue dans la phase, reportable d'un sprint), `C` could (si capacité).
- **Definition of Done** (toutes stories) : code revu par un pair ; tests unitaires/intégration verts ; matrice de permissions à jour si une route est ajoutée ; OpenAPI à jour ; migration expand-only ; pas de secret ni de donnée personnelle dans les logs ; documentation (README du module ou runbook) si un comportement opérationnel change.
- **Référence ADR** : chaque epic cite les ADR qu'il met en œuvre ; en cas de désaccord avec une ADR, on ouvre une nouvelle ADR, on ne contourne pas.

## Capacité et rythme

- Sprints de 2 semaines ; revue de sprint avec démo sur staging ; les pilotes sont invités aux démos à partir de la Phase 2.
- 20 % de chaque sprint réservé à la dette, aux dépendances et à l'outillage.
- Les points indiqués sont des ordres de grandeur pour arbitrer, pas des engagements ; ils seront ré-estimés en planning poker au début de chaque phase.
