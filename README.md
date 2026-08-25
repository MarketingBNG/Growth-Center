# Growth Center

One portal for BNG Advisors' growth engine: leads, CRM, pipeline, campaigns, SEO,
social, outreach, content, analytics and AI insights — instead of switching between
platforms.

Growth Center is the layer of **intelligence and orchestration**. External platforms
(Zoho CRM, Meta Ads, Google Analytics, Semrush) stay the execution systems; this reads
from them, it does not reimplement them.

Sibling of [bng-command-center](../bng-command-center), not a merge — that one is the
team-ops dashboard (Zoho tasks, roster, timelogs), this is the growth dashboard. Same
stack and conventions on purpose, so the team reads one codebase.

**Next.js 15 (App Router, React 19), Prisma 7 + Neon Postgres, NextAuth + Google SSO.**

## Run locally

1. `cp .env.example .env.local` and fill in at least:
   - `DATABASE_URL` — a Neon connection string (use the **pooled** `-pooler` host)
   - `NEXTAUTH_SECRET` — `openssl rand -base64 32`
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — redirect URI
     `http://localhost:3000/api/auth/callback/google`
   - `APP_ENCRYPTION_KEY` — `openssl rand -hex 32` (exactly 64 hex chars)
2. `npm install`
3. `npm run db:migrate` — creates the schema
4. `npm run db:seed` — 12 months of coherent demo data
5. `npm run dev` → http://localhost:3000

Without `DATABASE_URL` the app still boots: every page renders a "no database
configured" state rather than a stack trace, and `/api/health` reports exactly what is
missing.

Sign-in requires a Google account on an allowed domain **and** on the roster in
[lib/roles.ts](lib/roles.ts). There is no password and no local bypass.

```
npm run dev        # dev server
npm test           # node:test suites, no network or database needed
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # prisma generate && next build
npm run db:studio  # browse the data
npm run db:verify  # assert the demo data reconciles
npm run smoke      # exercise the lead -> deal -> revenue write path
npm run smoke:metrics  # exercise the dashboard/marketing/analytics queries
```

The dev server runs on **port 3100** — `bng-command-center` holds 3000.

## Layout

```
app/(app)/     the signed-in application. One folder per module.
app/api/       route handlers: parse -> authorize -> call lib. No logic here.
app/api/public/ X-API-Key auth for website form capture.
components/    AppShell, Sidebar + ui/ primitives + patterns/ (tables, filters, states)
lib/           all business logic, framework-free and unit-testable
prisma/        schema, migrations, seed
tools/         node:test suites
```

Two rules keep this navigable: **route handlers contain no logic**, and **`lib/*` never
imports from `next`**.

A third rule the build enforces: anything a `'use client'` component imports must not
reach `lib/prisma`. Shared constants live in [lib/enums.ts](lib/enums.ts) and pure
arithmetic in [lib/calc.ts](lib/calc.ts) — both import nothing. Importing a constant
from a db-touching module once pulled the Postgres driver into the browser bundle.

## Access control

Single-tenant. This is BNG's own tool, so there is no organisation or workspace layer —
[lib/roles.ts](lib/roles.ts) is the roster, the permission source **and** the sign-in
allow-list. Deleting a line revokes that person's access on their next request.

Permissions resolve through one `POLICY` table, so adding a role or a capability is an
edit in one place rather than a hunt for `role === 'manager'` across route handlers.
Every route handler names the permission it needs as an argument to `route()`, so a
handler cannot forget its check.

| Role | Reads | CRM/pipeline writes | Campaigns | Integrations | API keys, settings |
|---|---|---|---|---|---|
| partner, controller | ✓ | ✓ | ✓ | ✓ | ✓ |
| manager | ✓ | ✓ | ✓ | ✓ | — |
| member | ✓ | ✓ | — | — | — |
| viewer | ✓ | — | — | — | — |

## Data model

The funnel is a real chain, not a report:
`Lead → Opportunity → Customer → RevenueEntry`, each carrying `campaignId` and
`channelId`, so `Visitors → Leads → Qualified → Opportunities → Customers → Revenue`
and full campaign attribution resolve in SQL.

Two decisions carry most of the weight:

- **`Activity` is append-only.** Lead status lives on `Lead` for querying, but every
  change also writes an Activity row. "How did this lead get here" is answerable from
  the table instead of lost to the last `UPDATE`.
- **`MetricSnapshot` is the only time-series table.** Every integration writes into it
  and every chart reads from it, so adding a provider adds rows, not tables.

## Charts

Series colours are the six `--chart-*` tokens in `app/globals.css`, stepped for this
dark surface and **validated** rather than chosen by eye: lightness band, chroma floor,
adjacent-pair CVD separation (worst ΔE 8.4 protan), normal-vision floor (worst ΔE 19.3)
and 3:1 contrast all pass. Assign them in order and never cycle them.
`--success`/`--warning`/`--destructive` are status colours and are never reused as a
series.

Two rules the charts follow: **never a second y-axis** (two measures of different scale
get two charts — a dual axis lets the author choose which line appears to be winning),
and **a rate with no denominator is null, not zero** — a 0% CTR on a campaign that
served nothing is a false statement.

## Integration honesty

An integration is `disconnected`, `connecting`, `connected`, `syncing`, `error` or
`demo_data` — read from the `Integration` row, never inferred. Nothing renders
"connected" without a credential behind it. Seeded data is labelled as demo in the UI.

Credentials are AES-256-GCM sealed under `APP_ENCRYPTION_KEY` in a separate table from
`Integration`, so a query that renders a card cannot select a secret.

## Status

| Phase | State |
|---|---|
| 1 · Foundation — auth, roster, schema, shell | done |
| 2 · CRM, Leads, Pipeline | done |
| 3 · Dashboard, Marketing, Analytics, Integration Center | done |
| 4 · SEO, Social, Outreach, Content, Reports, AI Insights | next |
| 5 · Polish and automation | not started |
| 6 · Tests and hardening | ongoing |

Modules from later phases have real routes and real tables; their pages say which phase
they are scheduled for rather than showing a mock screen.

## Needs credentials

Everything below degrades to an honest "requires credentials" state — nothing breaks.

| What | Env vars |
|---|---|
| Sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Google Analytics, Search Console, Ads | the Google OAuth client, `GOOGLE_ADS_DEVELOPER_TOKEN` |
| Meta / Instagram Ads | `META_APP_ID`, `META_APP_SECRET` |
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
| Semrush (SEO) | `SEMRUSH_API_KEY` |
| Zoho CRM | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` |
| AI insights | `ANTHROPIC_API_KEY` |
| Outreach sending | `SMTP_*` |
