import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { ImportQuerySchema } from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  enrollments,
  groups,
  guardians,
  importJobs,
  studentGuardians,
  students,
} from '../../../database/schema';
import { StructureService } from '../../academic';
import { AuditService } from '../../audit';
import { normalizeName, normalizePhone } from '../domain/policies';
import { GuardianService } from './guardian.service';
import { StudentService } from './student.service';

export interface RowReport {
  line: number;
  status: 'OK' | 'ERROR' | 'WARNING';
  message?: string;
  key?: string;
}

/** Parseur CSV minimal (séparateur , ou ; détecté, guillemets doubles, BOM). Suffisant pour les exports scolaires. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep =
    (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  const headers = (rows.shift() ?? []).map((h) => normalizeName(h).replace(/ /g, '_'));
  return { headers, rows: rows.map((r) => r.map((c) => c.trim())) };
}

const STUDENT_COLUMNS = {
  matricule: ['matricule', 'id', 'numero'],
  lastName: ['nom', 'last_name', 'lastname'],
  firstName: ['prenom', 'prenoms', 'first_name', 'firstname'],
  birthDate: ['date_de_naissance', 'naissance', 'birth_date', 'ddn'],
  gender: ['sexe', 'genre', 'gender'],
  group: ['classe', 'groupe', 'class', 'group'],
};
const GUARDIAN_COLUMNS = {
  matricule: ['matricule', 'matricule_eleve', 'eleve'],
  lastName: ['nom', 'nom_tuteur', 'last_name'],
  firstName: ['prenom', 'prenoms', 'prenom_tuteur', 'first_name'],
  phone: ['telephone', 'tel', 'phone', 'mobile'],
  email: ['email', 'mail'],
  relationship: ['lien', 'relation', 'relationship'],
};

function pick(headers: string[], row: string[], names: string[]): string | undefined {
  for (const n of names) {
    const i = headers.indexOf(n);
    if (i >= 0) return row[i] === '' ? undefined : row[i];
  }
  return undefined;
}

const INVALID_DATE = Symbol('invalid-date');
function parseDate(v: string | undefined): string | null | typeof INVALID_DATE {
  if (!v) return null;
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m1) return v;
  const m2 = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (m2) return `${m2[3]}-${m2[2]!.padStart(2, '0')}-${m2[1]!.padStart(2, '0')}`;
  return INVALID_DATE;
}

/**
 * Imports CSV élèves (avec classe) et tuteurs (avec liens), ligne par ligne, en mode simulation ou réel.
 * Synchrone jusqu'à 5 000 lignes (volume d'un établissement) ; au-delà, l'import est refusé et devra être découpé
 * (le passage en job asynchrone est prévu quand le volume le justifiera).
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly structure: StructureService,
    private readonly studentsSvc: StudentService,
    private readonly guardiansSvc: GuardianService,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  async importStudents(csv: string, opts: z.infer<typeof ImportQuerySchema>) {
    const tx = this.db.current();
    const { headers, rows } = parseCsv(csv);
    this.assertSize(rows.length);
    const missing = ['lastName', 'firstName'].filter(
      (k) => !STUDENT_COLUMNS[k as keyof typeof STUDENT_COLUMNS].some((n) => headers.includes(n)),
    );
    if (missing.length)
      throw AppError.validation([
        {
          path: 'csv',
          message: `Colonnes requises absentes : nom, prénom (reçu : ${headers.join(', ')})`,
        },
      ]);

    const yearId = opts.academicYearId ?? (await this.structure.currentYear(tx)).id;
    const groupRows = await tx.query.groups.findMany({
      where: and(eq(groups.academicYearId, yearId), isNull(groups.deletedAt)),
    });
    const groupByName = new Map(groupRows.map((g) => [normalizeName(g.name), g]));
    const existing = await tx
      .select({
        id: students.id,
        matricule: students.matricule,
        firstName: students.firstName,
        lastName: students.lastName,
        birthDate: students.birthDate,
      })
      .from(students)
      .where(isNull(students.deletedAt));
    const byMatricule = new Map(existing.map((s) => [s.matricule, s]));
    const byIdentity = new Map(
      existing.map((s) => [
        `${normalizeName(s.lastName)}|${normalizeName(s.firstName)}|${s.birthDate ?? ''}`,
        s,
      ]),
    );
    const seenInFile = new Set<string>();

    const report: RowReport[] = [];
    let ok = 0;
    for (let i = 0; i < rows.length; i++) {
      const line = i + 2;
      const row = rows[i]!;
      const lastName = pick(headers, row, STUDENT_COLUMNS.lastName);
      const firstName = pick(headers, row, STUDENT_COLUMNS.firstName);
      const matricule = pick(headers, row, STUDENT_COLUMNS.matricule);
      const birth = parseDate(pick(headers, row, STUDENT_COLUMNS.birthDate));
      const genderRaw = pick(headers, row, STUDENT_COLUMNS.gender)?.toUpperCase();
      const gender = genderRaw
        ? genderRaw.startsWith('F')
          ? 'F'
          : genderRaw.startsWith('M') || genderRaw.startsWith('G')
            ? 'M'
            : 'X'
        : null;
      const groupName = pick(headers, row, STUDENT_COLUMNS.group);

      if (!lastName || !firstName) {
        report.push({ line, status: 'ERROR', message: 'Nom ou prénom manquant' });
        continue;
      }
      if (birth === INVALID_DATE) {
        report.push({
          line,
          status: 'ERROR',
          message: 'Date de naissance illisible (attendu JJ/MM/AAAA ou AAAA-MM-JJ)',
        });
        continue;
      }
      const group = groupName ? groupByName.get(normalizeName(groupName)) : undefined;
      if (groupName && !group) {
        report.push({
          line,
          status: 'ERROR',
          message: `Classe « ${groupName} » inconnue pour cette année`,
          key: matricule,
        });
        continue;
      }
      const identityKey = `${normalizeName(lastName)}|${normalizeName(firstName)}|${birth ?? ''}`;
      if (seenInFile.has(matricule ?? identityKey)) {
        report.push({ line, status: 'ERROR', message: 'Doublon dans le fichier', key: matricule });
        continue;
      }
      seenInFile.add(matricule ?? identityKey);

      const existingByMatricule = matricule ? byMatricule.get(matricule) : undefined;
      const probableDup = !existingByMatricule ? byIdentity.get(identityKey) : undefined;
      // Point de sauvegarde par ligne : une erreur SQL n'empoisonne pas la transaction des lignes suivantes.
      await tx.execute(sql`savepoint import_row`);
      try {
        if (!opts.dryRun) {
          let studentId: string;
          if (existingByMatricule) {
            await tx
              .update(students)
              .set({ firstName, lastName, birthDate: birth, gender })
              .where(eq(students.id, existingByMatricule.id));
            studentId = existingByMatricule.id;
          } else {
            studentId = randomUUID();
            const code = matricule ?? (await this.studentsSvc.nextMatricule(tx));
            await tx.insert(students).values({
              id: studentId,
              tenantId: this.tenantId,
              matricule: code,
              firstName,
              lastName,
              birthDate: birth,
              gender,
              photoKey: null,
              status: 'ACTIVE',
              leftAt: null,
              notes: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            byMatricule.set(code, {
              id: studentId,
              matricule: code,
              firstName,
              lastName,
              birthDate: birth,
            });
          }
          if (group) {
            const current = await tx.query.enrollments.findFirst({
              where: and(
                eq(enrollments.studentId, studentId),
                eq(enrollments.academicYearId, yearId),
                eq(enrollments.isPrimary, true),
                isNull(enrollments.leftAt),
              ),
            });
            if (!current) {
              await tx.insert(enrollments).values({
                id: randomUUID(),
                tenantId: this.tenantId,
                studentId,
                groupId: group.id,
                academicYearId: yearId,
                isPrimary: group.kind === 'CLASS',
                enrolledAt: new Date().toISOString().slice(0, 10),
                leftAt: null,
                leftReason: null,
                createdBy: RequestContextStore.require().actor?.userId ?? null,
                createdAt: new Date(),
              });
            } else if (current.groupId !== group.id) {
              report.push({
                line,
                status: 'WARNING',
                message: `Déjà inscrit dans une autre classe : non déplacé (utilisez le changement de classe)`,
                key: matricule,
              });
            }
          }
        }
        ok++;
        if (probableDup)
          report.push({
            line,
            status: 'WARNING',
            message: `Doublon probable avec ${probableDup.matricule} (${probableDup.lastName} ${probableDup.firstName})`,
            key: matricule,
          });
        else
          report.push({
            line,
            status: 'OK',
            message: existingByMatricule ? 'Mis à jour' : 'Créé',
            key: matricule,
          });
      } catch (e) {
        await tx.execute(sql`rollback to savepoint import_row`);
        report.push({
          line,
          status: 'ERROR',
          message: (e as Error).message.slice(0, 200),
          key: matricule,
        });
      }
    }
    return this.finish('STUDENTS', opts.dryRun, rows.length, ok, report);
  }

  async importGuardians(csv: string, opts: z.infer<typeof ImportQuerySchema>) {
    const tx = this.db.current();
    const { headers, rows } = parseCsv(csv);
    this.assertSize(rows.length);
    for (const k of ['matricule', 'lastName', 'phone'] as const) {
      if (!GUARDIAN_COLUMNS[k].some((n) => headers.includes(n)))
        throw AppError.validation([
          {
            path: 'csv',
            message: `Colonne requise absente : ${GUARDIAN_COLUMNS[k][0]} (reçu : ${headers.join(', ')})`,
          },
        ]);
    }
    const matricules = [
      ...new Set(
        rows
          .map((r) => pick(headers, r, GUARDIAN_COLUMNS.matricule))
          .filter((m): m is string => Boolean(m)),
      ),
    ];
    const studentIds = await this.studentsSvc.idsByMatricule(tx, matricules);
    const report: RowReport[] = [];
    let ok = 0;
    for (let i = 0; i < rows.length; i++) {
      const line = i + 2;
      const row = rows[i]!;
      const matricule = pick(headers, row, GUARDIAN_COLUMNS.matricule);
      const lastName = pick(headers, row, GUARDIAN_COLUMNS.lastName);
      const firstName = pick(headers, row, GUARDIAN_COLUMNS.firstName) ?? '';
      const phone = normalizePhone(pick(headers, row, GUARDIAN_COLUMNS.phone) ?? '');
      const email = pick(headers, row, GUARDIAN_COLUMNS.email)?.toLowerCase() ?? null;
      const relRaw = normalizeName(pick(headers, row, GUARDIAN_COLUMNS.relationship) ?? 'tuteur');
      const relationship =
        relRaw.startsWith('mere') || relRaw.startsWith('mother') || relRaw.startsWith('maman')
          ? 'MOTHER'
          : relRaw.startsWith('pere') || relRaw.startsWith('father') || relRaw.startsWith('papa')
            ? 'FATHER'
            : relRaw.startsWith('tut')
              ? 'TUTOR'
              : 'OTHER';
      const studentId = matricule ? studentIds.get(matricule) : undefined;
      if (!studentId) {
        report.push({
          line,
          status: 'ERROR',
          message: `Élève « ${matricule ?? '?'} » introuvable`,
          key: matricule,
        });
        continue;
      }
      if (!lastName) {
        report.push({ line, status: 'ERROR', message: 'Nom du tuteur manquant', key: matricule });
        continue;
      }
      if (!phone) {
        report.push({
          line,
          status: 'ERROR',
          message: 'Téléphone illisible (attendu +229… ou 01 97 …)',
          key: matricule,
        });
        continue;
      }
      await tx.execute(sql`savepoint import_row`);
      try {
        if (!opts.dryRun) {
          const { guardian, created } = await this.guardiansSvc.createOrReuse(
            { firstName: firstName || '—', lastName, phone, email, preferredChannel: 'SMS' },
            tx,
          );
          const linked = await tx.query.studentGuardians.findFirst({
            where: and(
              eq(studentGuardians.studentId, studentId),
              eq(studentGuardians.guardianId, guardian.id),
              isNull(studentGuardians.unlinkedAt),
            ),
          });
          if (!linked) {
            await tx.insert(studentGuardians).values({
              id: randomUUID(),
              tenantId: this.tenantId,
              studentId,
              guardianId: guardian.id,
              relationship,
              isPrimary: false,
              canViewAttendance: true,
              canViewFinance: true,
              canPay: true,
              canJustify: true,
              linkedBy: RequestContextStore.require().actor?.userId ?? null,
              linkedAt: new Date(),
              unlinkedAt: null,
              unlinkedBy: null,
              unlinkReason: null,
            });
          }
          report.push({
            line,
            status: 'OK',
            message: `${created ? 'Tuteur créé' : 'Tuteur existant'}${linked ? ', déjà lié' : ', lié'}`,
            key: matricule,
          });
        } else {
          const existing = await tx.query.guardians.findFirst({
            where: and(eq(guardians.phoneE164, phone), isNull(guardians.deletedAt)),
          });
          report.push({
            line,
            status: 'OK',
            message: existing ? 'Tuteur existant (réutilisé)' : 'Tuteur à créer',
            key: matricule,
          });
        }
        ok++;
      } catch (e) {
        await tx.execute(sql`rollback to savepoint import_row`);
        report.push({
          line,
          status: 'ERROR',
          message: (e as Error).message.slice(0, 200),
          key: matricule,
        });
      }
    }
    return this.finish('GUARDIANS', opts.dryRun, rows.length, ok, report);
  }

  async get(id: string) {
    const job = await this.db
      .current()
      .query.importJobs.findFirst({ where: eq(importJobs.id, id) });
    if (!job) throw AppError.notFound('Import');
    return this.dto(job);
  }

  async recent(limit = 5) {
    const rows = await this.db
      .current()
      .query.importJobs.findMany({ orderBy: (j, { desc }) => [desc(j.createdAt)], limit });
    return rows.map((j) => ({ ...this.dto(j), report: undefined }));
  }

  private assertSize(n: number) {
    if (n === 0) throw AppError.validation([{ path: 'csv', message: 'Aucune ligne de données' }]);
    if (n > 5000)
      throw AppError.validation([
        { path: 'csv', message: 'Maximum 5 000 lignes par import : découpez le fichier' },
      ]);
  }

  private async finish(
    kind: 'STUDENTS' | 'GUARDIANS',
    dryRun: boolean,
    total: number,
    ok: number,
    report: RowReport[],
  ) {
    const tx = this.db.current();
    const errors = report.filter((r) => r.status === 'ERROR').length;
    const id = randomUUID();
    await tx.insert(importJobs).values({
      id,
      tenantId: this.tenantId,
      kind,
      dryRun,
      status: 'DONE',
      rowsTotal: total,
      rowsOk: ok,
      rowsError: errors,
      report: report as unknown[],
      createdBy: RequestContextStore.require().actor?.userId ?? null,
      createdAt: new Date(),
      finishedAt: new Date(),
    });
    if (!dryRun)
      await this.audit.record({
        action: 'import.applied',
        entityType: 'ImportJob',
        entityId: id,
        after: { kind, total, ok, errors },
      });
    return this.dto((await tx.query.importJobs.findFirst({ where: eq(importJobs.id, id) }))!);
  }

  private dto(j: typeof importJobs.$inferSelect) {
    return {
      id: j.id,
      kind: j.kind,
      dryRun: j.dryRun,
      status: j.status,
      rowsTotal: j.rowsTotal,
      rowsOk: j.rowsOk,
      rowsError: j.rowsError,
      report: j.report as RowReport[],
      createdAt: j.createdAt.toISOString(),
    };
  }
}

export type { Db };
