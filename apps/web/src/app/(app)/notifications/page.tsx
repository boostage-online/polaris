'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorAlert, Loading, PageHeader } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { notifs } from '@/lib/resources';

/** Boîte de réception in-app : la même information que le SMS, toujours disponible. */
export default function NotificationsPage() {
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const q = useQuery({
    queryKey: ['notifications', 'inbox', unreadOnly],
    queryFn: () => notifs.inbox({ unread: unreadOnly || undefined, limit: 100 }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readOne = useMutation({ mutationFn: (id: string) => notifs.read(id), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => notifs.readAll(), onSuccess: refresh });
  return (
    <>
      <PageHeader
        title="Mes notifications"
        subtitle={q.data ? `${q.data.meta.unread} non lue(s)` : undefined}
        actions={
          <>
            <Button
              size="sm"
              variant={unreadOnly ? 'primary' : 'secondary'}
              onClick={() => setUnreadOnly((v) => !v)}
            >
              Non lues
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={readAll.isPending || !q.data?.meta.unread}
              onClick={() => readAll.mutate()}
            >
              Tout marquer lu
            </Button>
            <Link href="/notifications/preferences">
              <Button size="sm" variant="ghost">
                Préférences
              </Button>
            </Link>
          </>
        }
      />
      {q.isPending && <Loading />}
      {q.isError && <ErrorAlert error={q.error} />}
      {q.data && q.data.data.length === 0 && <Empty>Aucune notification.</Empty>}
      <ul className="space-y-2">
        {q.data?.data.map((n) => (
          <li key={n.id}>
            <Card className={n.readAt ? 'opacity-70' : 'border-[var(--color-brand)]/40'}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {n.title}
                    {!n.readAt && <Badge tone="blue">nouveau</Badge>}
                  </p>
                  <p className="text-sm text-slate-700">{n.body}</p>
                  <p className="mt-1 text-xs text-slate-500">{fmtDateTime(n.createdAt)}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {n.actionUrl && (
                    <Link
                      href={n.actionUrl}
                      onClick={() => {
                        if (!n.readAt) readOne.mutate(n.id);
                      }}
                    >
                      <Button size="sm" variant="secondary">
                        Ouvrir
                      </Button>
                    </Link>
                  )}
                  {!n.readAt && (
                    <Button size="sm" variant="ghost" onClick={() => readOne.mutate(n.id)}>
                      Lu
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
