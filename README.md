# DGF Local Ranker — Dhanus Gold Fitness

Local SEO + Google Business Profile SaaS. React + Vite + TS + Tailwind (client) · Node/Express (server) · Supabase · Gemini · Google Business Profile APIs.

## Status (build guide phases)
| Phase | State |
|---|---|
| 0–2 Plan, auth, dashboard shell | Built |
| 3 Google OAuth (encrypted refresh token, signed state, honest status) | Built |
| 4–5 Locations sync/select, live profile refresh | Built |
| 6 Audit engine (deterministic, tested) | Built + unit-tested |
| 7 AI optimization (approve → apply description) | Built |
| 8–9 Reviews inbox + AI replies (human approval always) | Built |
| Billing modules (customers, services, categories, invoices, expenses, Tally, settings) | Built |
| Google Posts (draft/schedule/publish) | Built (scheduler = phase 24) |
| 10–27 (keywords, geo-grid, competitors, reports, WhatsApp, admin, jobs…) | Menu items show real `API_PENDING` status |

## Setup
1. Run `supabase/migrations/0001_init.sql` in the Supabase SQL editor.
2. `cd server && cp .env.example .env` — fill values (service-role key, Google OAuth, `TOKEN_ENC_KEY`, `OAUTH_STATE_SECRET`, `GEMINI_API_KEY`). `npm install && npm test && npm run dev`.
3. `cd client && cp .env.example .env` — anon key only. `npm install && npm run build && npm run dev`.
4. Google Cloud: enable the Business Profile APIs, add redirect URI `http://localhost:8080/api/auth/google/callback`. API access is granted by Google separately from OAuth; the UI shows `API_PENDING` until it is.

## Security notes
Service-role key, Google secret, Gemini key and refresh tokens exist only on the server. Tokens are AES-256-GCM encrypted; `google_connections` has RLS enabled with no client policy. All writes go through the API, scoped by the verified JWT user.
