import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ProviderCredentials } from '../domain/provider';
import { FedaPayProvider } from './fedapay.provider';
import { KKiaPayProvider } from './kkiapay.provider';
import { LocalKeyWrapper, maskSecret, openSecrets, sealSecrets } from '../../shared';

const creds = (over: Partial<ProviderCredentials> = {}): ProviderCredentials => ({
  publicKey: 'pk_test',
  secrets: { secretKey: 'sk_test', privateKey: 'priv', secret: 'sec' },
  webhookSecret: 'whsec_test',
  environment: 'SANDBOX',
  ...over,
});

describe('chiffrement d’enveloppe des secrets', () => {
  it('scelle puis ouvre ; une autre clé maître échoue ; rien en clair', () => {
    const w = new LocalKeyWrapper('une-cle-maitre-de-test');
    const sealed = sealSecrets(w, { secrets: { secretKey: 'sk_live_abcdef' } });
    expect(sealed).not.toContain('sk_live');
    expect(JSON.parse(sealed)).toMatchObject({ v: 1, kid: 'local-1' });
    expect(openSecrets(w, sealed)).toEqual({ secrets: { secretKey: 'sk_live_abcdef' } });
    expect(() => openSecrets(new LocalKeyWrapper('autre-cle'), sealed)).toThrow();
  });
  it('accepte une clé maître base64 de 32 octets', () => {
    const b64 = Buffer.alloc(32, 7).toString('base64');
    const w = new LocalKeyWrapper(b64);
    expect(openSecrets(w, sealSecrets(w, { a: 1 }))).toEqual({ a: 1 });
  });
  it('masque une clé en gardant 4 caractères', () => {
    expect(maskSecret('sk_sandbox_1234')).toBe('••••1234');
    expect(maskSecret('')).toBe('');
  });
});

describe('FedaPay — webhook signé et analyse', () => {
  const p = new FedaPayProvider({ SANDBOX: 'http://sandbox', LIVE: 'http://live' }, 1000);
  const body = JSON.stringify({
    name: 'transaction.approved',
    entity: {
      id: 12345,
      status: 'approved',
      amount: 50000,
      custom_metadata: { attempt_id: 'att-1' },
    },
  });
  const sig = (secret: string, t = Math.floor(Date.now() / 1000)) =>
    `t=${t},s=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

  it('signature valide → identifiants extraits ; indice de statut ; attempt_id des métadonnées', () => {
    const r = p.parseWebhook(
      creds(),
      { 'x-fedapay-signature': sig('whsec_test') },
      Buffer.from(body),
    );
    expect(r).not.toBe('INVALID_SIGNATURE');
    expect(r).toMatchObject({
      externalTransactionId: '12345',
      hintStatus: 'SUCCEEDED',
      attemptId: 'att-1',
    });
    expect((r as { externalEventId: string }).externalEventId).toHaveLength(40);
  });
  it('mauvais secret, en-tête absent ou horodatage trop ancien → INVALID_SIGNATURE', () => {
    expect(
      p.parseWebhook(creds(), { 'x-fedapay-signature': sig('autre') }, Buffer.from(body)),
    ).toBe('INVALID_SIGNATURE');
    expect(p.parseWebhook(creds(), {}, Buffer.from(body))).toBe('INVALID_SIGNATURE');
    expect(
      p.parseWebhook(
        creds(),
        { 'x-fedapay-signature': sig('whsec_test', 1_000_000) },
        Buffer.from(body),
      ),
    ).toBe('INVALID_SIGNATURE');
  });
  it('un corps modifié après signature est rejeté', () => {
    const tampered = body.replace('50000', '5000');
    expect(
      p.parseWebhook(creds(), { 'x-fedapay-signature': sig('whsec_test') }, Buffer.from(tampered)),
    ).toBe('INVALID_SIGNATURE');
  });
  it('capacités : création serveur, liste des transactions ; widget non', () => {
    expect(p.capabilities()).toMatchObject({
      serverInitiated: true,
      clientWidget: false,
      listTransactions: true,
    });
  });
});

describe('KKiaPay — webhook à secret partagé et widget', () => {
  const p = new KKiaPayProvider({ SANDBOX: 'http://sandbox', LIVE: 'http://live' }, 1000);
  const body = JSON.stringify({
    transactionId: 'tx_abc',
    isPaymentSucces: true,
    event: 'transaction.success',
    amount: 25000,
    stateData: 'att-9',
    timestamp: '2026-10-07T10:00:00Z',
  });
  it('secret correct → identifiant et attempt_id ; le statut n’est qu’un indice', () => {
    const r = p.parseWebhook(creds(), { 'x-kkiapay-secret': 'whsec_test' }, Buffer.from(body));
    expect(r).toMatchObject({
      externalTransactionId: 'tx_abc',
      hintStatus: 'SUCCEEDED',
      attemptId: 'att-9',
    });
  });
  it('secret absent ou différent → INVALID_SIGNATURE', () => {
    expect(p.parseWebhook(creds(), { 'x-kkiapay-secret': 'nope' }, Buffer.from(body))).toBe(
      'INVALID_SIGNATURE',
    );
    expect(p.parseWebhook(creds(), {}, Buffer.from(body))).toBe('INVALID_SIGNATURE');
  });
  it('initiate renvoie un widget avec la clé publique et notre attempt_id en donnée externe', async () => {
    const r = await p.initiate(creds(), {
      attemptId: 'att-9',
      amount: 25000,
      currency: 'XOF',
      description: 'd',
      customer: { firstName: 'A', lastName: 'B' },
      callbackUrl: 'http://cb',
      webhookUrl: 'http://wh',
    });
    expect(r.externalId).toBeNull();
    expect(r.checkout).toEqual({
      kind: 'WIDGET',
      publicKey: 'pk_test',
      sandbox: true,
      data: 'att-9',
      amount: 25000,
    });
  });
  it('sans clé publique, pas de widget', async () => {
    await expect(
      p.initiate(creds({ publicKey: null }), {
        attemptId: 'x',
        amount: 1,
        currency: 'XOF',
        description: '',
        customer: { firstName: '', lastName: '' },
        callbackUrl: '',
        webhookUrl: '',
      }),
    ).rejects.toThrow();
  });
});
