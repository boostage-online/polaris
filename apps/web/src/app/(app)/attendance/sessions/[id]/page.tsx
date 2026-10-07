'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { AttendanceRecord, AttendanceSheet, RecordInput } from '@polaris/contracts';
import { useCan, useMe } from '@/components/app-shell';
import { StatusBadge, statusLabel } from '@/components/attendance';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorAlert,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  errorMessage,
} from '@/components/ui';
import { ApiError } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtTime } from '@/lib/format';
import { attendance } from '@/lib/resources';

type Draft = Record<
  string,
  { status: 'PRESENT' | 'ABSENT' | 'LATE'; lateMinutes: number | null; note: string | null }
>;
const DRAFT_KEY = (sheetId: string) => `polaris:draft:${sheetId}`;

/**
 * Feuille d'appel (P3-E1) : liste tactile, un geste par élève, brouillon conservé localement et envoyé
 * toutes les 10 s, validation avec version optimiste, puis corrections motivées après soumission.
 */
export default function SheetPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const router = useRouter();
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const canTake = can('TAKE_ATTENDANCE', 'TAKE_ATTENDANCE_ANY');

  // Ouvre (ou retrouve) la feuille : POST idempotent côté API.
  const q = useQuery({
    queryKey: ['attendance', 'session', sessionId],
    queryFn: async () => {
      if (canTake) {
        try {
          return await attendance.open(sessionId);
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 403) throw e;
        }
      }
      return attendance.bySession(sessionId);
    },
    retry: false,
  });

  if (q.isPending) return <Loading />;
  if (q.isError) {
    const e = q.error;
    return (
      <>
        <PageHeader title="Feuille d'appel" />
        <Alert tone={e instanceof ApiError && e.status === 422 ? 'warning' : 'error'}>
          {errorMessage(e)}
        </Alert>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => router.back()}>
            Retour
          </Button>
        </div>
      </>
    );
  }
  const sheet = q.data;
  const refresh = (s?: AttendanceSheet) => {
    if (s) qc.setQueryData(['attendance', 'session', sessionId], s);
    return Promise.all([
      qc.invalidateQueries({ queryKey: ['attendance', 'today'] }),
      qc.invalidateQueries({ queryKey: ['attendance', 'sheets'] }),
    ]);
  };
  return sheet.status === 'DRAFT' && canTake ? (
    <DraftSheet sheet={sheet} tz={me.tenantTimezone} onChanged={refresh} />
  ) : (
    <SubmittedSheet sheet={sheet} tz={me.tenantTimezone} onChanged={refresh} />
  );
}

function Header({
  sheet,
  tz,
  right,
}: {
  sheet: AttendanceSheet;
  tz: string | null;
  right?: ReactNode;
}) {
  const s = sheet.session!;
  return (
    <PageHeader
      title={`${s.subjectName} — ${s.groupName}`}
      subtitle={
        <>
          {fmtDate(s.startsAt, tz)} · {fmtTime(s.startsAt, tz)} – {fmtTime(s.endsAt, tz)}
          {s.room ? ` · ${s.room}` : ''}
          {sheet.retroactive && (
            <>
              {' '}
              · <Badge tone="amber">saisie rétroactive</Badge>
            </>
          )}
        </>
      }
      actions={right}
    />
  );
}

