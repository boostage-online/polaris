# Registre des traitements de données personnelles — Polaris

Cadre : loi béninoise n° 2017-20 du 20 avril 2018 portant code du numérique (livre V, données personnelles, autorité : APDP) et RGPD si des établissements européens sont onboardés. **Polaris est sous-traitant** ; chaque établissement est responsable de traitement pour ses élèves, tuteurs et personnel. Ce registre décrit les traitements opérés par la plateforme pour le compte des établissements, plus les traitements dont Polaris est responsable (comptes plateforme, journaux techniques).

Référent données personnelles : à désigner avant la production (décision « avant production » n° 3). Contact : `privacy@polaris.app` (à créer).

## Traitements pour le compte des établissements (sous-traitance)

| N°  | Traitement                            | Finalité                                                               | Personnes                       | Données                                                                                                                          | Base légale (côté établissement)                          | Durée de conservation                                                                                       | Accès                                              |
| --- | ------------------------------------- | ---------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | Gestion des élèves et inscriptions    | Tenir le registre des élèves, classes, parcours                        | Élèves (mineurs)                | identité, matricule, date de naissance, sexe, photo (optionnelle), inscriptions, départ                                          | mission de service public / exécution du contrat scolaire | **5 ans après le départ** puis anonymisation automatique (`privacy.studentRetentionYears`)                  | Scolarité, direction, enseignants (lecture)        |
| 2   | Suivi de l'assiduité                  | Appel, absences, retards, justificatifs, alertes                       | Élèves, tuteurs (justificatifs) | statuts de présence, minutes de retard, motifs (liste libre non médicale), nom du document justificatif, corrections             | mission de service public / intérêt légitime              | 5 ans après le départ puis anonymisation (notes et justificatifs effacés, statistiques agrégées conservées) | Enseignants (leurs cours), vie scolaire, direction |
| 3   | Lien parent-enfant et espace parent   | Permettre au tuteur de suivre l'assiduité et les frais de son enfant   | Tuteurs                         | identité, téléphone E.164, e-mail, relation, droits par lien, compte (connexion, appareils)                                      | exécution du contrat, intérêt légitime                    | Compte inactif sans enfant rattaché : **2 ans** puis anonymisation (`privacy.inactiveGuardianYears`)        | Scolarité ; le tuteur pour ses propres données     |
| 4   | Facturation des frais scolaires       | Créances, échéances, encaissements manuels, reçus, rappels             | Élèves (via le tuteur payeur)   | montants, échéances, paiements (méthode, référence, payeur), reçus numérotés                                                     | exécution du contrat, obligation comptable                | **10 ans** (pièces comptables), non anonymisées ; conservées même après anonymisation de l'élève            | Finance, direction ; tuteur (ses paiements)        |
| 5   | Paiement en ligne                     | Encaisser via FedaPay / KKiaPay                                        | Tuteurs payeurs                 | montant, identifiant de transaction provider, statut, horodatages ; **aucune donnée de carte ni de compte mobile money stockée** | exécution du contrat                                      | 10 ans avec les pièces comptables ; webhooks bruts 13 mois                                                  | Finance ; provider (sous-traitant ultérieur)       |
| 6   | Notifications                         | Informer les tuteurs (absence, retard, échéance, reçu) et le personnel | Tuteurs, personnel              | destinataire, canal, contenu rendu (prénom + initiale dans les SMS), statut d'envoi, préférences                                 | intérêt légitime / consentement (préférences)             | 13 mois (journal), puis purge ; anonymisées avec la personne                                                | Administrateur (journal), fournisseurs SMS/e-mail  |
| 7   | Comptes du personnel et RBAC          | Authentifier et habiliter le personnel                                 | Personnel                       | identité, e-mail, hash de mot de passe, secret TOTP chiffré, rôles, sessions (appareil, IP, agent)                               | exécution du contrat de travail / intérêt légitime        | Durée de l'appartenance + 1 an ; journaux d'audit 5 ans                                                     | Administrateur                                     |
| 8   | Journal d'audit                       | Traçabilité des actions sensibles, sécurité, litiges                   | Tous                            | acteur, action, objet, avant/après, IP, agent, horodatage                                                                        | intérêt légitime (sécurité, preuve)                       | 5 ans, append-only                                                                                          | Administrateur, direction (`VIEW_AUDIT_LOG`)       |
| 9   | Reporting                             | Pilotage de l'établissement                                            | Élèves (agrégés), personnel     | agrégats par classe/jour (sans nom), listes nominatives dans les rapports à la demande                                           | intérêt légitime                                          | Agrégats : durée de vie de l'année scolaire + 5 ans ; rapports CSV non conservés côté serveur               | Direction, pédagogie, finance                      |
| 10  | Export complet et exports individuels | Portabilité, résiliation, droit d'accès                                | Tous                            | copie des données ci-dessus                                                                                                      | obligation légale (droit d'accès, portabilité)            | Archive conservée 20 exports glissants puis supprimée ; export individuel non conservé                      | Administrateur ; la personne pour ses données      |

