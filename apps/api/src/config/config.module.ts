import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './env';

/** Fournit l'environnement validé à tous les modules (y compris aux modules tiers via forRootAsync). */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
