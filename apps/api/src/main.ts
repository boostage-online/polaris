import 'reflect-metadata';
import { createApp, mountDocs } from './bootstrap';
import { ENV, type Env } from './config/env';

async function main() {
  const app = await createApp();
  await mountDocs(app);
  const env = app.get<Env>(ENV);
  await app.listen(env.API_PORT, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.warn(`Polaris API prête sur http://localhost:${env.API_PORT}/api/v1 (docs : /api/docs)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
