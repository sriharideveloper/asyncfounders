import assert from "node:assert/strict";
import test from "node:test";
import { extractReadableWebText, isPrivateAddress } from "../lib/web-source.ts";

test("web source extraction removes executable markup and keeps readable context", () => {
  const text = extractReadableWebText('<html><head><title>Launch plan</title><script>steal()</script></head><body><h1>Decision</h1><p>Ship on Friday &amp; notify pilots.</p></body></html>', "text/html");
  assert.match(text, /Launch plan/);
  assert.match(text, /Ship on Friday & notify pilots/);
  assert.doesNotMatch(text, /steal/);
});

test("private and loopback source addresses are rejected", () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("10.2.3.4"), true);
  assert.equal(isPrivateAddress("::1"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
});
