import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Chiffrement d'enveloppe des secrets applicatifs — clés provider, secrets TOTP (ADR-0010, Partie 11) : une clé de données (DEK) aléatoire
 * par enregistrement chiffre le JSON des secrets (AES-256-GCM) ; la DEK est elle-même enveloppée par la clé
 * maître. Le port `KeyWrapper` permet de remplacer l'enveloppe locale par un KMS sans toucher au reste.
 */
export interface KeyWrapper {
  readonly kid: string;
  wrap(dek: Buffer): Buffer;
  unwrap(wrapped: Buffer, kid: string): Buffer;
}

/** Enveloppe locale : clé maître dérivée de `PAYMENT_MASTER_KEY` (base64 32 octets, ou toute chaîne hachée). */
export class LocalKeyWrapper implements KeyWrapper {
  readonly kid = 'local-1';
  private readonly master: Buffer;
  constructor(masterKey: string) {
    const b64 = Buffer.from(masterKey, 'base64');
    this.master =
      b64.length === 32 && /^[A-Za-z0-9+/=]+$/.test(masterKey)
        ? b64
        : createHash('sha256').update(masterKey).digest();
  }
  wrap(dek: Buffer): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.master, iv);
    const data = Buffer.concat([c.update(dek), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), data]);
  }
  unwrap(wrapped: Buffer, kid: string): Buffer {
    if (kid !== this.kid) throw new Error(`Clé maître inconnue : ${kid}`);
    const iv = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(12, 28);
    const data = wrapped.subarray(28);
    const d = createDecipheriv('aes-256-gcm', this.master, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]);
  }
}

interface Envelope {
  v: 1;
  kid: string;
  wrappedKey: string;
  iv: string;
  tag: string;
  data: string;
}

export function sealSecrets(wrapper: KeyWrapper, value: unknown): string {
  const dek = randomBytes(32);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dek, iv);
  const plain = Buffer.from(JSON.stringify(value), 'utf8');
  const data = Buffer.concat([c.update(plain), c.final()]);
  const env: Envelope = {
    v: 1,
    kid: wrapper.kid,
    wrappedKey: wrapper.wrap(dek).toString('base64'),
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  return JSON.stringify(env);
}

export function openSecrets<T = unknown>(wrapper: KeyWrapper, sealed: string): T {
  const env = JSON.parse(sealed) as Envelope;
  if (env.v !== 1) throw new Error('Enveloppe de secrets inconnue');
  const dek = wrapper.unwrap(Buffer.from(env.wrappedKey, 'base64'), env.kid);
  const d = createDecipheriv('aes-256-gcm', dek, Buffer.from(env.iv, 'base64'));
  d.setAuthTag(Buffer.from(env.tag, 'base64'));
  const plain = Buffer.concat([d.update(Buffer.from(env.data, 'base64')), d.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}

/** Affichage masqué d'une clé : `••••1a2b` (jamais la valeur complète, ADR-0010). */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  return `••••${value.slice(-4)}`;
}
