import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hotp,
  otpauthUrl,
  totp,
  verifyTotp,
} from './totp';

/** Vecteurs de la RFC 6238 (annexe B, SHA-1, secret ASCII « 12345678901234567890 »), tronqués à 6 chiffres. */
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_SECRET_B32 = base32Encode(RFC_SECRET); // GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ

describe('TOTP (RFC 6238)', () => {
  it('base32 aller-retour', () => {
    expect(RFC_SECRET_B32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_SECRET_B32).equals(RFC_SECRET)).toBe(true);
    expect(base32Decode('gezd gnbv-gy3t qojq').toString('ascii')).toBe('1234567890');
  });

  it('produit les codes de référence de la RFC', () => {
    // T = 59 s → compteur 1 → 94287082 (8 chiffres) → « 287082 »
    expect(hotp(RFC_SECRET, 1)).toBe('287082');
    expect(totp(RFC_SECRET_B32, new Date(59_000))).toBe('287082');
    // T = 1111111109 → 07081804 → « 081804 »
    expect(totp(RFC_SECRET_B32, new Date(1_111_111_109_000))).toBe('081804');
    // T = 1234567890 → 89005924 → « 005924 »
    expect(totp(RFC_SECRET_B32, new Date(1_234_567_890_000))).toBe('005924');
    // T = 20000000000 → 65353130 → « 353130 »
    expect(totp(RFC_SECRET_B32, new Date(20_000_000_000_000))).toBe('353130');
  });

  it('accepte une dérive d’un pas, refuse au-delà et refuse un format invalide', () => {
    const at = new Date(1_234_567_890_000);
    const code = totp(RFC_SECRET_B32, at);
    expect(verifyTotp(RFC_SECRET_B32, code, at)).toBe(41_152_263);
    expect(verifyTotp(RFC_SECRET_B32, code, new Date(at.getTime() + 30_000))).not.toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, code, new Date(at.getTime() + 90_000))).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, '12345', at)).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, 'abcdef', at)).toBeNull();
  });

  it('génère des secrets de 160 bits et des codes de récupération uniques', () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s).length).toBe(20);
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    expect(new Set(codes).size).toBe(8);
  });

  it('construit une URL otpauth lisible par les applications', () => {
    const url = otpauthUrl('Polaris', 'admin@lycee-demo.local', RFC_SECRET_B32);
    expect(url.startsWith('otpauth://totp/Polaris%3Aadmin%40lycee-demo.local?')).toBe(true);
    expect(url).toContain(`secret=${RFC_SECRET_B32}`);
    expect(url).toContain('issuer=Polaris');
    expect(url).toContain('period=30');
  });
});
