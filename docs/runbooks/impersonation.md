# Sessions de support (impersonation Super Admin)

Quand un établissement a besoin d'aide, le support peut **voir l'application comme son administrateur** pendant 30 minutes, sans aucune action financière, chaque action étant journalisée au nom de l'agent et visible par l'établissement.

## Règles

- Motif obligatoire (ticket, demande écrite) ; **jamais sans demande de l'établissement** sauf incident de sécurité documenté.
- Interdits par construction : encaissement, annulation, remboursement, configuration du provider, anonymisation (`IMPERSONATION_EXCLUDED`) ; routes plateforme inaccessibles depuis la session.
- Durée : 30 min (`IMPERSONATION_TTL_MINUTES`), pas de prolongation silencieuse — rouvrir une session avec le même motif.
- Clôture : bouton « Quitter le mode support » ou Plateforme → Sessions de support → Clôturer (effet < 30 s).

## Procédure

1. Plateforme → Établissements → **Support** → motif → Ouvrir.
2. Bannière orange visible en permanence : établissement, motif, heure d'expiration.
3. Faire le strict nécessaire ; expliquer à l'établissement ce qui a été modifié (le journal d'audit le montre avec la mention « support plateforme »).
4. Quitter le mode support.

## Contrôle

- Revue hebdomadaire de Plateforme → Sessions de support : motif pertinent, durée, actions associées (`audit_logs` où `impersonated_by` est renseigné).
- Toute session sans ticket associé fait l'objet d'une remontée au responsable.
