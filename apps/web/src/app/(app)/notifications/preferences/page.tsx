'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationChannel, NotificationKind } from '@polaris/contracts';
import { useMe } from '@/components/app-shell';
import { Alert, Button, Card, ErrorAlert, Loading, PageHeader, Table } from '@/components/ui';
import { notifs } from '@/lib/resources';

const KINDS: { kind: NotificationKind; label: string; guardian: boolean }[] = [
  { kind: 'STUDENT_ABSENT', label: 'Absence de mon enfant', guardian: true },
  { kind: 'STUDENT_LATE', label: 'Retard de mon enfant', guardian: true },
  { kind: 'JUSTIFICATION_REVIEWED', label: 'Décision sur un justificatif', guardian: true },
  { kind: 'REPEATED_ABSENCES', label: 'Absences répétées', guardian: true },
  { kind: 'JUSTIFICATION_SUBMITTED', label: 'Justificatif déposé par un parent', guardian: false },
  { kind: 'ATTENDANCE_SHEET_MISSING', label: 'Appel non fait', guardian: false },
  { kind: 'SMS_CAP_WARNING', label: 'Quota SMS', guardian: false },
];
const CHANNELS: { id: NotificationChannel; label: string }[] = [
  { id: 'SMS', label: 'SMS' },
  { id: 'EMAIL', label: 'E-mail' },
  { id: 'INAPP', label: 'Dans l’application' },
];

/** Choix des canaux par type ; l'in-app reste toujours actif. */
export default function PreferencesPage() {
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications', 'preferences'], queryFn: notifs.preferences });
  const m = useMutation({
    mutationFn: (p: Partial<Record<NotificationKind, NotificationChannel[]>>) =>
      notifs.setPreferences(p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', 'preferences'] }),
  });
  const isGuardian = me.membership?.kind === 'GUARDIAN';
  const rows = KINDS.filter((k) => (isGuardian ? k.guardian : true));
  const toggle = (kind: NotificationKind, channel: NotificationChannel) => {
    const current = q.data?.preferences[kind] ?? [];
    const next = current.includes(channel)
      ? current.filter((c) => c !== channel)
      : [...current, channel];
    m.mutate({ [kind]: next });
  };
  return (
    <>
      <PageHeader
        title="Préférences de notification"
        subtitle="Les notifications dans l'application sont toujours conservées."
      />
      {q.isPending && <Loading />}
      {q.isError && <ErrorAlert error={q.error} />}
      <ErrorAlert error={m.error} />
      {q.data && (
        <Card>
          <Table
            head={
              <>
                <th>Événement</th>
                {CHANNELS.map((c) => (
                  <th key={c.id}>{c.label}</th>
                ))}
              </>
            }
          >
            {rows.map((k) => (
              <tr key={k.kind}>
                <td>{k.label}</td>
                {CHANNELS.map((c) => (
                  <td key={c.id}>
                    <input
                      type="checkbox"
                      disabled={
                        c.id === 'INAPP' ||
                        m.isPending ||
                        (c.id === 'EMAIL' && !me.user.email) ||
                        (c.id === 'SMS' && !me.user.phone)
                      }
                      checked={
                        c.id === 'INAPP' || (q.data.preferences[k.kind] ?? []).includes(c.id)
                      }
                      onChange={() => toggle(k.kind, c.id)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </Table>
          <div className="mt-3">
            <Alert tone="info">
              SMS possible si un téléphone est associé à votre compte ; e-mail si une adresse
              l&apos;est.{' '}
              <Button size="sm" variant="ghost" onClick={() => history.back()}>
                Retour
              </Button>
            </Alert>
          </div>
        </Card>
      )}
    </>
  );
}
