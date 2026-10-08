import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function main() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.init();
  console.warn(
    'Polaris worker démarré (outbox relay, domain-events, maintenance, génération des séances)',
  );
}
main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
