# Growth Center

One portal for BNG Advisors' growth engine: leads, CRM, pipeline, campaigns, SEO,
social, outreach, content, analytics and AI insights — instead of switching between
platforms.

Growth Center is the layer of **intelligence and orchestration**. External platforms
(Zoho CRM, Meta Ads, Google Analytics, Search Console) stay the execution systems; this reads
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
4. `npm run db:seed` — 12 months of coherent demo data, for an empty database only.
   It deletes every table, integration credentials included, and refuses to run against
   a database holding provider-written rows.
5. `npm run dev` → http://localhost:3000

Without `DATABASE_URL` the app still boots: every page renders a "no database
configured" state rather than a stack trace, and `/api/health` reports exactly what is
missing.

Sign-in requires a Google account on an allowed domain **and** on the roster in
[lib/access/roles.ts](lib/access/roles.ts). There is no password and no local bypass.

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
npm run shots      # screenshot every module (needs the dev server running)
```

`npm run shots` signs in by minting a NextAuth token with the app's own secret — Google's
consent screen cannot be automated. It is not a bypass: the email still has to pass the
roster check on every request. The test FAILS if any static asset 404s or if the body has
no background colour, because a run once produced seventeen unstyled screenshots and
still reported success.

**Never run `next build` while `next dev` is running against this directory.** They share
`.next`, and the dev server will serve HTML pointing at production chunk names — every
stylesheet 404s and the app renders unstyled. Delete `.next` when switching.

The dev server runs on port 3000. `bng-command-center` uses the same port, so run
one at a time — Next silently falls back to another port if 3000 is taken, which makes
`NEXTAUTH_URL` and the Google redirect URI wrong.

## Deploying, and migrations

`npm run build` does **not** run migrations. Apply them deliberately, from a machine that
can reach the database directly:

```
npm run db:deploy     # prisma migrate deploy
```

then push, and let Vercel build.

This is not a preference. `prisma migrate deploy` in the build script failed both ways
available to it:

- Through the **pooled** host, migrate's session-level advisory lock is stranded on a
  pgbouncer connection that outlives the process. Every later deploy then fails with
  P1002, waiting ten seconds on an idle connection that will never release it, and someone
  has to kill the backend by hand.
- Through the **direct** host, Vercel's build sandbox cannot open 5432 at all — P1001 in
  under half a second, while the same endpoint accepts connections fine from a laptop.

A build that reaches for the database is also the wrong shape: builds are cached, retried
and run concurrently, and none of those are things a schema change should be subject to.

## Layout

```
app/(app)/     the signed-in application. One folder per module.
app/api/       route handlers: parse -> authorize -> call lib. No logic here.
app/api/public/ X-API-Key auth for website form capture.
components/    AppShell, Sidebar + ui/ primitives + patterns/ (tables, filters, states)
lib/           all business logic, framework-free and unit-testable
prisma/        schema, migrations, seed
tools/         node:test suites, and the one-off backfills
```

`lib/` is grouped by domain:

```
shared/     formatting, enums, currency, ranges, the two mutation hooks
platform/   prisma, api, cache, events, settings, audit — the machinery underneath
access/     auth, roles, users, roster, API keys, crypto
crm/        companies, contacts, deduplication, referrals, capacity
leads/      leads, scoring, segmentation, allocation, automation
pipeline/   deals, stages, decay, deal naming and origin
money/      budget, campaigns, attribution, FX
content/    the content calendar's writers and validators
outreach/   sequences, suppression, email and Cliq delivery
insights/   the rules that produce findings, and the digest that sends them
ai/         the read-only analyst, its tools, redaction, answer formatting
analytics/  per-screen KPI bands, scorecards, SEO and social reads
```

plus four that predate the grouping and keep their own shape: `integrations/` (the provider
adapters), `reports/`, `metrics/`, `content-calendar/`. `lib/metrics.ts`, `lib/reports.ts`
and `lib/content-calendar.ts` sit at the root — each is a re-export façade for the directory
beside it, so `@/lib/metrics` keeps working however its halves are split.

Two rules keep this navigable: **route handlers contain no logic**, and **`lib/*` never
imports from `next`**.

Moving a module is a type-checked operation. Nothing in `lib/` reads a file from disk at
runtime, and `tsc` catches every broken specifier including inside `await import()`. The
tests do not hardcode paths either: `tools/source.ts` resolves a module by name and throws
when the name is unknown or ambiguous, rather than returning nothing and letting an
assertion pass against an empty string.

A third rule the build enforces: anything a `'use client'` component imports must not
reach `lib/platform/prisma`. Shared constants live in [lib/shared/enums.ts](lib/shared/enums.ts) and pure
arithmetic in [lib/shared/calc.ts](lib/shared/calc.ts) — both import nothing. Importing a constant
from a db-touching module once pulled the Postgres driver into the browser bundle.

`lib/shared/` is **not** the statement of that rule. It is where small cross-cutting
modules live, nothing more. The rule is
[tools/client-boundary.test.ts](tools/client-boundary.test.ts), which follows the import
graph and fails when a client component can reach Prisma — directly, through a component it
renders, or through four modules in between. Its `CLIENT_SAFE` list is curated on purpose:
"imports nothing" and "safe in a browser" are different questions. `platform/cache.ts`
imports nothing statically and reaches `next/cache` at runtime; `shared/utils.ts` imports
clsx and is perfectly safe. Do not derive either from the folder.

## Scripts and tests

`tools/` holds the one-off backfills and fixes alongside the test suites. The scripts share
[tools/script.ts](tools/script.ts) — `connect()`, the `--apply` flag,
`stopUnlessApplying()`, `transact()`, and `placeholders()` for batched multi-row writes.
Every one of them is a dry run until `--apply` is passed:

```
node --experimental-strip-types --env-file-if-exists=.env.local tools/<script>.ts [--apply]
```

`npm test` globs `tools/*.test.ts`, and that glob is **not** recursive. A test moved into a
subdirectory matches nothing, and `node --test` then exits 0 having run nothing — a green
board that checked no code. If the directory is ever split, change the glob and assert a
minimum test count in the same commit.

## Access control

Single-tenant. This is BNG's own tool, so there is no organisation or workspace layer —
[lib/access/roles.ts](lib/access/roles.ts) is the roster, the permission source **and** the sign-in
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

Prisma has no field mixins, so two things are conventions rather than shared code, and
both are worth keeping. Every model carries `id String @id @default(cuid())` and
`createdAt`. Every model a sync can write also carries `source` and `externalId` with
`@@unique([source, externalId])` — that pair is what makes a re-import an upsert instead
of a duplicate.

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

## Metric definitions that are easy to get wrong

**ROAS and the channel/campaign revenue columns use new business won in the period**, not
all revenue booked. Recurring income from a customer won last year is real revenue, but it
is not a return on this month's spend — counting it gave an 18× blended ROAS in a month
where new business was a third of the total. The dashboard shows both: "Revenue" is
everything booked, "New business" is deals won.

**A rate with no denominator is null, not zero.** A 0% CTR on a campaign that served
nothing is a false statement, and it drags any average down.

**A dash means "not applicable"; zero means zero.** A channel that spent money and
returned nothing reads `$0` and `0.00×`, not `—`.

**Table footers recompute ratios from the totals**, never average the rows — averaging
ratios is how a footer ends up disagreeing with its own columns.

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
| 4 · SEO, Social, Outreach, Content, Reports, AI Insights | done |
| 5 · Polish and automation | next |
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
| Zoho CRM | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` |
| AI insights | `ANTHROPIC_API_KEY` |
| Outreach sending | `SMTP_*` |
