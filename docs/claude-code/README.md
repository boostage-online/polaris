# Continuer Polaris avec Claude Code — mode d'emploi

Ce dossier contient tout ce qu'il faut pour confier la suite du projet à Claude Code : la mise en route, la façon de travailler phase par phase, et les **prompts prêts à copier**. Claude Code lit automatiquement [`CLAUDE.md`](../../CLAUDE.md) à la racine du dépôt : les règles du projet y sont, inutile de les répéter dans chaque demande.

## 1. Mise en route (une fois)

1. **Récupérer le projet** dans un dossier de travail : `git clone https://github.com/boostage-online/polaris.git` (ou « Download ZIP » sur GitHub, mais le clone est préférable : Claude Code travaille avec git, branches et pull requests).
2. **Outils sur la machine qui exécutera Claude Code** : Git, Node 22, pnpm 10 (`corepack enable`), Docker (pour PostgreSQL et Redis en local). Pour les phases mobiles : Flutter 3 stable et Android Studio (émulateur).
3. **GitHub** : Claude Code doit pouvoir pousser des branches et ouvrir des pull requests sur `boostage-online/polaris` (CLI `gh` connectée à votre compte). La CI GitHub Actions vérifie chaque PR ; c'est elle qui dit si le travail est bon.
4. **Ouvrir Claude Code dans le dossier du dépôt** et commencer par le prompt de démarrage ci-dessous.

