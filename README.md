# AsyncFounders

**Talk once. The company remembers.**

AsyncFounders is a public, multi-tenant coordination product for distributed founders and teams. A user creates one or more isolated company brains, invites teammates, adds source material, and uses consented CALL-E callbacks to deposit updates or receive the unseen knowledge delta.

## What is implemented

- Supabase email/password authentication.
- Isolated company workspaces with founder, admin and member roles.
- PostgreSQL row-level security and private source storage.
- Secure, expiring, email-bound invitation links.
- Source ingestion for files, pasted notes and links.
- Server-side public-link fetching, SSRF checks, readable-text extraction and chunk indexing.
- Versioned facts, ideas, assumptions, decisions, questions, tasks and conflicts.
- Evidence, confidence, audience, acknowledgement, dispute and deferral in the memory ledger.
- Private E.164 callback profiles with explicit consent.
- Self-recipient callbacks bound to the authenticated member; ambiguous historical numbers fail closed.
- Exact callback preview, ten-minute expiry and payload-bound idempotency.
- Recipient-local quiet hours enforced at preview and dispatch.
- Atomic self-recipient preview creation and stable reconciliation after ambiguous provider responses.
- Server-only CALL-E integration with source-backed briefings, flexible conversation goals and strict structured-result validation.
- Terminal results are bound to the reviewed provider call, script, metadata, locale and phone destination.
- Only negation-aware recipient evidence can enter shared memory; raw transcripts are never retained.
- Failed, malformed, ambiguous, contradictory and low-confidence calls fail closed.
- Company-wide settings, agent guidance and confirmed company deletion.

## Stack

- Next.js App Router and TypeScript
- Supabase Auth, Postgres and Storage
- CALL-E TypeScript SDK
- Vercel

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Run the SQL migrations in order:

1. `supabase/migrations/001_production_schema.sql`
2. `supabase/migrations/002_founder_memory_upgrade.sql`
3. `supabase/migrations/003_callback_integrity_hardening.sql`

Apply migration 003 before deploying this application version. It atomically claims callback previews, makes call-session reads requester-only, purges historical provider evidence, and upgrades the callback-profile RPC with quiet-hours support.

Then configure:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
CALLE_API_KEY
CALLE_LIVE_CALLS_ENABLED=true
CALLE_DEMO_MODE=false
```

`SUPABASE_SERVICE_ROLE_KEY` and `CALLE_API_KEY` are server-only secrets. Never expose them through a `NEXT_PUBLIC_` variable.

## Verification

```bash
npm run check
```

## Deploy on Vercel

1. Import `sriharideveloper/asyncfounders` into Vercel.
2. Add the six environment variables above to Production, Preview and Development.
3. Apply all Supabase migrations through `003_callback_integrity_hardening.sql`.
4. Deploy.
5. In Supabase Authentication URL Configuration, set the Vercel production origin as the Site URL and add `<origin>/**` as an allowed redirect URL.

Product invariants and future-agent guidance live in `AGENTS.md`.
