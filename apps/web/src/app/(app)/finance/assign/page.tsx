'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { AssignmentReport } from '@polaris/contracts';
import {
  Alert,
  Button,
  Card,
  ErrorAlert,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
} from '@/components/ui';
import { fmtXof, todayIso } from '@/lib/format';
import { billing, groups, programs } from '@/lib/resources';

/**
 * Affectation de masse : une grille → les élèves inscrits (classes, niveaux ou cible de la grille) à une date.
 * Idempotente : un second passage ne crée rien pour ceux qui ont déjà la créance.
 */
export default function AssignFeesPage() {
  const structures = useQuery({
    queryKey: ['billing', 'structures', 'active'],
    queryFn: () => billing.structures({ status: 'ACTIVE' }),
  });
  const progs = useQuery({ queryKey: ['programs'], queryFn: programs.list });
  const grps = useQuery({
    queryKey: ['groups', 'CLASS'],
    queryFn: () => groups.list({ kind: 'CLASS' }),
  });
  const [structureId, setStructureId] = useState('');
  const [mode, setMode] = useState<'structure' | 'custom'>('structure');
  const [levelIds, setLevelIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [asOf, setAsOf] = useState(todayIso());
  const [report, setReport] = useState<AssignmentReport | null>(null);
  const structure = structures.data?.find((s) => s.id === structureId);
  const toggle = (set: (f: (v: string[]) => string[]) => void, id: string) =>
    set((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  const m = useMutation({
    mutationFn: () =>
      billing.assign({
        feeStructureId: structureId,
        asOf,
        target:
          mode === 'structure'
            ? { useStructureTarget: true }
            : { useStructureTarget: false, levelIds, groupIds },
      }),
    onSuccess: setReport,
  });
  const structureHasTarget =
    structure &&
    structure.appliesTo.levelIds.length +
      structure.appliesTo.groupIds.length +
      structure.appliesTo.programIds.length >
      0;
  const ready =
    Boolean(structureId) &&
    (mode === 'structure' ? Boolean(structureHasTarget) : levelIds.length + groupIds.length > 0);

  return (
    <>
      <PageHeader
        title="Affecter des frais"
        subtitle="Crée la créance (copie figée de l'échéancier) pour chaque élève ciblé qui ne l'a pas encore."
      />
      {structures.isPending && <Loading />}
      <ErrorAlert error={structures.error} />
      {structures.data && structures.data.length === 0 && (
        <Alert tone="warning">
          Aucune grille active pour l&apos;année courante.{' '}
          <Link href="/finance/catalog" className="underline">
            Créer une grille →
          </Link>
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Grille et cible" className="lg:col-span-2">
          <form
            className="space-y-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (ready) m.mutate();
            }}
          >
            <Field label="Grille de frais">
              <Select
                value={structureId}
                onChange={(e) => {
                  setStructureId(e.target.value);
                  setReport(null);
                }}
                required
              >
                <option value="">Choisir…</option>
                {structures.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {fmtXof(s.totalAmount)} ({s.schedule.length} tranche
                    {s.schedule.length > 1 ? 's' : ''})
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset className="space-y-2 text-sm">
              <legend className="font-medium text-slate-700">Élèves ciblés</legend>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'structure'}
                  onChange={() => setMode('structure')}
                  disabled={!structureHasTarget}
                />
                <span>
                  La cible par défaut de la grille
                  {structure && !structureHasTarget && (
                    <span className="text-slate-500"> (aucune définie sur cette grille)</span>
                  )}
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'custom'}
                  onChange={() => setMode('custom')}
                />
                <span>Choisir des niveaux et/ou des classes</span>
              </label>
              {mode === 'custom' && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-slate-200 p-2">
                    <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Niveaux</p>
                    <div className="flex flex-wrap gap-2">
                      {progs.data?.flatMap((p) =>
                        (p.levels ?? []).map((l) => (
                          <label key={l.id} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={levelIds.includes(l.id)}
                              onChange={() => toggle(setLevelIds, l.id)}
                            />
                            {l.name}
                          </label>
                        )),
                      )}
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-200 p-2">
                    <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Classes</p>
                    <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                      {grps.data?.map((g) => (
                        <label key={g.id} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={groupIds.includes(g.id)}
                            onChange={() => toggle(setGroupIds, g.id)}
                          />
                          {g.name}
                          <span className="text-xs text-slate-400">({g.studentCount ?? 0})</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </fieldset>
            <Field
              label="Inscriptions actives au"
              hint="Les élèves inscrits dans la cible à cette date reçoivent la créance."
              className="w-56"
            >
              <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} required />
            </Field>
            <ErrorAlert error={m.error} />
            <Button type="submit" disabled={!ready || m.isPending}>
              {m.isPending ? 'Affectation…' : 'Affecter'}
            </Button>
          </form>
        </Card>
        <div className="space-y-4">
          {structure && (
            <Card title="Échéancier qui sera copié">
              <ul className="space-y-1 text-sm">
                {structure.schedule.map((i) => (
                  <li key={i.seq} className="flex justify-between">
                    <span>
                      {i.seq}. {i.label} <span className="text-slate-500">({i.dueDate})</span>
                    </span>
                    <span className="tabular-nums">{fmtXof(i.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">
                Déjà {structure.assignedCount ?? 0} créance(s) sur cette grille.
              </p>
            </Card>
          )}
          {report && (
            <Alert tone="success">
              <p className="font-medium">Affectation terminée</p>
              <ul className="mt-1 text-sm">
                <li>{report.targeted} élève(s) ciblé(s)</li>
                <li>{report.created} créance(s) créée(s)</li>
                <li>{report.skipped} déjà existante(s), ignorée(s)</li>
                {report.creditsApplied > 0 && (
                  <li>{report.creditsApplied} crédit(s) imputé(s) automatiquement</li>
                )}
              </ul>
              <p className="mt-2 text-sm">
                <Link href="/finance/unpaid" className="underline">
                  Voir les échéances →
                </Link>
              </p>
            </Alert>
          )}
        </div>
      </div>
    </>
  );
}
