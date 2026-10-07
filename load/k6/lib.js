import http from 'k6/http';
import { check } from 'k6';
import crypto from 'k6/crypto';

/** Outils communs des scénarios k6 : URL, connexion (sans MFA : enseignant, scolarité, direction, parent), signature webhook. */
export const BASE = __ENV.API_URL || 'http://localhost:4000';
export const PASSWORD = __ENV.DEMO_PASSWORD || 'Polaris-demo-2026';
export const SEED = JSON.parse(open(__ENV.SEED_FILE || '../../apps/api/.test-seed.json'));

export function login(email) {
  const res = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({ identifier: email, password: PASSWORD, deviceId: `k6-${__VU}-${Date.now()}` }),
    { headers: { 'Content-Type': 'application/json', 'X-Client': 'k6/1.0' }, tags: { name: 'login' } },
  );
  check(res, { 'login 200': (r) => r.status === 200 });
  const body = res.json('data');
  if (!body || body.mfaRequired) throw new Error(`login ${email} : ${res.status} (MFA ?)`);
  return body.accessToken;
}

export function authed(token, name) {
  return {
    headers: { Authorization: `Bearer ${token}`, 'X-Client': 'k6/1.0', 'Content-Type': 'application/json' },
    tags: { name },
  };
}

export function get(token, path, name) {
  const res = http.get(`${BASE}/api/v1${path}`, authed(token, name));
  check(res, { [`${name} 200`]: (r) => r.status === 200 });
  return res;
}

/** Signature du provider de démonstration : sha256(secret|corps). */
export function signFake(secret, body) {
  return crypto.sha256(`${secret}|${body}`, 'hex');
}

/** Profils : smoke (CI), nominal (staging), full (G7 : 2 000 utilisateurs simultanés). */
export function profile(name) {
  const p = __ENV.PROFILE || 'smoke';
  const table = {
    smoke: { vus: 10, duration: '45s', webhookRate: 10 },
    nominal: { vus: 200, duration: '5m', webhookRate: 50 },
    full: { vus: 2000, duration: '10m', webhookRate: 100 },
  };
  return (table[p] || table.smoke)[name];
}
