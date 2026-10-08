import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content-Security-Policy avec nonce (Partie 11). Déployée d'abord en mode *Report-Only* ; `CSP_ENFORCE=true`
 * bascule en mode bloquant une fois les rapports vides sur staging. Les scripts tiers (widget KKiaPay) sont
 * chargés par nos scripts porteurs du nonce (`strict-dynamic`) ; les iframes et appels provider sont listés.
 */
const API_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').origin;
  } catch {
    return "'self'";
  }
})();
const PROVIDER_HOSTS = 'https://*.kkiapay.me https://*.fedapay.com https://cdn.kkiapay.me';

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== 'production';
  const csp = [
    `default-src 'self'`,
    // `unsafe-eval` uniquement en développement (React Refresh) ; `strict-dynamic` propage la confiance du nonce.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''} ${PROVIDER_HOSTS}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: ${PROVIDER_HOSTS}`,
    `font-src 'self' data:`,
    `connect-src 'self' ${API_ORIGIN} ${PROVIDER_HOSTS}${dev ? ' ws: wss:' : ''}`,
    `frame-src ${PROVIDER_HOSTS}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
  const header =
    process.env.CSP_ENFORCE === 'true'
      ? 'Content-Security-Policy'
      : 'Content-Security-Policy-Report-Only';

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, csp);
  return response;
}

export const config = {
  matcher: [
    // Tout sauf les ressources statiques et les préchargements.
    {
      source: '/((?!_next/static|_next/image|favicon.ico|\\.well-known).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
