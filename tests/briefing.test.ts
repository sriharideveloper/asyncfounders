import assert from "node:assert/strict";
import test from "node:test";
import { compileCallBriefing } from "../lib/briefing.ts";

test("briefings preserve unseen memory, open questions and source provenance", () => {
  const briefing = compileCallBriefing({
    companyDescription: "Builds workflow software for clinics.",
    agentInstructions: "Use the term clinic partner, never lead.",
    focus: "pricing",
    lastBriefedVersion: 3,
    memories: [{ version: 5, kind: "decision", title: "Pilot price", body: "$500 was accepted.", status: "accepted", confidence: .9, source_excerpt: "Approved by both founders." }, { version: 4, kind: "question", title: "Discount", body: "Annual discount is unknown.", status: "open", confidence: .7 }],
    chunks: [{ sourceLabel: "Pricing memo", ordinal: 2, content: "The pricing research recommends a $500 monthly pilot." }],
  });
  assert.match(briefing, /UNSEEN MEMORY DELTAS/);
  assert.match(briefing, /Annual discount is unknown/);
  assert.match(briefing, /Pricing memo · chunk 3/);
  assert.match(briefing, /clinic partner/);
});
