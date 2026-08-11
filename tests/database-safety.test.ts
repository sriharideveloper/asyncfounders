import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/003_callback_integrity_hardening.sql", import.meta.url), "utf8");

test("preview creation serializes each self-recipient slot", () => {
  assert.match(migration, /create_call_preview/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /status not in \('completed','failed'/);
  assert.match(migration, /Requester is not the active callback recipient/);
});

test("confirmation and ingestion reauthorize the active recipient", () => {
  assert.match(migration, /claim_call_session/);
  assert.match(migration, /Requester is no longer the active callback recipient/);
  assert.match(migration, /ingest_call_memory\(target_session uuid, target_user uuid/);
  assert.match(migration, /advance_call_briefing\(target_session uuid, target_user uuid/);
});

test("call sessions are requester-only and historical provider evidence is purged", () => {
  assert.match(migration, /requested_by = auth\.uid\(\) and public\.is_company_member/);
  assert.match(migration, /result \? 'transcriptEvidence'/);
  assert.match(migration, /result \? 'providerEvidence'/);
});
