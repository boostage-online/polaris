'use client';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { useMe } from '@/components/app-shell';
import {
  Button,
  Card,
  Empty,
  ErrorAlert,
  Field,
  Input,
  Loading,
  PageHeader,
  Table,
} from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { audit } from '@/lib/resources';

/** Journal d'audit de l'établissement (append-only) : qui a fait quoi, quand, sur quoi ; filtres et curseur. */
export default function AuditPage() {
  const me = useMe();
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [stack, setStack] = useState<string[]>([]);
  const q = useQuery({
    queryKey: ['audit', { entityType, entityId, from, to, cursor }],
    queryFn: () =>
      audit.list({
        limit: 50,
        cursor,
        entityType: entityType || undefined,
        entityId: entityId || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      }),
    placeholderData: (prev) => prev,
  });
  const [open, setOpen] = useState<string | null>(null);
  const reset = () => {
    setCursor(undefined);
    setStack([]);
  };
  return (
    <>
      <PageHeader
        title="Journal d'audit"
        subtitle="Chaque action sensible est enregistrée avec son auteur, l'adresse IP et l'état avant/après. Les actions du support plateforme sont marquées."
      />
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Type d'objet">
            <Input
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                reset();
              }}
              placeholder="Student, Payment, Role…"
            />
          </Field>
          <Field label="Identifiant">
            <Input
              value={entityId}
              onChange={(e) => {
                setEntityId(e.target.value);
                reset();
              }}
              placeholder="uuid"
            />
          </Field>
          <Field label="Du">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                reset();
              }}
            />
          </Field>
          <Field label="Au">
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                reset();
              }}
            />
          </Field>
        </div>
      </Card>
      <Card>
        {q.isPending && <Loading />}
        <ErrorAlert error={q.error} />
        {q.data &&
          (q.data.data.length === 0 ? (
            <Empty>Aucune entrée.</Empty>
          ) : (
            <>
              <Table
                head={
                  <>
                    <th>Quand</th>
                    <th>Action</th>
                    <th>Objet</th>
                    <th>Acteur</th>
                    <th>IP</th>
                    <th></th>
                  </>
                }
              >
                {q.data.data.map((e) => (
                  <Fragment key={e.id}>
                    <tr>
                      <td className="whitespace-nowrap text-xs text-slate-500">
                        {fmtDateTime(e.occurredAt, me.tenantTimezone)}
                      </td>
                      <td className="font-mono text-xs">{e.action}</td>
                      <td className="text-xs">
                        {e.entityType}{' '}
                        {e.entityId && (
                          <span className="text-slate-400">{e.entityId.slice(0, 8)}</span>
                        )}
                      </td>
                      <td className="text-xs">
                        {e.actorUserId ? e.actorUserId.slice(0, 8) : 'système'}
                      </td>
                      <td className="text-xs text-slate-500">{e.ip ?? '—'}</td>
                      <td className="text-right">
                        {(e.before !== null || e.after !== null) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setOpen(open === e.id ? null : e.id)}
                          >
                            {open === e.id ? 'Masquer' : 'Détail'}
                          </Button>
                        )}
                      </td>
                    </tr>
                    {open === e.id && (
                      <tr>
                        <td colSpan={6}>
                          <div className="grid gap-2 md:grid-cols-2">
                            <pre className="overflow-auto rounded bg-slate-50 p-2 text-xs">
                              {`avant\n${JSON.stringify(e.before, null, 2)}`}
                            </pre>
                            <pre className="overflow-auto rounded bg-slate-50 p-2 text-xs">
                              {`après\n${JSON.stringify(e.after, null, 2)}`}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </Table>
              <div className="mt-3 flex justify-between">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={stack.length === 0}
                  onClick={() => {
                    const prev = [...stack];
                    const last = prev.pop();
                    setStack(prev);
                    setCursor(last === '' ? undefined : last);
                  }}
                >
                  Précédent
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!q.data.meta.nextCursor}
                  onClick={() => {
                    setStack([...stack, cursor ?? '']);
                    setCursor(q.data.meta.nextCursor ?? undefined);
                  }}
                >
                  Suivant
                </Button>
              </div>
            </>
          ))}
      </Card>
    </>
  );
}
