import { approvedCallContext, type MemoryContext } from "./call-safety.ts";

type BriefingChunk = { content: string; ordinal: number; sourceLabel: string };

const MAX_BRIEFING_CHARACTERS = 24_000;

function terms(value: string) {
  return new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

function scoreChunk(chunk: BriefingChunk, queryTerms: Set<string>) {
  const haystack = chunk.content.toLowerCase();
  let score = 0;
  for (const term of queryTerms) if (haystack.includes(term)) score += 2;
  if (/decision|blocker|customer|revenue|launch|deadline|risk|owner/i.test(chunk.content)) score += 1;
  return score;
}

export function compileCallBriefing(input: {
  mode: "deposit" | "catchup" | "ask";
  companyDescription: string;
  agentInstructions?: string;
  focus?: string;
  lastBriefedVersion: number;
  memories: MemoryContext[];
  chunks: BriefingChunk[];
}) {
  const memory = approvedCallContext(input.mode, input.memories, input.lastBriefedVersion);
  if (memory.reason) return { briefing: null, reason: memory.reason, contextVersion: memory.contextVersion, contextItems: 0 };

  const queryTerms = terms(`${input.focus ?? ""} ${input.companyDescription} ${memory.briefing ?? ""}`);
  const relevantChunks = [...input.chunks]
    .sort((a, b) => scoreChunk(b, queryTerms) - scoreChunk(a, queryTerms))
    .slice(0, 12);

  const sections = [
    memory.briefing ?? "",
    `COMPANY CONTEXT\n${(input.companyDescription || "No company description has been added.").slice(0, 2_000)}`,
    input.agentInstructions?.trim() ? `COMPANY-SPECIFIC AGENT GUIDANCE\n${input.agentInstructions.trim().slice(0, 3_000)}` : "",
    input.focus?.trim() ? `FOCUS REQUESTED BY THE RECIPIENT\n${input.focus.trim()}` : "",
  ].filter(Boolean);
  let briefing = sections.join("\n\n");
  let includedChunks = 0;

  if (!relevantChunks.length) {
    briefing += "\n\nINDEXED SOURCE EXCERPTS\nNo indexed source text is available yet.";
  } else {
    const heading = "\n\nINDEXED SOURCE EXCERPTS";
    if (briefing.length + heading.length <= MAX_BRIEFING_CHARACTERS) briefing += heading;
    for (const chunk of relevantChunks) {
      const line = `\n\n[${chunk.sourceLabel} · chunk ${chunk.ordinal + 1}] ${chunk.content}`;
      if (briefing.length + line.length > MAX_BRIEFING_CHARACTERS) break;
      briefing += line;
      includedChunks += 1;
    }
  }

  return { briefing, reason: null, contextVersion: memory.contextVersion, contextItems: memory.memoryItems + includedChunks };
}
