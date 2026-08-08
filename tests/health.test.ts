import assert from "node:assert/strict";
import test from "node:test";
import { callEHealthStatus } from "../lib/health.ts";

test("CALL-E health reports safe demo mode", () => {
  assert.equal(callEHealthStatus({ CALLE_DEMO_MODE: "true" }), "demo");
});

test("CALL-E health gives configured live calling precedence", () => {
  assert.equal(callEHealthStatus({ CALLE_API_KEY: "secret", CALLE_LIVE_CALLS_ENABLED: "true", CALLE_DEMO_MODE: "true" }), "live");
  assert.equal(callEHealthStatus({}), "disabled");
});
