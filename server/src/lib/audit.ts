/**
 * DigiMithra's own transparent Business Profile completeness score (0-100).
 * This is NOT a Google-provided score. Pure + deterministic: same input => same output.
 */
export const RULES_VERSION = 'dgf-audit-1.0';

export interface AuditInput {
  title?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  primaryCategory?: string | null;
  additionalCategories?: number;
  description?: string | null;
  hasHours?: boolean;
  serviceCount?: number;
  photoCount?: number | null;     // null = unknown (API not available)
  reviewCount?: number | null;
  unansweredReviews?: number | null;
  avgRating?: number | null;
  postsLast30d?: number | null;
}

export interface Rule { key: string; label: string; group: 'Profile Completeness' | 'Media' | 'Customer Engagement' | 'Activity'; max: number; }
export interface RuleResult extends Rule { earned: number; known: boolean; detail: string; priority: 'high' | 'medium' | 'low'; action: string; }

const has = (s?: string | null) => !!s && s.trim().length > 0;

export const RULES: Rule[] = [
  { key: 'title', label: 'Business name', group: 'Profile Completeness', max: 5 },
  { key: 'phone', label: 'Phone number', group: 'Profile Completeness', max: 5 },
  { key: 'website', label: 'Website', group: 'Profile Completeness', max: 5 },
  { key: 'address', label: 'Address', group: 'Profile Completeness', max: 5 },
  { key: 'category', label: 'Primary category', group: 'Profile Completeness', max: 8 },
  { key: 'extra_categories', label: 'Additional categories (2+)', group: 'Profile Completeness', max: 4 },
  { key: 'description', label: 'Description (250+ chars)', group: 'Profile Completeness', max: 10 },
  { key: 'hours', label: 'Opening hours', group: 'Profile Completeness', max: 8 },
  { key: 'services', label: 'Services listed (5+)', group: 'Profile Completeness', max: 8 },
  { key: 'photos', label: 'Photos (25+)', group: 'Media', max: 12 },
  { key: 'reviews', label: 'Review volume (25+)', group: 'Customer Engagement', max: 8 },
  { key: 'rating', label: 'Average rating (4.0+)', group: 'Customer Engagement', max: 5 },
  { key: 'replies', label: 'Reviews answered', group: 'Customer Engagement', max: 7 },
  { key: 'posts', label: 'Posts in last 30 days (4+)', group: 'Activity', max: 10 },
];

function scale(value: number, target: number, max: number) { return Math.round(Math.min(1, value / target) * max); }

export function runAudit(i: AuditInput) {
  const out: RuleResult[] = RULES.map((r) => {
    let earned = 0, known = true, detail = '', action = '';
    switch (r.key) {
      case 'title': earned = has(i.title) ? r.max : 0; detail = earned ? 'Present' : 'Missing'; action = 'Add your business name exactly as it appears in real life.'; break;
      case 'phone': earned = has(i.phone) ? r.max : 0; detail = earned ? 'Present' : 'Missing'; action = 'Add a primary phone number.'; break;
      case 'website': earned = has(i.website) ? r.max : 0; detail = earned ? 'Present' : 'Missing'; action = 'Add your website or booking link.'; break;
      case 'address': earned = has(i.address) ? r.max : 0; detail = earned ? 'Present' : 'Missing'; action = 'Add your full street address.'; break;
      case 'category': earned = has(i.primaryCategory) ? r.max : 0; detail = i.primaryCategory ?? 'Missing'; action = 'Choose the most specific primary category.'; break;
      case 'extra_categories': { const n = i.additionalCategories ?? 0; earned = scale(n, 2, r.max); detail = `${n} additional`; action = 'Add up to 2+ relevant secondary categories.'; break; }
      case 'description': { const n = (i.description ?? '').trim().length; earned = scale(n, 250, r.max); detail = `${n} characters`; action = 'Write a 250+ character description with services and location keywords.'; break; }
      case 'hours': earned = i.hasHours ? r.max : 0; detail = i.hasHours ? 'Set' : 'Not set'; action = 'Set regular opening hours.'; break;
      case 'services': { const n = i.serviceCount ?? 0; earned = scale(n, 5, r.max); detail = `${n} listed`; action = 'List at least 5 services.'; break; }
      case 'photos': if (i.photoCount == null) { known = false; detail = 'Photo count unavailable from API'; action = 'Connect media access to score this.'; } else { earned = scale(i.photoCount, 25, r.max); detail = `${i.photoCount} photos`; action = 'Upload interior, exterior, equipment and team photos.'; } break;
      case 'reviews': if (i.reviewCount == null) { known = false; detail = 'Sync reviews to score'; action = 'Sync reviews.'; } else { earned = scale(i.reviewCount, 25, r.max); detail = `${i.reviewCount} reviews`; action = 'Ask happy members to leave a Google review.'; } break;
      case 'rating': if (i.avgRating == null) { known = false; detail = 'Sync reviews to score'; action = 'Sync reviews.'; } else { earned = i.avgRating >= 4 ? r.max : i.avgRating >= 3.5 ? Math.round(r.max * 0.6) : Math.round(r.max * 0.2); detail = `${i.avgRating.toFixed(1)} / 5`; action = 'Resolve negative feedback and ask satisfied members for reviews.'; } break;
      case 'replies': if (i.reviewCount == null || i.unansweredReviews == null) { known = false; detail = 'Sync reviews to score'; action = 'Sync reviews.'; } else { const rate = i.reviewCount === 0 ? 1 : 1 - i.unansweredReviews / i.reviewCount; earned = Math.round(rate * r.max); detail = `${i.unansweredReviews} unanswered`; action = 'Reply to unanswered reviews.'; } break;
      case 'posts': if (i.postsLast30d == null) { known = false; detail = 'Posts unavailable'; action = 'Publish weekly posts.'; } else { earned = scale(i.postsLast30d, 4, r.max); detail = `${i.postsLast30d} in 30 days`; action = 'Publish at least one post per week.'; } break;
    }
    const missing = r.max - earned;
    const priority = missing >= 8 ? 'high' : missing >= 4 ? 'medium' : 'low';
    return { ...r, earned, known, detail, action, priority };
  });

  // Unknown rules are excluded from the denominator so missing API data never fakes a score.
  const knownRules = out.filter((r) => r.known);
  const maxKnown = knownRules.reduce((a, r) => a + r.max, 0);
  const earnedKnown = knownRules.reduce((a, r) => a + r.earned, 0);
  const score = maxKnown === 0 ? 0 : Math.round((earnedKnown / maxKnown) * 100);

  const groups: Record<string, { earned: number; max: number }> = {};
  for (const r of knownRules) { (groups[r.group] ??= { earned: 0, max: 0 }); groups[r.group].earned += r.earned; groups[r.group].max += r.max; }
  const breakdown = Object.entries(groups).map(([group, g]) => ({ group, earned: g.earned, max: g.max, pct: Math.round((g.earned / g.max) * 100) }));
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const recommendations = out.filter((r) => r.known && r.earned < r.max)
    .sort((a, b) => rank[a.priority] - rank[b.priority] || (b.max - b.earned) - (a.max - a.earned))
    .map((r) => ({ key: r.key, label: r.label, priority: r.priority, pointsLost: r.max - r.earned, detail: r.detail, action: r.action }));
  return { score, breakdown, rules: out, recommendations, unknown: out.filter((r) => !r.known).map((r) => r.label), rulesVersion: RULES_VERSION };
}