// ----------------------------------------------------------------------------- brouillon
function DraftSheet({
  sheet: initial,
  tz,
  onChanged,
}: {
  sheet: AttendanceSheet;
  tz: string | null;
  onChanged: (s?: AttendanceSheet) => Promise<unknown>;
}) {
  const [sheet, setSheet] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => {
    const fromServer: Draft = {};
    for (const r of initial.records ?? [])
      fromServer[r.studentId] = { status: r.status, lateMinutes: r.lateMinutes, note: r.note };
    try {
      const local = window.localStorage.getItem(DRAFT_KEY(initial.id));
      if (local) {
        const parsed = JSON.parse(local) as { version: number; draft: Draft };
        // Le brouillon local prime s'il est plus récent que la version serveur (perte de réseau).
        if (parsed.version >= initial.version) return { ...fromServer, ...parsed.draft };
      }
    } catch {
      /* stockage indisponible : on repart du serveur */
    }
    return fromServer;
  });
  const [dirty, setDirty] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lateFor, setLateFor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState('');
  const versionRef = useRef(sheet.version);

  const records = useMemo(
    () =>
      (sheet.records ?? []).filter((r) =>
        `${r.student?.lastName} ${r.student?.firstName}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
      ),
    [sheet.records, filter],
  );
  const toInputs = useCallback(
    (): RecordInput[] =>
      Object.entries(draft).map(([studentId, d]) => ({
        studentId,
        status: d.status,
        lateMinutes: d.lateMinutes,
        note: d.note,
      })),
    [draft],
  );

  // Sauvegarde locale immédiate à chaque geste.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        DRAFT_KEY(sheet.id),
        JSON.stringify({ version: versionRef.current, draft }),
      );
    } catch {
      /* ignore */
    }
  }, [draft, sheet.id]);

  const save = useMutation({
    mutationFn: () => attendance.patch(sheet.id, versionRef.current, toInputs()),
    onSuccess: (s) => {
      versionRef.current = s.version;
      setSheet(s);
      setDirty(false);
      setOffline(false);
      setError(null);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        if (e.status === 409 && e.problem.code === 'VERSION_CONFLICT') {
          const current = (e.problem as { currentVersion?: number }).currentVersion;
          if (current) versionRef.current = current;
        }
        setError(e);
      } else setOffline(true);
    },
  });

  // Envoi périodique du brouillon (10 s) tant qu'il y a des changements.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (dirty && !save.isPending) save.mutate();
    }, 10_000);
    return () => window.clearInterval(t);
  }, [dirty, save]);

  const submit = useMutation({
    mutationFn: () => attendance.submit(sheet.id, versionRef.current, toInputs()),
    onSuccess: async (s) => {
      try {
        window.localStorage.removeItem(DRAFT_KEY(sheet.id));
      } catch {
        /* ignore */
      }
      await onChanged(s);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        const current = (e.problem as { currentVersion?: number }).currentVersion;
        if (current) versionRef.current = current;
      }
      setError(e);
    },
  });

  const set = (studentId: string, patch: Partial<Draft[string]>) => {
    setDraft((d) => ({
      ...d,
      [studentId]: {
        ...(d[studentId] ?? { status: 'PRESENT', lateMinutes: null, note: null }),
        ...patch,
      },
    }));
    setDirty(true);
  };
  /** Un tap : Absent ; un second tap sur Absent : Présent ; « Retard » ouvre la saisie des minutes. */
  const tap = (studentId: string) => {
    const cur = draft[studentId]?.status ?? 'PRESENT';
    set(
      studentId,
      cur === 'ABSENT'
        ? { status: 'PRESENT', lateMinutes: null }
        : { status: 'ABSENT', lateMinutes: null },
    );
  };
  const counts = Object.values(draft).reduce(
    (acc, d) => ({ ...acc, [d.status]: acc[d.status] + 1 }),
    { PRESENT: 0, ABSENT: 0, LATE: 0 } as Record<'PRESENT' | 'ABSENT' | 'LATE', number>,
  );

  return (
    <>
      <Header
        sheet={sheet}
        tz={tz}
        right={
          <div className="flex items-center gap-2 text-sm">
            {offline && <Badge tone="amber">Hors ligne — brouillon conservé</Badge>}
            {!offline && dirty && <span className="text-slate-500">Enregistrement…</span>}
            {!offline && !dirty && <span className="text-slate-500">Brouillon à jour</span>}
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone="green">{counts.PRESENT} présents</Badge>
        <Badge tone="red">{counts.ABSENT} absents</Badge>
        <Badge tone="amber">{counts.LATE} retards</Badge>
        <Input
          placeholder="Filtrer un nom…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="ml-auto max-w-56"
        />
      </div>
      <ErrorAlert error={error} />
      <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {records.map((r) => {
          const d = draft[r.studentId] ?? {
            status: 'PRESENT' as const,
            lateMinutes: null,
            note: null,
          };
          const tone =
            d.status === 'PRESENT' ? '' : d.status === 'ABSENT' ? 'bg-red-50' : 'bg-amber-50';
          return (
            <li key={r.id} className={`flex items-center gap-2 px-3 py-2 ${tone}`}>
              <button
                type="button"
                onClick={() => tap(r.studentId)}
                className="flex min-h-12 flex-1 items-center justify-between text-left"
                aria-label={`${r.student?.lastName} ${r.student?.firstName} : ${statusLabel(d.status, 'NONE', d.lateMinutes)}`}
              >
                <span>
                  <span className="font-medium">{r.student?.lastName}</span> {r.student?.firstName}
                  <span className="ml-2 font-mono text-xs text-slate-400">
                    {r.student?.matricule}
                  </span>
                </span>
                <StatusBadge status={d.status} lateMinutes={d.lateMinutes} />
              </button>
              <Button
                type="button"
                size="sm"
                variant={d.status === 'LATE' ? 'primary' : 'secondary'}
                onClick={() => setLateFor(r.studentId)}
                aria-label="Retard"
              >
                ⏱
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
        <p className="text-sm text-slate-600">
          Touchez un élève pour le marquer absent ; ⏱ pour un retard.
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={save.isPending || !dirty}
            onClick={() => save.mutate()}
          >
            Enregistrer le brouillon
          </Button>
          <Button disabled={submit.isPending} onClick={() => submit.mutate()}>
            Valider l&apos;appel
          </Button>
        </div>
      </div>
      <LateModal
        open={lateFor !== null}
        initial={lateFor ? (draft[lateFor]?.lateMinutes ?? 5) : 5}
        studentName={
          lateFor
            ? `${sheet.records?.find((r) => r.studentId === lateFor)?.student?.firstName ?? ''}`
            : ''
        }
        onClose={() => setLateFor(null)}
        onPick={(minutes) => {
          if (lateFor) set(lateFor, { status: 'LATE', lateMinutes: minutes });
          setLateFor(null);
        }}
        onPresent={() => {
          if (lateFor) set(lateFor, { status: 'PRESENT', lateMinutes: null });
          setLateFor(null);
        }}
      />
    </>
  );
}

function LateModal({
  open,
  initial,
  studentName,
  onClose,
  onPick,
  onPresent,
}: {
  open: boolean;
  initial: number;
  studentName: string;
  onClose: () => void;
  onPick: (m: number) => void;
  onPresent: () => void;
}) {
  const [minutes, setMinutes] = useState(String(initial));
  useEffect(() => setMinutes(String(initial)), [initial, open]);
  return (
    <Modal open={open} title={`Retard de ${studentName}`} onClose={onClose}>
      <div className="mb-3 flex flex-wrap gap-2">
        {[5, 10, 15, 20, 30].map((m) => (
          <Button key={m} type="button" variant="secondary" onClick={() => onPick(m)}>
            {m} min
          </Button>
        ))}
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          const m = Number(minutes);
          if (m > 0) onPick(m);
        }}
      >
        <Field label="Autre durée (minutes)" className="flex-1">
          <Input
            type="number"
            min={1}
            max={600}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            autoFocus
          />
        </Field>
        <Button type="submit">OK</Button>
        <Button type="button" variant="ghost" onClick={onPresent}>
          Présent
        </Button>
      </form>
      <p className="mt-3 text-xs text-slate-500">
        Au-delà du seuil de l&apos;établissement, un retard est compté comme une absence (durée
        conservée).
      </p>
    </Modal>
  );
}

// ----------------------------------------------------------------------------- feuille soumise
function SubmittedSheet({
  sheet,
  tz,
  onChanged,
}: {
  sheet: AttendanceSheet;
  tz: string | null;
  onChanged: (s?: AttendanceSheet) => Promise<unknown>;
}) {
  const can = useCan();
  const canEdit = can('EDIT_ATTENDANCE', 'EDIT_ATTENDANCE_LOCKED');
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [history, setHistory] = useState<AttendanceRecord | null>(null);
  const records = sheet.records ?? [];
  return (
    <>
      <Header
        sheet={sheet}
        tz={tz}
        right={
          <div className="flex items-center gap-2">
            <Badge tone={sheet.status === 'LOCKED' ? 'slate' : 'green'}>
              {sheet.status === 'LOCKED' ? 'Verrouillée' : 'Soumise'}
            </Badge>
            {sheet.submittedAt && (
              <span className="text-xs text-slate-500">
                le {fmtDateTime(sheet.submittedAt, tz)}
              </span>
            )}
          </div>
        }
      />
      {sheet.status === 'DRAFT' && (
        <div className="mb-3">
          <Alert tone="warning">
            Brouillon en cours : l&apos;appel n&apos;a pas encore été validé par l&apos;enseignant.
          </Alert>
        </div>
      )}
      <div className="mb-3 flex gap-2">
        <Badge tone="green">{sheet.counts?.present ?? 0} présents</Badge>
        <Badge tone="red">{sheet.counts?.absent ?? 0} absents</Badge>
        <Badge tone="amber">{sheet.counts?.late ?? 0} retards</Badge>
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {records.map((r) => (
          <li
            key={r.id}
            className={`flex items-center justify-between gap-2 px-3 py-2 ${r.status === 'ABSENT' ? 'bg-red-50/50' : r.status === 'LATE' ? 'bg-amber-50/50' : ''}`}
          >
            <span>
              <span className="font-medium">{r.student?.lastName}</span> {r.student?.firstName}
              {r.note && <span className="ml-2 text-xs text-slate-500">« {r.note} »</span>}
            </span>
            <span className="flex items-center gap-1">
              <StatusBadge status={r.status} excuse={r.excuseStatus} lateMinutes={r.lateMinutes} />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setHistory(r)}
                aria-label="Historique"
              >
                ↺
              </Button>
              {canEdit && sheet.status !== 'DRAFT' && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                  Corriger
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {editing && (
        <CorrectModal
          record={editing}
          onClose={() => setEditing(null)}
          onDone={async (s) => {
            await onChanged(s);
            setEditing(null);
          }}
        />
      )}
      {history && <RevisionsModal record={history} tz={tz} onClose={() => setHistory(null)} />}
    </>
  );
}

function CorrectModal({
  record: r,
  onClose,
  onDone,
}: {
  record: AttendanceRecord;
  onClose: () => void;
  onDone: (s: AttendanceSheet) => Promise<unknown>;
}) {
  const [status, setStatus] = useState<'PRESENT' | 'ABSENT' | 'LATE'>(r.status);
  const [lateMinutes, setLateMinutes] = useState(String(r.lateMinutes ?? 10));
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () =>
      attendance.correct(r.id, {
        status,
        lateMinutes: status === 'LATE' ? Number(lateMinutes) : null,
        reason,
      }),
    onSuccess: onDone,
  });
  return (
    <Modal
      open
      title={`Corriger — ${r.student?.lastName} ${r.student?.firstName}`}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Nouveau statut">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'PRESENT' | 'ABSENT' | 'LATE')}
          >
            <option value="PRESENT">Présent</option>
            <option value="ABSENT">Absent</option>
            <option value="LATE">Retard</option>
          </Select>
        </Field>
        {status === 'LATE' && (
          <Field label="Minutes de retard">
            <Input
              type="number"
              min={1}
              value={lateMinutes}
              onChange={(e) => setLateMinutes(e.target.value)}
            />
          </Field>
        )}
        <Field label="Motif (obligatoire, conservé dans l'historique)">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={3}
            required
          />
        </Field>
        <ErrorAlert error={m.error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={m.isPending || reason.trim().length < 3}>
            Corriger
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RevisionsModal({
  record: r,
  tz,
  onClose,
}: {
  record: AttendanceRecord;
  tz: string | null;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ['attendance', 'revisions', r.id],
    queryFn: () => attendance.revisions(r.id),
  });
  return (
    <Modal
      open
      title={`Historique — ${r.student?.lastName} ${r.student?.firstName}`}
      onClose={onClose}
    >
      {q.isPending && <Loading />}
      {q.data && q.data.length === 0 && (
        <p className="text-sm text-slate-500">Aucune correction.</p>
      )}
      <ul className="space-y-2 text-sm">
        {q.data?.map((rev) => (
          <li key={rev.id} className="rounded-md border border-slate-200 p-2">
            <p>
              <StatusBadge status={rev.beforeStatus} lateMinutes={rev.beforeLateMinutes} /> →{' '}
              <StatusBadge status={rev.afterStatus} lateMinutes={rev.afterLateMinutes} />
              {rev.outOfWindow && <Badge tone="amber">hors fenêtre</Badge>}
            </p>
            <p className="mt-1 text-slate-700">« {rev.reason} »</p>
            <p className="text-xs text-slate-500">
              {rev.authorName ?? 'Utilisateur'} · {fmtDateTime(rev.createdAt, tz)}
            </p>
          </li>
        ))}
      </ul>
      <Card className="mt-3">
        <p className="text-xs text-slate-500">
          Dernière mise à jour : {fmtDateTime(r.updatedAt, tz)}
        </p>
      </Card>
    </Modal>
  );
}