## Traitements dont Polaris est responsable

| N°  | Traitement                       | Finalité                         | Personnes                      | Données                                                      | Base légale      | Durée                         |
| --- | -------------------------------- | -------------------------------- | ------------------------------ | ------------------------------------------------------------ | ---------------- | ----------------------------- |
| 11  | Comptes plateforme (Super Admin) | Administrer les établissements   | Employés Polaris               | identité, e-mail, MFA, sessions, sessions de support (motif) | intérêt légitime | Durée du contrat + 1 an       |
| 12  | Journaux techniques et métriques | Exploitation, sécurité, incident | Tous (identifiants techniques) | request_id, trace_id, tenant_id, user_id, IP, latences       | intérêt légitime | 90 jours (1 an pour sécurité) |
| 13  | Alertes de supervision           | Détecter les dysfonctionnements  | —                              | compteurs agrégés par établissement                          | intérêt légitime | 13 mois                       |

## Sous-traitants ultérieurs (à contractualiser avant production)

| Sous-traitant                  | Rôle                           | Données                              | Localisation |
| ------------------------------ | ------------------------------ | ------------------------------------ | ------------ |
| Hébergeur / PaaS (à choisir)   | hébergement, base, sauvegardes | toutes (chiffrées au repos)          | à documenter |
| FedaPay, KKiaPay               | paiement en ligne              | montant, référence, téléphone payeur | Bénin        |
| Fournisseur SMS (à choisir)    | envoi des SMS                  | numéro, contenu (prénom + initiale)  | à documenter |
| Fournisseur e-mail (à choisir) | envoi des e-mails              | e-mail, contenu                      | à documenter |

## Droits des personnes et procédures

| Droit                      | Procédure Polaris                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Information                | Message à l'activation du compte parent (invitation SMS + première connexion), politique de confidentialité de l'établissement                                      |
| Accès / portabilité        | Parent : bouton « Mes données » (JSON) ; élève ou tuteur : export par l'administrateur (`/admin/privacy`, fiche) ; établissement : export complet                   |
| Rectification              | Fiches élève/tuteur modifiables par la scolarité ; le parent signale à l'établissement                                                                              |
| Effacement                 | Anonymisation outillée (fiche ou `/admin/privacy`) : identité, notes, justificatifs, notifications effacés ; pièces comptables conservées 10 ans ; motif journalisé |
| Opposition (notifications) | Préférences par canal ; l'in-app reste actif (information scolaire)                                                                                                 |
| Limitation                 | Désactivation du compte (`users.status`) sans suppression                                                                                                           |

Délais de réponse : 30 jours (RGPD) — l'outillage permet une réponse immédiate par l'établissement.

## Mesures de sécurité (renvoi)

Voir `docs/security/checklist.md` (Partie 11) et `docs/security/threat-model.md`. Violation de données : `docs/runbooks/data-breach.md` (notification sous 72 h).
