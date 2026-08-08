type BriefingMemory = {
  version: number;
  kind: string;
  title: string;
  body: string;
  status: string;
  confidence: number;
  source_excerpt?: string | null;
};

type BriefingChunk = { content: string; ordinal: number; sourceLabel: string };

const MAX_BRIEFING_CHARACTERS = 18_000;

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
  companyDescription: string;
  agentInstructions?: string;
  focus?: string;
  lastBriefedVersion: number;
  memories: BriefingMemory[];
  chunks: BriefingChunk[];
}) {
  const queryTerms = terms(`${input.focus ?? ""} ${input.companyDescription}`);
  const relevantChunks = [...input.chunks]
    .sort((a, b) => scoreChunk(b, queryTerms) - scoreChunk(a, queryTerms))
    .slice(0, 12);
  const unseen = input.memories.filter((item) => item.version > input.lastBriefedVersion);
  const unresolved = input.memories.filter((item) => ["open", "proposed"].includes(item.status));

  const sections = [
    `COMPANY CONTEXT\n${input.companyDescription || "No company description has been added."}`,
    input.agentInstructions?.trim() ? `COMPANY-SPECIFIC AGENT GUIDANCE\n${input.agentInstructions.trim()}` : "",
    input.focus?.trim() ? `FOCUS REQUESTED BY THE RECIPIENT\n${input.focus.trim()}` : "",
    unseen.length ? `UNSEEN MEMORY DELTAS\n${unseen.slice(0, 18).map(formatMemory).join("\n")}` : "UNSEEN MEMORY DELTAS\nNone recorded.",
    unresolved.length ? `OPEN QUESTIONS, PROPOSALS AND CONFLICTS\n${unresolved.slice(0, 14).map(formatMemory).join("\n")}` : "",
    input.memories.length ? `RECENT VERSIONED MEMORY\n${input.memories.slice(0, 24).map(formatMemory).join("\n")}` : "",
    relevantChunks.length ? `INDEXED SOURCE EXCERPTS\n${relevantChunks.map((chunk) => `[${chunk.sourceLabel} · chunk ${chunk.ordinal + 1}] ${chunk.content}`).join("\n\n")}` : "INDEXED SOURCE EXCERPTS\nNo indexed source text is available yet.",
  ].filter(Boolean);

  return sections.join("\n\n").slice(0, MAX_BRIEFING_CHARACTERS);
}

function formatMemory(item: BriefingMemory) {
  const evidence = item.source_excerpt ? ` Evidence: ${item.source_excerpt}` : "";
  return `[v${item.version} · ${item.kind} · ${item.status} · confidence ${Number(item.confidence).toFixed(2)}] ${item.title}: ${item.body}${evidence}`;
}
