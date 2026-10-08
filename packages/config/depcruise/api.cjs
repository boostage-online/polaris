/**
 * Règles de couches du modular monolith (ADR-0001).
 *
 *   Couche 4 — transverse     : notifications, reporting, launch
 *   Couche 3 — métier cœur    : attendance, billing, payments
 *   Couche 2 — référentiels   : academic, students-guardians
 *   Couche 1 — socle          : tenancy, identity, platform, audit, shared, database, common
 *
 * Un module n'importe que des modules de couches inférieures, et uniquement via leur index.ts.
 */
const layer1 = ['tenancy', 'identity', 'platform', 'audit'];
const layer2 = ['academic', 'students-guardians'];
const layer3 = ['attendance', 'billing', 'payments'];
const layer4 = ['notifications', 'reporting', 'launch'];
const infra = ['shared', 'database', 'common', 'config', 'health'];

const mod = (names) => `^src/modules/(${names.join('|')})/`;

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'only-public-api-between-modules',
      comment: 'Un module importe un autre module uniquement via son index.ts',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/(?!index\\.ts$).+',
        pathNot: '^src/modules/$1/',
      },
    },
    {
      name: 'layer1-imports-only-infra',
      severity: 'error',
      from: { path: mod(layer1) },
      to: { path: mod([...layer2, ...layer3, ...layer4]) },
    },
    {
      name: 'layer2-no-upward',
      severity: 'error',
      from: { path: mod(layer2) },
      to: { path: mod([...layer3, ...layer4]) },
    },
    {
      name: 'layer3-no-upward',
      severity: 'error',
      from: { path: mod(layer3) },
      to: { path: mod(layer4) },
    },
    {
      name: 'payments-ignores-academic-and-attendance',
      severity: 'error',
      from: { path: mod(['payments']) },
      to: { path: mod(['academic', 'attendance']) },
    },
    {
      name: 'billing-does-not-know-payments',
      severity: 'error',
      from: { path: mod(['billing']) },
      to: { path: mod(['payments']) },
    },
    {
      name: 'domain-is-pure',
      comment: 'domain/ ne dépend ni de NestJS, ni de Drizzle, ni de HTTP',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/domain/' },
      to: {
        path: '(node_modules/(@nestjs|drizzle-orm|pg|express|ioredis|bullmq)|^src/modules/[^/]+/(infrastructure|controllers)/)',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: { dot: { collapsePattern: 'node_modules/[^/]+' } },
  },
};
