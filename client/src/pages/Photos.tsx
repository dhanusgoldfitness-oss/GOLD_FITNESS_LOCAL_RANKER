import { ImageOff } from 'lucide-react';
import { Badge, EmptyState, ErrorBox, LocationPicker, NoLocations, PageHeader, PageLoading, StatCard, useApi, useLocations } from '../components/ui';

interface Media { name: string; googleUrl?: string; thumbnailUrl?: string; mediaFormat?: string; locationAssociation?: { category?: string }; createTime?: string }

export default function Photos() {
  const L = useLocations();
  const m = useApi<{ items: Media[]; total: number }>(L.selected ? `/locations/${L.selected}/media` : null, [L.selected]);
  if (L.loading) return <PageLoading />;
  if (!L.enabled.length) return <><PageHeader title="Photos & Videos" /><NoLocations /></>;
  const items = m.data?.items ?? [];
  const photos = items.filter((i) => i.mediaFormat !== 'VIDEO');
  return (
    <>
      <PageHeader title="Photos & Videos" subtitle="Media currently on your Google Business Profile (read-only)." />
      <div className="mb-6 max-w-md"><LocationPicker enabled={L.enabled} selected={L.selected} setSelected={L.setSelected} /></div>
      {m.loading ? <PageLoading /> : m.error ? <ErrorBox error={m.error} onRetry={m.reload} /> : !items.length ? <EmptyState title="No media returned" text="Google returned no media for this location." /> : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3"><StatCard label="Total media" value={m.data?.total ?? items.length} /><StatCard label="Photos" value={photos.length} /><StatCard label="Videos" value={items.length - photos.length} /></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {items.map((i) => (
              <a key={i.name} href={i.googleUrl} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded-xl bg-slate-500/20">
                {i.thumbnailUrl || i.googleUrl ? <img src={i.thumbnailUrl ?? i.googleUrl} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" /> : <ImageOff className="m-auto h-full text-slate-500" />}
                <span className="absolute bottom-1 left-1"><Badge>{i.locationAssociation?.category ?? i.mediaFormat ?? 'MEDIA'}</Badge></span>
              </a>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">Uploading and replacing media arrives with the media-management phase; nothing here changes your live profile.</p>
        </>
      )}
    </>
  );
}
