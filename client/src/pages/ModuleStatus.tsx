import { Hammer } from 'lucide-react';
import { Badge, ErrorBox, PageHeader, PageLoading, useApi } from '../components/ui';

/** Honest placeholder for modules whose backend is not built/connected yet. Shows the real status from the API — no fake data. */
export default function ModuleStatus({ moduleKey, title, description }: { moduleKey: string; title: string; description: string }) {
  const s = useApi<Record<string, { status: string; phase: string; note: string }>>('/modules/status');
  if (s.loading) return <PageLoading />;
  if (s.error) return <><PageHeader title={title} subtitle={description} /><ErrorBox error={s.error} onRetry={s.reload} /></>;
  const m = s.data?.[moduleKey];
  return (
    <>
      <PageHeader title={title} subtitle={description} />
      <div className="card flex flex-col items-center py-14 text-center"><Hammer className="mb-3 text-gold-500" size={32} />
        <Badge kind={m?.status ?? 'API_PENDING'} />
        <p className="mt-3 max-w-md text-sm">{m?.note ?? 'This module is not available yet.'}</p>
        <p className="mt-1 text-xs text-slate-500">Scheduled: {m?.phase ?? 'later phase'} of the DGF Local Ranker build plan.</p></div>
    </>
  );
}
