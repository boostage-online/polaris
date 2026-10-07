import http from 'k6/http';
import { check } from 'k6';
import { BASE, SEED, profile, signFake } from './lib.js';

/**
 * Rafale de webhooks signés sur le provider de démonstration (Partie 10 : 100 webhooks/s en V1, 10/s en smoke).
 * Chaque webhook porte un identifiant d'événement unique ; la réponse doit être 200 en moins de 400 ms (p95),
 * le traitement réel se fait en file (le webhook n'est qu'un signal).
 */
const cfg = SEED.tenants.lycee.academic.payments;
export const options = {
  scenarios: {
    webhooks: {
      executor: 'constant-arrival-rate',
      rate: profile('webhookRate'),
      timeUnit: '1s',
      duration: profile('duration'),
      preAllocatedVUs: 20,
      maxVUs: 200,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:webhook}': ['p(95)<400'],
  },
};

export default function () {
  const body = JSON.stringify({
    id: `evt_k6_${__VU}_${__ITER}_${Date.now()}`,
    event: 'transaction.success',
    transactionId: `k6-tx-${__VU}-${__ITER}`,
    attemptId: null,
    amount: 15000,
    status: 'SUCCESS',
    timestamp: new Date().toISOString(),
  });
  const res = http.post(`${BASE}/api/v1/webhooks/payments/FAKE/${cfg.webhookToken}`, body, {
    headers: { 'Content-Type': 'application/json', 'x-fake-signature': signFake(cfg.webhookSecret, body) },
    tags: { name: 'webhook' },
  });
  check(res, { 'webhook 200': (r) => r.status === 200 });
}
