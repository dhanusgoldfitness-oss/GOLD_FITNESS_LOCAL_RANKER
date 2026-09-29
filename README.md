# DigiMithra — Local SEO & Google Business Profile

Local SEO + Google Business Profile SaaS. React + Vite + TS + Tailwind (client) · Node/Express (server) · Supabase · Gemini · Google Business Profile APIs.

## Status
Phases 0–25 of the build guide are implemented in code, plus AI Mode, AI Video (Veo) and Social Post drafts. Phase 26 (full QA — only unit tests exist so far) and phase 27 (production deployment) are still to do. Items marked (needs keys) work as soon as the credential is provided; until then the UI shows a real `NOT_CONNECTED` / `API_PENDING` status, never sample data.

| Area | Notes |
|---|---|
| Auth, shell, Google OAuth, locations, profile, audit, AI optimization, reviews + AI replies, posts | Built |
| Keywords + rank history, geo-grid (3/5/7), competitors + gap analysis | Built (needs `GOOGLE_MAPS_API_KEY`, Places API New) |
| Performance analytics, frozen reports (print to PDF) | Built (needs Google API access) |
| AI images (stored in Supabase Storage, approve before use) | Built (needs Gemini image-capable plan) |
| Notifications, automation engine (idempotent), WhatsApp Cloud API + signed webhook, Lead CRM | Built (WhatsApp needs Meta credentials) |
| Plans, limits (locations/keywords/scans/credits), super-admin panel with audit log | Built; payment gateway intentionally not connected |
| Background jobs (scheduled posts every minute, daily review + metrics sync, weekly ranks/competitors) with DB job locks | Built (in-process scheduler; set `SCHEDULER_ENABLED=false` on extra instances) |
| Billing modules (customers, services, invoices, expenses, Tally XML) | Built |
| AI Mode, AI Video (Google Veo, 5 credits, charged when ready), Social Post drafts (copy or open the platform) | Built (needs Gemini key; Veo needs a plan with video access). Direct auto-posting to social platforms is not connected |

## Setup
1. Run `supabase/migrations/0001` → `0006` in order in the Supabase SQL editor (already applied to project `tlquwsvrodjzbmeaifkx`).
2. `cd server && cp .env.example .env` — fill values (service-role key, Google OAuth, `TOKEN_ENC_KEY`, `OAUTH_STATE_SECRET`, `GEMINI_API_KEY`). `npm install && npm test && npm run dev`.
3. `cd client && cp .env.example .env` — anon key only. `npm install && npm run build && npm run dev`.
4. Google Cloud: enable the Business Profile APIs, add redirect URI `http://localhost:8080/api/auth/google/callback`. API access is granted by Google separately from OAuth; the UI shows `API_PENDING` until it is.

## Security notes
Service-role key, Google secret, Gemini key and refresh tokens exist only on the server. Tokens are AES-256-GCM encrypted; `google_connections` has RLS enabled with no client policy. All writes go through the API, scoped by the verified JWT user.

## Make yourself super admin
After signing up, run in the Supabase SQL editor: `update public.profiles set role='super_admin' where email='you@example.com';`

## Deploy
Frontend → Vercel (root `client`, env `VITE_*`). Backend → Render (`render.yaml`). Then add the production redirect URI to your Google OAuth client and set `FRONTEND_URL` for CORS.
