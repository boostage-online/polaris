import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpDuration = new Histogram({
    name: 'polaris_http_request_duration_seconds',
    help: 'Durée des requêtes HTTP',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.025, 0.05, 0.1, 0.2, 0.4, 0.8, 1.5, 3, 5],
    registers: [this.registry],
  });
  readonly httpErrors = new Counter({
    name: 'polaris_http_errors_total',
    help: 'Réponses 5xx',
    labelNames: ['route', 'tenant'] as const,
    registers: [this.registry],
  });
  readonly authFailures = new Counter({
    name: 'polaris_auth_failures_total',
    help: "Échecs d'authentification",
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });
  readonly outboxPublished = new Counter({
    name: 'polaris_outbox_published_total',
    help: 'Événements relayés vers la file',
    labelNames: ['event_type'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'polaris_' });
  }
}
