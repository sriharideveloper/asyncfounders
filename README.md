# AsyncFounders

**Talk once. The company remembers.**

AsyncFounders is a public, multi-tenant coordination product for distributed founders and teams. A user creates one or more isolated company brains, invites teammates, adds source material, and uses consented CALL-E callbacks to deposit updates or receive the unseen knowledge delta.

## What is implemented

- Supabase email/password authentication.
- Isolated company workspaces with founder, admin and member roles.
- PostgreSQL row-level security and private source storage.
- Secure, expiring, email-bound invitation links.
- Source ingestion for files, pasted notes and links.
- Versioned facts, ideas, assumptions, decisions, questions, tasks and conflicts.
- Private E.164 callback profiles with explicit consent.
- Exact callback preview, ten-minute expiry and payload-bound idempotency.
- Server-only CALL-E integration with strict structured-result validation.
- Failed, malformed, ambiguous and low-confidence calls fail closed.

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

Run `supabase/migrations/001_production_schema.sql` once in the Supabase SQL editor, then configure:

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
3. Deploy.
4. In Supabase Authentication URL Configuration, set the Vercel production origin as the Site URL and add `<origin>/**` as an allowed redirect URL.

Product invariants and future-agent guidance live in `AGENTS.md`.
