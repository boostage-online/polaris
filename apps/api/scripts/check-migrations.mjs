// Garde-fou expand/contract : un DROP ou RENAME dans une migration `up` doit être explicitement
// marqué `-- contract` en tête de fichier et ne doit jamais faire partie de la release qui cesse
// d'utiliser la colonne (docs/adr, Partie 14 du document directeur).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../migrations/', import.meta.url).pathname;
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.up.sql'))
  .sort();
const names = files.map((f) => f.replace(/\.up\.sql$/, ''));
let failed = false;

for (const f of files) {
  const sql = readFileSync(join(dir, f), 'utf8');
  const marked = /^--\s*contract\b/m.test(sql);
  const destructive = /\b(DROP\s+(TABLE|COLUMN)|ALTER\s+TABLE\s+\S+\s+RENAME|DROP\s+INDEX)\b/i.test(
    sql.replace(/--.*$/gm, ''),
  );
  if (destructive && !marked) {
    console.error(`✖ ${f} : opération destructive sans marqueur "-- contract"`);
    failed = true;
  }
  if (!/^\d{4}_[a-z0-9_]+$/.test(f.replace(/\.up\.sql$/, ''))) {
    console.error(`✖ ${f} : nom attendu NNNN_nom_en_snake_case.up.sql`);
    failed = true;
  }
  if (!readdirSync(dir).includes(f.replace('.up.sql', '.down.sql'))) {
    console.error(`✖ ${f} : fichier .down.sql manquant (ou marquer irréversible explicitement)`);
    failed = true;
  }
}
const dupes = names.filter((n, i) => names.findIndex((m) => m.slice(0, 4) === n.slice(0, 4)) !== i);
if (dupes.length) {
  console.error(`✖ numéros de migration en double : ${dupes.join(', ')}`);
  failed = true;
}
if (failed) process.exit(1);
console.log(`✔ ${files.length} migration(s) conformes`);
