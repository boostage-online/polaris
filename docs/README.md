# Documentation — Polaris

Plateforme SaaS multi-tenant d'assiduité et de frais scolaires (établissements scolaires et universitaires, parents/tuteurs).

| Dossier                                       | Contenu                                                                                                                      | Quand le lire                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`adr/`](./adr/README.md)                     | Architecture Decision Records 0001–0010 : les décisions structurantes figées avant développement                             | Avant d'écrire la première ligne de code d'un module ; à chaque fois qu'on veut « faire autrement » |
| [`backlog/`](./backlog/README.md)             | Backlog détaillé des phases 1 à 7 : epics, user stories, critères d'acceptation, estimations, état de livraison              | Planification des sprints ; revue avec le product owner                                             |
| `handover-phase-N.md`                         | Passation de chaque phase : ce qui est livré, décisions d'implémentation, non couvert, état de vérification (CI)             | À la reprise d'un module ; avant de démarrer la phase suivante                                      |
| [`runbooks/`](./runbooks/README.md)           | Procédures d'exploitation : incident, restauration, alertes, provider hors ligne, violation de données, support, onboarding  | Astreinte ; exercices trimestriels                                                                  |
| [`security/`](./security/checklist.md)        | Checklist sécurité (Partie 11) renseignée, modèle de menaces STRIDE, registre des traitements, cahier des charges du pentest | Revue de sécurité ; avant production ; à chaque incident                                            |
| [`user-guide/`](./user-guide/README.md)       | Guides remis aux établissements : mise en service, sécurité du compte, données personnelles, FAQ                             | Onboarding d'un établissement ; support niveau 1                                                    |
| [`communication/`](./communication/README.md) | Modèles de messages aux établissements (incident, provider indisponible, violation, session de support)                      | Pendant un incident                                                                                 |
| [`cadrage/`](./cadrage/ateliers-pilotes.md)   | Checklist des ateliers avec les établissements pilotes et le questionnaire de collecte                                       | Phase 0, semaines 1–3                                                                               |

Le **document directeur** (architecture, stack, modèle de données, roadmap, risques, décisions) est maintenu dans Claude Docs : <https://claude.ai/code/artifact/21da5528-b9d1-4354-a925-56e8fe542012>. Une copie Markdown sera versionnée ici (`docs/architecture/document-directeur.md`) à la clôture de la Phase 0, une fois les décisions signées.

## Conventions de ce dossier

- Les ADR suivent le format [MADR](https://adr.github.io/madr/) simplifié ; une ADR acceptée n'est jamais modifiée : elle est **remplacée** par une nouvelle ADR qui la référence (`Supersedes`).
- Le backlog utilise des points de complexité (suite 1-2-3-5-8-13) et non des jours ; une story > 8 points doit être découpée.
- Les identifiants sont stables et référencés dans les tickets : `ADR-0005`, `P1-E3-S04` (phase 1, epic 3, story 4).
