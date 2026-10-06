// Copie les migrations SQL à côté du build pour que l'image Docker puisse les exécuter.
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/migrations', { recursive: true });
cpSync('migrations', 'dist/migrations', { recursive: true });
