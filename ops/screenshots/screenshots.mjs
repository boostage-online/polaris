// Captures d'écran de l'application sur les données de démonstration (workflow « Captures d'écran »).
// Usage : node screenshots.mjs <seed.json> <dossier de sortie>   (API sur :4000, web sur :3000)
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';

const [, , seedFile, outDir] = process.argv;
const seed = JSON.parse(readFileSync(seedFile, 'utf8'));
const WEB = 'http://localhost:3000';
const API = 'http://localhost:4000/api/v1';
const PASSWORD = 'Polaris-demo-2026';
const MFA_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
mkdirSync(outDir, { recursive: true });

function base32(s) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '')) bits += a.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(offset = 0) {
  const counter = Math.floor(Date.now() / 30000) + offset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32(MFA_SECRET)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return n;
}
let lastCounter = 0;
async function freshTotp() {
  // Anti-rejeu côté serveur : un code par fenêtre de 30 s et par utilisateur.
  let c = Math.floor(Date.now() / 30000);
  if (c <= lastCounter) {
    await new Promise((r) => setTimeout(r, (c + 1) * 30000 - Date.now() + 200));
    c = Math.floor(Date.now() / 30000);
  }
  lastCounter = c;
  return totp();
}

async function apiLogin(email) {
  let r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client': 'shots/1' },
    body: JSON.stringify({ identifier: email, password: PASSWORD }),
  }).then((x) => x.json());
  if (r.data?.mfaRequired) {
    r = await fetch(`${API}/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client': 'shots/1' },
      body: JSON.stringify({ challenge: r.data.challenge, code: await freshTotp() }),
    }).then((x) => x.json());
  }
  return r.data.accessToken;
}

const browser = await chromium.launch();
const shots = [];

async function session(email, { mobile = false } = {}) {
  const ctx = await browser.newContext(
    mobile
      ? {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
          locale: 'fr-FR',
        }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'fr-FR' },
  );
  const page = await ctx.newPage();
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('E-mail ou téléphone').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.locator('form button[type=submit]').click();
  const mfa = page.getByPlaceholder('123 456');
  try {
    await mfa.waitFor({ timeout: 4000 });
    await mfa.fill(await freshTotp());
    await page.locator('form button[type=submit]').click();
  } catch {
    /* pas de MFA pour ce compte */
  }
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  return { ctx, page };
}

async function shot(page, path, name, title, { full = true } = {}) {
  try {
    await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: full });
    shots.push({ name, title, path });
    console.log(`✔ ${name} ${path}`);
  } catch (e) {
    console.log(`✖ ${name} ${path} : ${e.message}`);
  }
}

const L = seed.tenants.lycee;
// Agrégats du reporting à jour pour les tableaux de bord.
try {
  const token = await apiLogin(L.users.ADMIN.email);
  await fetch(`${API}/reports/refresh`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-client': 'shots/1',
    },
    body: JSON.stringify({}),
  });
} catch (e) {
  console.log('refresh :', e.message);
}

// Page de connexion et page publique d'état.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  await shot(page, '/login', '01-connexion', 'Connexion', { full: false });
  await shot(page, '/status', '02-etat-du-service', 'Page publique d’état du service', {
    full: false,
  });
  await ctx.close();
}

// Administrateur de l'établissement (lycée de démonstration).
{
  const { ctx, page } = await session(L.users.ADMIN.email);
  await shot(page, '/dashboard', '03-admin-tableau-de-bord', 'Administrateur — tableau de bord');
  await shot(page, '/onboarding', '04-admin-assistant', 'Administrateur — assistant de démarrage');
  await shot(page, '/students', '05-eleves', 'Scolarité — liste des élèves');
  await shot(page, `/students/${L.academic.studentIds[0]}`, '06-fiche-eleve', 'Fiche élève');
  await shot(page, '/structure', '07-structure', 'Structure académique');
  await shot(
    page,
    `/attendance/sessions/${L.academic.sessionId}`,
    '08-feuille-appel-admin',
    'Feuille d’appel (vue établissement)',
  );
  await shot(page, '/attendance/sheets', '09-feuilles-appel', 'Vie scolaire — feuilles d’appel');
  await shot(page, '/justifications', '10-justificatifs', 'Vie scolaire — justificatifs');
  await shot(page, '/direction', '11-direction', 'Direction — tableau de bord');
  await shot(page, '/pedagogy', '12-pedagogie', 'Pédagogie — assiduité par classe');
  await shot(page, '/finance', '13-finance', 'Finance — tableau de bord');
  await shot(page, '/finance/cash', '14-caisse', 'Finance — journal de caisse');
  await shot(page, '/finance/unpaid', '15-impayes', 'Finance — impayés et rappels');
  await shot(page, '/reports', '16-rapports', 'Rapports');
  await shot(page, '/settings/security', '17-securite-compte', 'Sécurité du compte (MFA)');
  await shot(page, '/admin/audit', '18-journal-audit', 'Journal d’audit');
  await ctx.close();
}

// Enseignant sur téléphone.
{
  const { ctx, page } = await session(L.users.TEACHER.email, { mobile: true });
  await shot(
    page,
    '/dashboard',
    '19-enseignant-mobile-accueil',
    'Enseignant (téléphone) — accueil',
  );
  await shot(
    page,
    '/schedule',
    '20-enseignant-mobile-emploi-du-temps',
    'Enseignant (téléphone) — emploi du temps',
  );
  await shot(
    page,
    `/attendance/sessions/${L.academic.sessionId}`,
    '21-enseignant-mobile-appel',
    'Enseignant (téléphone) — faire l’appel',
  );
  await ctx.close();
}

// Parent sur téléphone.
{
  const { ctx, page } = await session(L.academic.parentUser.email, { mobile: true });
  await shot(page, '/children', '22-parent-mobile-enfants', 'Parent (téléphone) — mes enfants');
  await shot(
    page,
    `/children/${L.academic.studentIds[0]}`,
    '23-parent-mobile-enfant',
    'Parent (téléphone) — suivi d’un enfant',
  );
  await shot(
    page,
    '/notifications',
    '24-parent-mobile-notifications',
    'Parent (téléphone) — notifications',
  );
  await ctx.close();
}

// Super Admin (plateforme).
{
  const { ctx, page } = await session(seed.platformAdmin.email);
  await shot(page, '/platform', '25-plateforme', 'Super Admin — vue d’ensemble');
  await ctx.close();
}

await browser.close();
const { writeFileSync } = await import('node:fs');
writeFileSync(`${outDir}/index.json`, JSON.stringify(shots, null, 2));
console.log(`${shots.length} captures`);
