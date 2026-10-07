'use client';
import type { ReactNode } from 'react';
import { Input, Select } from '@/components/ui';
import { addDaysIso, fmtDateTime, todayIso } from '@/lib/format';

/** Briques des tableaux de bord (Phase 6) : pourcentages, barres, tendances, filtre de période. */

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${v} %`;
}

/** Couleur d'un taux de présence : vert ≥ 90, ambre ≥ 75, rouge en dessous. */
export function rateTone(v: number | null | undefined): 'green' | 'amber' | 'red' | 'slate' {
  if (v === null || v === undefined) return 'slate';
  if (v >= 90) return 'green';
  if (v >= 75) return 'amber';
  return 'red';
}

const BAR_COLORS = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  slate: 'bg-slate-300',
  brand: 'bg-[var(--color-brand)]',
  blue: 'bg-sky-500',
};

/** Barre horizontale 0–100 (ou 0–max) ; accessible via `title`. */
export function Bar({
  value,
  max = 100,
  tone = 'brand',
  label,
}: {
  value: number | null;
  max?: number;
  tone?: keyof typeof BAR_COLORS;
  label?: string;
}) {
  const w = value === null || max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded bg-slate-100"
      title={label ?? (value === null ? '—' : String(value))}
      role="img"
      aria-label={label ?? (value === null ? 'Aucune donnée' : `${value} sur ${max}`)}
    >
      <div className={`h-full ${BAR_COLORS[tone]}`} style={{ width: `${w}%` }} />
    </div>
  );
}

/** Mini-graphique en barres verticales (tendance hebdomadaire). */
export function TrendBars({
  points,
  format = (v) => String(v),
  tone = 'brand',
  height = 72,
}: {
  points: { label: string; value: number | null }[];
  format?: (v: number) => string;
  tone?: keyof typeof BAR_COLORS;
  height?: number;
}) {
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const max = Math.max(1, ...values);
  if (points.length === 0) return <p className="text-sm text-slate-500">Aucune donnée.</p>;
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {points.map((p, i) => {
        const h = p.value === null ? 0 : Math.max(2, (p.value / max) * (height - 18));
        return (
          <div key={`${p.label}-${i}`} className="flex flex-1 flex-col items-center justify-end">
            <div
              className={`w-full rounded-t ${p.value === null ? 'bg-slate-200' : BAR_COLORS[tone]}`}
              style={{ height: h }}
              title={`${p.label} : ${p.value === null ? '—' : format(p.value)}`}
            />
            <span className="mt-1 truncate text-[10px] text-slate-500">{p.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Variation entre deux valeurs (points ou %), avec flèche. */
export function Delta({
  current,
  previous,
  unit = 'pt',
  higherIsBetter = true,
}: {
  current: number | null;
  previous: number | null;
  unit?: string;
  higherIsBetter?: boolean;
}) {
  if (current === null || previous === null) return null;
  const d = current - previous;
  if (d === 0) return <span className="text-xs text-slate-500">= période précédente</span>;
  const good = higherIsBetter ? d > 0 : d < 0;
  return (
    <span className={`text-xs ${good ? 'text-emerald-700' : 'text-red-700'}`}>
      {d > 0 ? '▲' : '▼'} {Math.abs(d).toLocaleString('fr-FR')} {unit} vs période précédente
    </span>
  );
}

export function PRESETS(): { id: string; label: string; from: string; to: string }[] {
  const today = todayIso();
  return [
    { id: '7', label: '7 jours', from: addDaysIso(today, -6), to: today },
    { id: '30', label: '30 jours', from: addDaysIso(today, -29), to: today },
    { id: '90', label: '90 jours', from: addDaysIso(today, -89), to: today },
  ];
}

/** Filtre de période (préréglages + dates libres). */
export function PeriodFilter({
  value,
  onChange,
  children,
}: {
  value: { from: string; to: string };
  onChange: (v: { from: string; to: string }) => void;
  children?: ReactNode;
}) {
  const presets = PRESETS();
  const active = presets.find((p) => p.from === value.from && p.to === value.to)?.id ?? 'custom';
  return (
    <div className="mb-4 flex flex-wrap items-end gap-2">
      <div className="w-40">
        <Select
          value={active}
          onChange={(e) => {
            const p = presets.find((x) => x.id === e.target.value);
            if (p) onChange({ from: p.from, to: p.to });
          }}
          aria-label="Période"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Personnalisée</option>
        </Select>
      </div>
      <div className="w-40">
        <Input
          type="date"
          value={value.from}
          max={value.to}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          aria-label="Du"
        />
      </div>
      <span className="pb-2 text-sm text-slate-500">au</span>
      <div className="w-40">
        <Input
          type="date"
          value={value.to}
          min={value.from}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          aria-label="Au"
        />
      </div>
      {children}
    </div>
  );
}

export function RefreshedAt({ at }: { at: string | null }) {
  return (
    <span className="text-xs text-slate-500">
      {at ? `Agrégats rafraîchis le ${fmtDateTime(at)}` : 'Agrégats jamais rafraîchis'}
    </span>
  );
}

/** Tableau clé/valeur compact pour les écrans de traçabilité. */
export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="break-words">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
