/* Génère apps/api/openapi.json sans ouvrir de port (utilise l'app NestJS initialisée). */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../src/bootstrap';
import { buildOpenApiDocument } from '../src/openapi/build';

async function main() {
  process.env['NODE_ENV'] ??= 'development';
  process.env['DATABASE_URL'] ??= 'postgres://polaris_app:polaris_app@localhost:5432/polaris';
  process.env['DATABASE_URL_PLATFORM'] ??=
    'postgres://polaris_owner:polaris@localhost:5432/polaris';
  const app = await createApp();
  await app.init();
  const doc = await buildOpenApiDocument(app);
  const out = resolve(__dirname, '../openapi.json');
  writeFileSync(out, JSON.stringify(doc, null, 2));
  console.warn(`✔ ${out} (${Object.keys(doc.paths ?? {}).length} chemins)`);
  if (doc['x-undocumented-routes'].length)
    console.warn(`⚠ routes sans @ApiDoc : ${doc['x-undocumented-routes'].join(', ')}`);
  await app.close();
}
main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