Si vous préférez ne rien exécuter sur votre ordinateur, Claude Code peut aussi travailler dans un environnement cloud relié au dépôt GitHub : la CI fait alors foi pour les tests (c'est ainsi que les phases 1 à 8 ont été construites).

## 2. Prompt de démarrage (à donner une seule fois)

```text
Tu reprends le projet Polaris. Lis CLAUDE.md, docs/roadmap/README.md, docs/handover-phase-8.md,
docs/design/README.md, docs/api/README.md et docs/mobile/README.md. Puis :
1. installe le projet en local et fais passer pnpm lint, pnpm typecheck, pnpm test et pnpm test:integration ;
2. résume-moi en 10 lignes l'état du projet et ce que tu as compris de la phase 9 ;
3. liste les décisions dont tu as besoin de ma part avant de commencer (fournisseur SMS, etc.).
Ne modifie rien pour l'instant.
```

## 3. Le cycle d'une phase

Pour chaque phase de `docs/roadmap/README.md` :

1. **Cadrage** — donner le prompt de la phase (section 4). Claude Code propose un découpage en étapes et pose ses questions. Répondez avant qu'il code.
2. **Réalisation** — il travaille sur une branche `feat/phase-N-…`, commit par étape, tests à chaque règle métier.
3. **Vérification** — PR ouverte vers `main`, CI verte (s'il échoue, il lit les commentaires de la CI sur la PR et corrige). Pour une phase d'interface : workflow « Captures d'écran » et comparaison aux maquettes.
4. **Clôture** — `docs/handover-phase-N.md`, backlog et roadmap mis à jour, puis **vous** relisez la PR (au moins la description et les captures) et fusionnez.

Demandez toujours à la fin d'une phase : _« Qu'est-ce qui n'est pas couvert, et quels risques restent ? »_

## 4. Prompts par phase

### Phase 9 — Fournisseurs réels et mise en ligne

```text
Phase 9 de docs/roadmap/README.md. Contexte : SMS et e-mails sont aujourd'hui simulés (adaptateurs log).
Fournisseur SMS retenu : [NOM DU FOURNISSEUR], documentation : [LIEN]. E-mail : SMTP [HÔTE, PORT].
Implémente derrière les ports existants (apps/api/src/modules/shared/domain/ports.ts) :
- l'adaptateur SMS réel avec accusés de réception par webhook signé, coût unitaire, tests sur réponses enregistrées ;
- l'adaptateur SMTP avec pièces jointes ;
- le port ObjectStorage (S3 compatible : MinIO local, Cloudflare R2 en production).
Ajoute les variables à infra/vps/.env.example et à docs/runbooks/deploy-vps.md.
Une branche feat/phase-9-providers, une PR, CI verte, passation docs/handover-phase-9.md.
Commence par me proposer le découpage et tes questions.
```

Ensuite, la mise en ligne elle-même se fait avec `docs/runbooks/deploy-vps.md` : demandez à Claude Code de vous guider pas à pas pendant que vous agissez dans le panneau Hostinger.

### Phase 10 — Refonte visuelle web

```text
Phase 10 de docs/roadmap/README.md : applique le système de design de docs/design/ à apps/web.
Ordre : jetons (docs/design/tokens.css → globals.css + Tailwind 4 @theme), polices Sora/Inter (next/font),
logo étoile, composants de components/ui.tsx (dont un sélecteur de date jj/mm/aaaa et des tableaux qui deviennent
des listes sous 640 px), puis les écrans : connexion, espace parent, appel enseignant, coquille + direction, fiche élève.
Les maquettes de référence sont docs/design/maquettes/*.dc.html (lis le HTML : structure, libellés, couleurs, tailles).
Exigence : aucun défilement horizontal à 360 px — ajoute ce contrôle à ops/screenshots/screenshots.mjs.
Lance le workflow « Captures d'écran » à la fin et compare aux maquettes dans la PR.
Pas de changement d'API dans cette phase.
```

### Phase 11 — API mobile

```text
Phase 11 de docs/roadmap/README.md : ajoute à l'API ce que décrit docs/mobile/README.md, section « Contrat API côté serveur » :
GET /app/config, POST/DELETE /me/devices, envoi de pièces jointes de justificatifs par URL présignée,
canal PUSH (adaptateur FCM HTTP v1 derrière un port PushGateway, repli SMS).
Migration expand-only avec RLS, tests d'intégration, matrice de permissions, test d'isolation.
À la fin, régénère le contrat (pnpm openapi) et copie apps/api/openapi.json dans docs/api/openapi.json.
```

### Phase 12 — App Flutter Parents

```text
Phase 12 de docs/roadmap/README.md : crée apps/mobile selon docs/mobile/README.md (structure, pile, flavors).
1. Génère le client Dart depuis docs/api/openapi.json dans apps/mobile/packages/polaris_api.
2. Thème depuis docs/design/tokens.json (lib/core/theme/tokens.dart généré par un petit script), polices embarquées.
3. Écrans de l'app Parents dans l'ordre du tableau « Écrans de l'app Parents », fidèles aux maquettes
   Connexion, ParentAccueil, ParentEnfant de docs/design/maquettes/.
4. Workflow .github/workflows/mobile.yml (analyze, test, APK debug à chaque PR).
Tests de widgets par écran, test d'intégration du parcours OTP → accueil contre l'API locale seedée
(parent du lycée de démonstration : +22991000001, OTP lu dans les journaux de l'API en mode SMS log). Commence par le squelette (navigation, auth, thème) et montre-moi des captures
de l'émulateur avant d'enchaîner les écrans.
```

### Phase 13 — App Flutter École (appel hors ligne)

```text
Phase 13 de docs/roadmap/README.md : flavor « ecole » de apps/mobile pour les enseignants.
Écrans : séances du jour (GET /me/schedule/today), feuille d'appel fidèle à docs/design/maquettes/Appel.dc.html
(présents par défaut, P/A/R, minutes de retard), brouillon local drift, envoi différé au retour du réseau
avec gestion du conflit de version (409 → recharger et réappliquer), connexion e-mail + MFA.
Test : appel complet en mode avion puis synchronisation ; 30 élèves en moins de 60 secondes.
```

### Phase 14 — V1 métier

```text
Phase 14 de docs/roadmap/README.md. Commence par me proposer une ADR pour les remboursements et les crédits
(docs/adr/0011-…), cohérente avec ADR-0005 (tables append-only, écritures compensatoires), avant tout code.
```

## 5. Bonnes pratiques avec Claude Code sur ce projet

- **Une phase à la fois**, une conversation par phase ; reprenez une phase interrompue en lui demandant de relire la passation et la PR ouverte.
- **Exigez la CI verte** et refusez qu'un test soit désactivé pour la faire passer.
- **Donnez-lui les faits que vous seul connaissez** (fournisseurs, prix, nom commercial, comptes) : ils sont listés à la fin de `docs/roadmap/README.md`.
- **Relisez ce qui touche à l'argent et aux données des enfants** (paiements, rôles, exports) : la description de PR doit expliquer ce qui change.
- **Gardez les maquettes à jour** : si un écran évolue, demandez de mettre à jour `docs/design/` dans la même PR.
