import { z } from "zod";

export const previewInputSchema = z.object({
  companyId: z.string().uuid(),
  mode: z.enum(["deposit", "catchup", "ask"]),
  focus: z.string().trim().max(600).optional().default(""),
});

export const confirmInputSchema = z.object({ previewId: z.string().uuid() });
export const supportedCalleRegions = new Set(["US", "SG", "MY", "IN", "AE", "AU", "CA", "GB", "VN", "DE", "JP", "FR", "MX", "BR", "ID", "PH", "KE"]);

export const modeConfig = {
  deposit: { purpose: "Help the founder share what changed and turn supported statements into typed company memory.", duration: "Usually 4–8 minutes", questions: ["Start with what changed and follow the parts that matter.", "Clarify whether each important point is a fact, idea, assumption, decision, question, task or conflict.", "Ask naturally for evidence, ownership and audience only when relevant."] },
  catchup: { purpose: "Give the founder a concise, source-backed briefing on what they have not yet acknowledged.", duration: "Usually 3–6 minutes", questions: ["Lead with the most relevant unseen decisions, blockers and conflicts.", "Pause for questions and use indexed company sources when they answer them.", "Record acknowledgement, correction, dispute or deferral without forcing a response."] },
  ask: { purpose: "Help the founder think through an unresolved company question using the current company context.", duration: "Usually 3–7 minutes", questions: ["Begin with the requested question or focus.", "Use relevant memory and source context, then explore uncertainty conversationally.", "Finish by separating conclusions, proposals and remaining unknowns."] },
} as const;

export type CallMode = keyof typeof modeConfig;

export const memoryResultValidator = z.object({
  outcome: z.enum(["complete", "partial", "no_usable_evidence", "unknown"]),
  memory_items: z.array(z.object({
    type: z.enum(["fact", "idea", "assumption", "decision", "question", "task", "conflict"]),
    title: z.string().min(2).max(180), body: z.string().min(2).max(4000),
    status: z.enum(["open", "proposed", "accepted", "answered", "resolved", "dismissed"]),
    confidence: z.enum(["high", "medium", "low", "unknown"]),
    source_excerpt: z.string().max(800), audience: z.array(z.string().max(80)).max(30),
  })).max(30),
  unresolved_questions: z.array(z.string().max(500)).max(20),
});

export const recipientResultSchema = {
  type: "object", additionalProperties: false, required: ["outcome", "memory_items", "unresolved_questions"],
  properties: {
    outcome: { type: "string", enum: ["complete", "partial", "no_usable_evidence", "unknown"] },
    memory_items: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false, required: ["type", "title", "body", "status", "confidence", "source_excerpt", "audience"], properties: {
      type: { type: "string", enum: ["fact", "idea", "assumption", "decision", "question", "task", "conflict"] },
      title: { type: "string" }, body: { type: "string" },
      status: { type: "string", enum: ["open", "proposed", "accepted", "answered", "resolved", "dismissed"] },
      confidence: { type: "string", enum: ["high", "medium", "low", "unknown"] },
      source_excerpt: { type: "string" }, audience: { type: "array", items: { type: "string" } },
    } } },
    unresolved_questions: { type: "array", items: { type: "string" } },
  },
};

export function buildTask(input: { companyName: string; memberName: string; mode: CallMode; briefing?: string; focus?: string }) {
  const config = modeConfig[input.mode];
  return [
    "You are AsyncFounders, an AI callback interviewer for a verified member of a private company workspace.",
    "At the start, identify yourself as an AI, say why you are calling, and confirm the person is willing to continue.",
    "Sound like a perceptive operator, not a form. Ask one question at a time, listen, follow useful threads, and adapt your wording.",
    "The conversation goals below are guidance, not a rigid script. Skip anything already answered and ask natural follow-ups when they improve clarity.",
    "You may answer the member's questions from approved company context. Say plainly when the context does not contain an answer.",
    "Do not make commitments, purchases, schedules, promises, or external actions.",
    "Never invent another teammate's belief. Preserve uncertainty and disagreement.",
    "Do not promote brainstorming into a decision or assign a task without an explicit owner.",
    `Company: ${input.companyName}`, `Recipient: ${input.memberName}`, `Purpose: ${config.purpose}`,
    input.focus ? `Recipient's requested focus: ${input.focus}` : "Recipient's requested focus: none; begin broadly and let them steer.",
    input.briefing ? `Approved context:\n${input.briefing}` : "Approved context: No additional company details are required for this call.",
    "Conversation goals:", ...config.questions.map((question, index) => `${index + 1}. ${question}`),
    "Before ending, briefly reflect back what you heard and let the member correct the record.",
    "Return only evidence-supported memory. Put unknowns into unresolved_questions.",
  ].join("\n");
}

export async function fingerprint(value: object) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function maskPhone(phone: string | null, lastFour: string | null) { return phone ? `${phone.slice(0, 3)} •••••• ${phone.slice(-4)}` : `•••• ${lastFour ?? "—"}`; }
export function confidenceNumber(value: string) { return value === "high" ? 0.9 : value === "medium" ? 0.7 : value === "low" ? 0.4 : 0.25; }
