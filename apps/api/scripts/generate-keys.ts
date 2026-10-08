/* Génère une paire de clés ES256 au format JWK pour JWT_PRIVATE_JWK / JWT_PUBLIC_JWK. */
import { exportJWK, generateKeyPair } from 'jose';

async function main() {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const priv = await exportJWK(privateKey);
  const pub = await exportJWK(publicKey);
  const kid = `k-${new Date().toISOString().slice(0, 10)}`;
  process.stdout.write(
    [
      `JWT_KID=${kid}`,
      `JWT_PRIVATE_JWK='${JSON.stringify({ ...priv, kid })}'`,
      `JWT_PUBLIC_JWK='${JSON.stringify({ ...pub, kid })}'`,
      '',
    ].join('\n'),
  );
}
void main();
