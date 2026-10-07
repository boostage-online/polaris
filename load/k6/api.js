import { sleep, group } from 'k6';
import { BASE, SEED, get, login, profile } from './lib.js';

/**
 * Parcours utilisateurs (lecture) : enseignant (appels du jour, emploi du temps), scolarité (élèves),
 * direction (tableau de bord), parent (enfants). Seuil G7 : p95 < 400 ms.
 */
export const options = {
  scenarios: {
    staff: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '15s', target: profile('vus') },
        { duration: profile('duration'), target: profile('vus') },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<400'],
    'http_req_duration{name:login}': ['p(95)<800'],
  },
};

const lycee = SEED.tenants.lycee;
const roles = [
  { email: lycee.users.TEACHER.email, run: teacher },
  { email: lycee.users.REGISTRAR.email, run: registrar },
  { email: lycee.users.DIRECTION.email, run: direction },
  { email: lycee.academic.parentUser.email, run: parentFlow },
];

export function setup() {
  // Un jeton par rôle, partagé entre les VUs (les sessions sont des refresh par appareil ; la lecture suffit ici).
  return roles.map((r) => ({ email: r.email, token: login(r.email) }));
}

export default function (tokens) {
  const i = __VU % roles.length;
  roles[i].run(tokens[i].token);
  sleep(1);
}

function teacher(t) {
  group('enseignant', () => {
    get(t, '/me', 'me');
    get(t, '/attendance/today', 'attendance.today');
    get(t, '/me/schedule?from=2026-10-05&to=2026-10-18', 'me.schedule');
  });
}
function registrar(t) {
  group('scolarité', () => {
    get(t, '/students?limit=50', 'students.list');
    get(t, `/students/${lycee.academic.studentIds[0]}`, 'students.get');
    get(t, '/dashboards/registrar', 'dashboards.registrar');
  });
}
function direction(t) {
  group('direction', () => {
    get(t, '/dashboards/direction', 'dashboards.direction');
    get(t, '/reports', 'reports.catalog');
    get(t, '/reports/attendance-by-group', 'reports.run');
  });
}
function parentFlow(t) {
  group('parent', () => {
    get(t, '/me/children', 'me.children');
    get(t, `/me/children/${lycee.academic.studentIds[0]}/attendance?limit=30`, 'me.children.attendance');
  });
}

export function teardown() {
  // Rien à nettoyer : lecture seule. BASE conservé pour le rapport.
  return BASE;
}
