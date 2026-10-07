'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  ErrorAlert,
  Field,
  Input,
  Loading,
  PageHeader,
} from '@/components/ui';
import { tenant } from '@/lib/resources';

/** Paramètres de l'établissement : règles d'assiduité (ADR-0006) et quota SMS. */
export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tenant'], queryFn: tenant.get });
  const [form, setForm] = useState({
    lateToAbsentMinutes: '30',
    correctionWindowHours: '48',
    guardianJustificationsEnabled: false,
    repeatedAbsenceThreshold: '3',
    repeatedAbsenceWindowDays: '30',
    smsMonthlyCap: '2000',
  });
  useEffect(() => {
    const a = q.data?.settings.attendance ?? {};
    const n = q.data?.settings.notifications ?? {};
    if (q.data)
      setForm({
        lateToAbsentMinutes: String(a.lateToAbsentMinutes ?? 30),
        correctionWindowHours: String(a.correctionWindowHours ?? 48),
        guardianJustificationsEnabled: a.guardianJustificationsEnabled ?? false,
        repeatedAbsenceThreshold: String(a.repeatedAbsenceThreshold ?? 3),
        repeatedAbsenceWindowDays: String(a.repeatedAbsenceWindowDays ?? 30),
        smsMonthlyCap: String(n.smsMonthlyCap ?? 2000),
      });
  }, [q.data]);
  const m = useMutation({
    mutationFn: () =>
      tenant.updateSettings({
        attendance: {
          lateToAbsentMinutes: Number(form.lateToAbsentMinutes),
          correctionWindowHours: Number(form.correctionWindowHours),
          guardianJustificationsEnabled: form.guardianJustificationsEnabled,
          repeatedAbsenceThreshold: Number(form.repeatedAbsenceThreshold),
          repeatedAbsenceWindowDays: Number(form.repeatedAbsenceWindowDays),
        },
        notifications: { smsMonthlyCap: Number(form.smsMonthlyCap) },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant'] }),
  });
  return (
    <>
      <PageHeader
        title="Paramètres"
        subtitle={q.data ? `${q.data.name} · fuseau ${q.data.timezone}` : undefined}
      />
      {q.isPending && <Loading />}
      {q.isError && <ErrorAlert error={q.error} />}
      {q.data && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            m.mutate();
          }}
          className="grid gap-4 lg:grid-cols-2"
        >
          <Card title="Règles d'assiduité">
            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label="Retard compté absent à partir de (min)"
                hint="Au-delà, l'élève est absent ; la durée du retard est conservée."
              >
                <Input
                  type="number"
                  min={1}
                  max={240}
                  value={form.lateToAbsentMinutes}
                  onChange={(e) => setForm({ ...form, lateToAbsentMinutes: e.target.value })}
                />
              </Field>
              <Field
                label="Fenêtre de correction (heures)"
                hint="Après ce délai, seule la vie scolaire corrige."
              >
                <Input
                  type="number"
                  min={0}
                  max={720}
                  value={form.correctionWindowHours}
                  onChange={(e) => setForm({ ...form, correctionWindowHours: e.target.value })}
                />
              </Field>
              <Field label="Seuil d'alerte (absences non justifiées)">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={form.repeatedAbsenceThreshold}
                  onChange={(e) => setForm({ ...form, repeatedAbsenceThreshold: e.target.value })}
                />
              </Field>
              <Field label="Sur une fenêtre de (jours)">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={form.repeatedAbsenceWindowDays}
                  onChange={(e) => setForm({ ...form, repeatedAbsenceWindowDays: e.target.value })}
                />
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.guardianJustificationsEnabled}
                onChange={(e) =>
                  setForm({ ...form, guardianJustificationsEnabled: e.target.checked })
                }
              />
              Les parents autorisés peuvent déposer un justificatif depuis leur espace
            </label>
          </Card>
          <Card title="Notifications">
            <Field
              label="Plafond SMS mensuel"
              hint="Au-delà, les SMS sont suspendus (les notifications in-app restent). Alerte à 80 %."
            >
              <Input
                type="number"
                min={0}
                value={form.smsMonthlyCap}
                onChange={(e) => setForm({ ...form, smsMonthlyCap: e.target.value })}
              />
            </Field>
          </Card>
          <div className="lg:col-span-2">
            <ErrorAlert error={m.error} />
            {m.isSuccess && (
              <Alert tone="success">Paramètres enregistrés (journalisés dans l&apos;audit).</Alert>
            )}
            <div className="mt-3">
              <Button type="submit" disabled={m.isPending}>
                Enregistrer
              </Button>
            </div>
          </div>
        </form>
      )}
    </>
  );
}
