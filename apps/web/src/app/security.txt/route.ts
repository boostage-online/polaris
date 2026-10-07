/** security.txt (RFC 9116), servi aussi sous /.well-known/security.txt (réécriture) : divulgation responsable. */
export function GET() {
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);
  const body = [
    'Contact: mailto:security@polaris.app',
    'Expires: ' + expires.toISOString(),
    'Preferred-Languages: fr, en',
    'Policy: https://polaris.app/securite/divulgation',
    'Canonical: https://app.polaris.app/.well-known/security.txt',
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
