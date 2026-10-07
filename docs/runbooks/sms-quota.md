# Quota SMS atteint ou proche

## Symptômes

Alerte `tenant:<id>:sms-cap` (90 % → WARNING, 100 % → CRITICAL) ; notification in-app `SMS_CAP_WARNING` à l'administrateur ; les notifications SMS passent en `SUPPRESSED` au-delà du plafond (l'in-app reste envoyé).

## Pourquoi

Le plafond mensuel (`settings.notifications.smsMonthlyCap`, 2 000 par défaut) protège le budget : un établissement de 1 000 élèves avec des absences notifiées chaque jour peut dépasser 10 000 SMS/mois.

## Actions

1. Vérifier la répartition : Rapports → notifications par type (quelle règle consomme : absences, rappels d'échéance ?).
2. Options avec l'établissement : relever le plafond (Paramètres → Notifications), activer l'agrégation (un SMS par jour et par enfant), privilégier l'in-app/web push pour les retards, limiter les rappels d'échéance.
3. Si le fournisseur SMS est en cause (échecs, pas quota) : voir `notifications:failed` dans `alerts.md`.
4. Fin de mois : le compteur repart à zéro ; les notifications supprimées ne sont **pas** renvoyées rétroactivement (information périmée).
