import { config, configured } from '../config.js';
import { ApiError } from './errors.js';

export interface PlaceHit { id: string; name: string; address?: string; rating?: number; reviews?: number; type?: string }

/** Google Places API (New) Text Search, biased to a point. Returns results in Google's ranking order. */
export async function searchPlaces(query: string, lat: number, lng: number, radiusM = 3000, max = 20): Promise<PlaceHit[]> {
  if (!configured.maps) throw new ApiError(503, 'NOT_CONNECTED', 'Google Maps Platform key (GOOGLE_MAPS_API_KEY) is not configured on the server.');
  let r: Response;
  try {
    r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'X-Goog-Api-Key': config.GOOGLE_MAPS_API_KEY!,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.primaryType',
      },
      body: JSON.stringify({ textQuery: query, pageSize: max, locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } } }),
    });
  } catch { throw new ApiError(503, 'OFFLINE', 'Could not reach Google Maps Platform.'); }
  if (r.status === 429) throw new ApiError(429, 'RATE_LIMITED', 'Google Maps quota exceeded.');
  if (r.status === 401 || r.status === 403) throw new ApiError(403, 'API_PENDING', 'Google Maps key rejected. Enable Places API (New) and billing for the key.');
  if (!r.ok) throw new ApiError(502, 'UPSTREAM', `Places search failed (${r.status}).`);
  const j: any = await r.json();
  return (j.places ?? []).map((p: any) => ({ id: p.id, name: p.displayName?.text ?? '', address: p.formattedAddress, rating: p.rating, reviews: p.userRatingCount, type: p.primaryType }));
}

/** 1-based rank of `placeId` in the ordered hits, or null if absent. */
export const rankOf = (hits: PlaceHit[], placeId: string): number | null => {
  const i = hits.findIndex((h) => h.id === placeId);
  return i < 0 ? null : i + 1;
};

export async function placeDetails(placeId: string): Promise<{ lat?: number; lng?: number; rating?: number; reviews?: number; type?: string; name?: string; address?: string }> {
  if (!configured.maps) throw new ApiError(503, 'NOT_CONNECTED', 'Google Maps Platform key is not configured.');
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': config.GOOGLE_MAPS_API_KEY!, 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,rating,userRatingCount,primaryType' },
  }).catch(() => { throw new ApiError(503, 'OFFLINE', 'Could not reach Google Maps Platform.'); });
  if (!r.ok) throw new ApiError(r.status === 403 ? 403 : 502, r.status === 403 ? 'API_PENDING' : 'UPSTREAM', `Place lookup failed (${r.status}).`);
  const j: any = await r.json();
  return { lat: j.location?.latitude, lng: j.location?.longitude, rating: j.rating, reviews: j.userRatingCount, type: j.primaryType, name: j.displayName?.text, address: j.formattedAddress };
}
