import { NextResponse } from "next/server";
import { authenticatedUser, adminSupabase } from "../../../../lib/supabase";
import { fingerprint, maskPhone, modeConfig, previewInputSchema, supportedCalleRegions } from "../../../../lib/callbacks";
import { compileCallBriefing } from "../../../../lib/briefing";

export async function POST(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ message: "Sign in again before preparing a callback." }, { status: 401 });
    const parsed = previewInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ message: "The callback request is invalid." }, { status: 400 });
    const supabase = adminSupabase();
    const { data: caller } = await supabase.from("company_members").select("id,role,display_name,region,locale,timezone,phone_e164,phone_last_four,call_consent,status,last_briefed_version").eq("company_id", parsed.data.companyId).eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (!caller) return NextResponse.json({ message: "You are not an active member of this company." }, { status: 403 });
    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count: recentRequests, error: rateError } = await supabase.from("call_sessions").select("id", { count: "exact", head: true }).eq("requested_by", user.id).gte("requested_at", hourAgo);
    if (rateError) throw rateError;
    if ((recentRequests ?? 0) >= 12) return NextResponse.json({ message: "Callback limit reached. Try again in an hour." }, { status: 429, headers: { "Retry-After": "3600" } });
    const [{ data: company }, { data: memories }, { data: sources }, { data: chunks }] = await Promise.all([
      supabase.from("companies").select("id,name,description,agent_instructions,current_version").eq("id", parsed.data.companyId).single(),
      supabase.from("memory_items").select("version,kind,title,body,status,confidence,source_excerpt").eq("company_id", parsed.data.companyId).order("version", { ascending: false }).limit(60),
      supabase.from("sources").select("id,label").eq("company_id", parsed.data.companyId).eq("index_status", "indexed").limit(40),
      supabase.from("source_chunks").select("source_id,ordinal,content").eq("company_id", parsed.data.companyId).order("created_at", { ascending: false }).limit(80),
    ]);
    const member = caller;
    if (!company || !member || member.status !== "active") return NextResponse.json({ message: "Your active founder profile was not found." }, { status: 404 });
    if (!member.call_consent || !member.phone_e164) return NextResponse.json({ message: `${member.display_name} has not enabled AI callbacks.` }, { status: 422 });
    if (!supportedCalleRegions.has(member.region)) return NextResponse.json({ message: `CALL-E does not currently support ${member.region}. Their workspace access is unaffected.` }, { status: 422 });
    const live = process.env.CALLE_LIVE_CALLS_ENABLED === "true" && Boolean(process.env.CALLE_API_KEY);
    const demo = process.env.CALLE_DEMO_MODE === "true";
    if (!live && !demo) return NextResponse.json({ message: "Calling is not configured for this deployment." }, { status: 503 });
    const previewId = crypto.randomUUID();
    const provider = live ? "calle" : "demo";
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const sourceNames = new Map((sources ?? []).map((source) => [source.id, source.label]));
    const briefing = compileCallBriefing({
      companyDescription: company.description,
      agentInstructions: company.agent_instructions,
      focus: parsed.data.focus,
      lastBriefedVersion: member.last_briefed_version,
      memories: memories ?? [],
      chunks: (chunks ?? []).map((chunk) => ({ content: chunk.content, ordinal: chunk.ordinal, sourceLabel: sourceNames.get(chunk.source_id) ?? "Company source" })),
    });
    const bound = { previewId, companyId: company.id, companyVersion: company.current_version, memberId: member.id, mode: parsed.data.mode, focus: parsed.data.focus, provider, requestedBy: user.id, createdAt, expiresAt };
    const payloadFingerprint = await fingerprint(bound);
    const publicPreview = { ...bound, fingerprint: payloadFingerprint, recipient: member.display_name, maskedPhone: maskPhone(member.phone_e164, member.phone_last_four), purpose: modeConfig[parsed.data.mode].purpose, questions: modeConfig[parsed.data.mode].questions, duration: modeConfig[parsed.data.mode].duration, contextItems: (memories?.length ?? 0) + (chunks?.length ?? 0) };
    const preview = { ...publicPreview, briefing };
    const { error } = await supabase.from("call_sessions").insert({ id: previewId, company_id: company.id, member_id: member.id, requested_by: user.id, mode: parsed.data.mode, provider, status: "previewed", payload_fingerprint: payloadFingerprint, preview });
    if (error) throw error;
    return NextResponse.json({ ...publicPreview, warning: live ? "This exact plan will place a real outbound call after confirmation." : "Safe demo mode is active; no phone will be dialled." });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not prepare the callback." }, { status: 500 });
  }
}
