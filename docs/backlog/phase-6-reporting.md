# Phase 6 — Reporting, dashboards de direction, Super Admin

**Fenêtre** : 3 mai → 28 mai 2027 (4 semaines, 2 sprints). **Objectif** : la direction pilote l'établissement depuis trois écrans (direction, pédagogie, finance), exporte ce qu'elle veut en CSV, reçoit ses rapports par e-mail, et l'équipe Polaris surveille le parc depuis une vue Super Admin. **Porte G6** : les dashboards sont compris sans explication par un chef d'établissement pilote (test utilisateur) ; les agrégats sont rafraîchis en moins de 5 minutes ; l'export complet d'un établissement est produit en moins de 10 minutes ; chaque feuille d'appel et chaque notification sont traçables de bout en bout.

**ADR mises en œuvre** : 0001 (RLS : les agrégats sont des tables tenant, pas des vues matérialisées PostgreSQL), 0003 (outbox et worker pour le rafraîchissement), 0007 (permissions `VIEW_REPORTS`, `VIEW_ATTENDANCE_REPORTS`, `VIEW_FINANCIAL_REPORTS`, `PLATFORM_VIEW_METRICS`). **Prérequis** : G5 ; données d'au moins un trimestre sur les pilotes.

| Epic | Titre                                                   | Points | Must |
| ---- | ------------------------------------------------------- | ------ | ---- |
| E1   | Agrégats quotidiens et rafraîchissement                 | 13     | ✔    |
| E2   | Tableau de bord de direction                            | 13     | ✔    |
| E3   | Tableau de bord pédagogique                             | 13     | ✔    |
| E4   | Finance par canal et par provider                       | 8      | ✔    |
| E5   | Rapports MVP, CSV, rapports planifiés, export complet   | 21     | ✔    |
| E6   | Traçabilité (feuille d'appel, notification)             | 8      | ✔    |
| E7   | Vue Super Admin (parc, volumétrie, transactions, santé) | 13     | ✔    |
|      | **Total**                                               | **89** |      |

> **État (PR #6, octobre 2026)** : E1 à E7 livrés (API + écrans web) et couverts par la suite d'intégration `test/reporting.test.ts`. Reporté : E5-S06 export PDF des rapports (le CSV suffit aux pilotes ; le PDF reste pour les reçus et les relevés), E2-S05 comparaison inter-années, E7-S05 alertes Super Admin par e-mail (Phase 7, avec la supervision). Détail : `docs/handover-phase-6.md`.

---

## E1 — Agrégats et rafraîchissement

| ID        | Story                                                                                                                                                      | Critères d'acceptation                                                                                    | Pts | Prio |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --- | ---- |
| P6-E1-S01 | [Tech] Tables `report_attendance_daily` (par jour et classe) et `report_finance_daily` (par jour et canal) sous RLS forcée, horodatage de rafraîchissement | Une ligne par (jour, classe) ; totaux égaux aux tables sources sur la période ; RLS prouvée par isolation | 5   | M    |
| P6-E1-S02 | [Tech] `ReportRefreshService.refresh(tenant, période)` : suppression + réinsertion par CTE, 3 derniers jours par défaut, journal `report_refreshes`        | Idempotent ; une erreur est journalisée sans bloquer les autres tenants                                   | 3   | M    |
| P6-E1-S03 | [Tech] Cron `reports-refresh` toutes les 5 minutes (tous les tenants) ; rafraîchissement complet depuis le début de l'année via la file `reports`          | G6 : fraîcheur < 5 min ; `POST /reports/refresh` à la demande ; `full` passe par le worker                | 3   | M    |
| P6-E1-S04 | En tant que directeur, je veux voir la date du dernier rafraîchissement et pouvoir le relancer                                                             | Affiché sur chaque dashboard ; bouton « Rafraîchir les agrégats »                                         | 2   | S    |

## E2 — Tableau de bord de direction

| ID        | Story                                                                                                                           | Critères d'acceptation                                                        | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --- | ---- |
| P6-E2-S01 | En tant que directeur, je veux quatre KPI en tête : élèves actifs, taux de présence 30 j, taux de recouvrement, parents activés | `GET /dashboards/direction` (`VIEW_REPORTS`) ; valeurs nulles affichées « — » | 3   | M    |
| P6-E2-S02 | En tant que directeur, je veux les tendances hebdomadaires de présence et d'encaissement sur 8 semaines                         | Barres simples, infobulle par semaine, sans bibliothèque graphique            | 3   | M    |
| P6-E2-S03 | En tant que directeur, je veux les cinq classes les moins assidues sur 30 jours, avec leurs absences non justifiées             | Lien vers la ligne correspondante du dashboard pédagogique                    | 3   | M    |
| P6-E2-S04 | En tant que directeur, je veux la variation vs période précédente (présence 30 j, encaissé mensuel) et les quotas SMS           | Flèche colorée ; barre de consommation SMS                                    | 2   | S    |
| P6-E2-S05 | Comparaison inter-années (même période N−1)                                                                                     | Reporté                                                                       | 2   | C    |

## E3 — Tableau de bord pédagogique

| ID        | Story                                                                                                                                   | Critères d'acceptation                                                                     | Pts | Prio |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --- | ---- |
| P6-E3-S01 | En tant que censeur, je veux le taux de présence par classe sur une période choisie (7/30/90 j ou dates libres)                         | `GET /dashboards/pedagogy?from&to` (`VIEW_ATTENDANCE_REPORTS`) ; barres colorées par seuil | 5   | M    |
| P6-E3-S02 | En tant que censeur, je veux la liste des élèves à risque (alerte ouverte, ≥ 3 absences non justifiées, ou taux < 80 % sur ≥ 5 séances) | Alerte ouverte signalée ; CSV du rapport « Élèves à risque » en un clic                    | 3   | M    |
| P6-E3-S03 | En tant que censeur, je veux les appels non réalisés par enseignant                                                                     | Nombre et part des séances ; CSV « Appels non réalisés »                                   | 3   | M    |
| P6-E3-S04 | En tant que censeur, je veux la répartition des retards (≤ 5, 6–15, 16–30, > 30 min)                                                    | Histogramme                                                                                | 2   | S    |

## E4 — Finance par canal

| ID        | Story                                                                                                                     | Critères d'acceptation                                                                       | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --- | ---- |
| P6-E4-S01 | En tant que gestionnaire, je veux les encaissements par canal (espèces, virement, chèque, Mobile Money, FedaPay, KKiaPay) | `GET /dashboards/finance/channels` (`VIEW_FINANCIAL_REPORTS`) ; part en % ; annulés et frais | 3   | M    |
| P6-E4-S02 | En tant que gestionnaire, je veux le taux de réussite des paiements en ligne et le délai médian de confirmation           | Tentatives, réussies, échouées, en attente, à vérifier ; médiane en secondes                 | 3   | M    |
| P6-E4-S03 | Carte « Par canal » intégrée au tableau de bord finance existant, série quotidienne manuel/en ligne                       | Sans doublon avec la caisse du jour                                                          | 2   | S    |

## E5 — Rapports, CSV, planification, export complet

| ID        | Story                                                                                                                                                                                                                                                                                 | Critères d'acceptation                                                                                               | Pts | Prio |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| P6-E5-S01 | [Tech] Catalogue de 8 rapports : assiduité par classe, élèves à risque, appels non réalisés, corrections d'appel, encaissements par canal, recouvrement par classe, activation des parents, tentatives de paiement — chacun avec sa permission, sa période par défaut et ses colonnes | `GET /reports` filtré par les permissions de l'acteur ; `GET /reports/:key` → 403 si la permission du rapport manque | 5   | M    |
| P6-E5-S02 | En tant qu'utilisateur habilité, je veux prévisualiser un rapport (période, classe) et le télécharger en CSV lisible par Excel                                                                                                                                                        | Séparateur `;`, BOM UTF-8, 5 000 lignes max. en aperçu (indicateur `truncated`), nom de fichier daté                 | 3   | M    |
| P6-E5-S03 | En tant que directeur, je veux planifier l'envoi hebdomadaire ou mensuel d'un rapport à des destinataires                                                                                                                                                                             | `scheduled_reports` ; cron 6 h 30 ; un envoi par jour au plus ; CSV en pièce jointe ; dernière erreur visible        | 5   | M    |
| P6-E5-S04 | En tant que directeur, je veux « Envoyer maintenant », suspendre, modifier ou supprimer un rapport planifié                                                                                                                                                                           | Écran Rapports › Rapports planifiés                                                                                  | 2   | S    |
| P6-E5-S05 | En tant qu'administrateur, je veux demander un export complet de mon établissement (ZIP de CSV) et le télécharger                                                                                                                                                                     | 20 fichiers + README ; construit par le worker ; état suivi ; G6 < 10 min ; `MANAGE_TENANT_SETTINGS`                 | 5   | M    |
| P6-E5-S06 | Export PDF des rapports                                                                                                                                                                                                                                                               | Reporté                                                                                                              | 3   | C    |

## E6 — Traçabilité

| ID        | Story                                                                                                                                                                                     | Critères d'acceptation                                                                                             | Pts | Prio |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --- | ---- |
| P6-E6-S01 | En tant que censeur, je veux voir pour une feuille d'appel : séance, ouverture, soumission, verrouillage, effectifs, corrections (avec motif et hors délai), notifications parents, audit | `GET /trace/sheets/:id` ; lien « Tracer » depuis la liste des feuilles ; lien vers la trace de chaque notification | 5   | M    |
| P6-E6-S02 | En tant qu'administrateur, je veux voir pour une notification : destinataire, canal, rendu, tentatives, événement source, autres envois du même événement, préférences                    | `GET /trace/notifications/:id` ; lien depuis le journal des notifications ; lien retour vers la feuille d'appel    | 3   | M    |

## E7 — Vue Super Admin

| ID        | Story                                                                                                                                              | Critères d'acceptation                                                                                          | Pts | Prio |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --- | ---- |
| P6-E7-S01 | En tant que Super Admin, je veux le parc (actifs, essai, suspendus) et la volumétrie (élèves, tuteurs activés, encaissé jour/mois, présence 7 j)   | `GET /platform/overview` (`PLATFORM_VIEW_METRICS`, portée plateforme)                                           | 3   | M    |
| P6-E7-S02 | En tant que Super Admin, je veux les transactions 24 h (tentatives, réussies, échouées, à vérifier, webhooks, par provider) et les erreurs 24 h    | Transactions UNKNOWN, notifications en échec, imports en échec, revues ouvertes                                 | 3   | M    |
| P6-E7-S03 | En tant que Super Admin, je veux la santé technique : base, Redis, retard de l'outbox, files BullMQ (attente, actives, différées, échecs), DLQ     | Compteurs réels des files `domain-events`, `payments`, `schedules`, `reports`, `maintenance` ; agrégats périmés | 3   | M    |
| P6-E7-S04 | En tant que Super Admin, je veux le tableau par établissement et gérer les établissements (créer, suspendre, réactiver, inviter un administrateur) | Écran Plateforme ; réutilise `/platform/tenants`                                                                | 3   | M    |
| P6-E7-S05 | Alertes Super Admin par e-mail (DLQ non vide, outbox > 5 min)                                                                                      | Reporté en Phase 7 (supervision)                                                                                | 1   | C    |
