/** Pure geo-grid maths (unit-tested). */
export interface GridPoint { idx: number; lat: number; lng: number }

const KM_PER_DEG_LAT = 110.574;

/** Square grid of size n x n centred on (lat,lng); `radiusKm` = distance from centre to the outer row/column. */
export function makeGrid(lat: number, lng: number, n: number, radiusKm: number): GridPoint[] {
  if (![3, 5, 7].includes(n)) throw new Error('grid size must be 3, 5 or 7');
  const kmPerDegLng = 111.320 * Math.cos((lat * Math.PI) / 180);
  const step = n === 1 ? 0 : (2 * radiusKm) / (n - 1);
  const pts: GridPoint[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const dy = (r - (n - 1) / 2) * step;      // km north (+) / south (-)
      const dx = (c - (n - 1) / 2) * step;      // km east (+) / west (-)
      pts.push({ idx: r * n + c, lat: +(lat - dy / KM_PER_DEG_LAT).toFixed(6), lng: +(lng + dx / kmPerDegLng).toFixed(6) });
    }
  }
  return pts;
}

/** Rank movement: positive = improved (moved up). null when either side is unknown. */
export function rankChange(previous: number | null | undefined, current: number | null | undefined): number | null {
  if (previous == null || current == null) return null;
  return previous - current;
}

export function bandOf(rank: number | null): 'top3' | 'top10' | 'top20' | 'low' | 'none' {
  if (rank == null) return 'none';
  return rank <= 3 ? 'top3' : rank <= 10 ? 'top10' : rank <= 20 ? 'top20' : 'low';
}
