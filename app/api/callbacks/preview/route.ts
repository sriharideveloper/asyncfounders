import { NextResponse } from "next/server";
import { authenticatedUser, adminSupabase } from "../../../../lib/supabase";
import { buildTask, fingerprint, maskPhone, modeConfig, previewInputSchema, supportedCalleRegions } from "../../../../lib/callbacks";
import { compileCallBriefing } from "../../../../lib/briefing";
import { fingerprintInput, recipientQuietHours, storedPreviewSchema, type PreviewCore } from "../../../../lib/call-safety";

export async function POST(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ message: "Sign in again before preparing a callback." }, { status: 401 });
    const parsed = previewInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ message: "The callback request is invalid." }, { status: 400 });

    const supabase = adminSupabase();
    const { data: caller, error: callerError } = await supabase
      .from("company_members")
      .select("id,display_name,region,locale,timezone,phone_e164,phone_last_four,call_consent,status,quiet_hours_start,quiet_hours_end,last_briefed_version")
      .eq("company_id", parsed.data.companyId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (callerError) throw callerError;
    if (!caller) return NextResponse.json({ message: "You are not an active member of this company." }, { status: 403 });
    if (!caller.call_consent || !caller.phone_e164 || !caller.phone_last_four) return NextResponse.json({ message: "Enable your callback number before preparing a call." }, { status: 422 });
    if (!supportedCalleRegions.has(caller.region)) return NextResponse.json({ message: `CALL-E does not currently support ${caller.region}. Your workspace access is unaffected.` }, { status: 422 });

    const quiet = recipientQuietHours({ timezone: caller.timezone, start: caller.quiet_hours_start, end: caller.quiet_hours_end });
    if (quiet.quiet) return NextResponse.json({ message: `You are inside your configured quiet hours${quiet.localTime ? ` (local time ${quiet.localTime})` : ""}. Prepare the call after quiet hours end.` }, { status: 422 });

    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count: recentRequests, error: rateError } = await supabase.from("call_sessions").select("id", { count: "exact", head: true }).eq("requested_by", user.id).gte("requested_at", hourAgo);
    if (rateError) throw rateError;
    if ((recentRequests ?? 0) >= 12) return NextResponse.json({ message: "Callback limit reached. Try again in an hour." }, { status: 429, headers: { "Retry-After": "3600" } });

    let memoryQuery = supabase.from("memory_items").select("version,kind,title,body,status,confidence,source_excerpt").eq("company_id", parsed.data.companyId);
    if (parsed.data.mode === "catchup") {
      memoryQuery = memoryQuery.gt("version", caller.last_briefed_version).order("version", { ascending: true }).limit(31);
    } else if (parsed.data.mode === "ask") {
      memoryQuery = memoryQuery.eq("kind", "question").order("version", { ascending: false }).limit(30);
    } else {
      memoryQuery = memoryQuery.order("version", { ascending: false }).limit(80);
    }

    const [companyResult, memoryResult, sourceResult, chunkResult] = await Promise.all([
      supabase.from("companies").select("id,name,description,agent_instructions,current_version").eq("id", parsed.data.companyId).single(),
      memoryQuery,
      supabase.from("sources").select("id,label").eq("company_id", parsed.data.companyId).eq("index_status", "indexed").limit(40),
      supabase.from("source_chunks").select("source_id,ordinal,content").eq("company_id", parsed.data.companyId).order("created_at", { ascending: false }).limit(80),
    ]);
    const queryError = [companyResult, memoryResult, sourceResult, chunkResult].find((result) => result.error)?.error;
    if (queryError) throw queryError;
    const company = companyResult.data;
    if (!company) return NextResponse.json({ message: "This company is no longer available." }, { status: 404 });

    const sourceNames = new Map((sourceResult.data ?? []).map((source) => [source.id, source.label]));
    const context = compileCallBriefing({
      mode: parsed.data.mode,
      companyDescription: company.description,
      agentInstructions: company.agent_instructions,
      focus: parsed.data.focus,
      lastBriefedVersion: Number(caller.last_briefed_version),
      memories: memoryResult.data ?? [],
      chunks: (chunkResult.data ?? []).map((chunk) => ({ content: chunk.content, ordinal: chunk.ordinal, sourceLabel: sourceNames.get(chunk.source_id) ?? "Company source" })),
    });
    if (context.reason || !context.briefing) return NextResponse.json({ message: context.reason ?? "No approved company context is available for this call." }, { status: 422 });

    const task = buildTask({ companyName: company.name, memberName: caller.display_name, mode: parsed.data.mode, briefing: context.briefing, focus: parsed.data.focus });
    const live = process.env.CALLE_LIVE_CALLS_ENABLED === "true" && Boolean(process.env.CALLE_API_KEY);
    const demo = process.env.CALLE_DEMO_MODE === "true";
    if (!live && !demo) return NextResponse.json({ message: "Calling is not configured for this deployment." }, { status: 503 });

    const previewId = crypto.randomUUID();
    const provider = live ? "calle" : "demo";
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const metadata = { workflow: "asyncfounders" as const, company_id: company.id, session_id: previewId, schema_version: "async-memory-v3" as const };
    const core: PreviewCore = {
      previewId,
      companyId: company.id,
      companyVersion: Number(company.current_version),
      companyName: company.name,
      memberId: caller.id,
      mode: parsed.data.mode,
      focus: parsed.data.focus,
      provider,
      requestedBy: user.id,
      createdAt,
      expiresAt,
      task,
      contextVersion: context.contextVersion,
      contextItems: context.contextItems,
      recipient: {
        displayName: caller.display_name,
        region: caller.region,
        locale: caller.locale,
        timezone: caller.timezone,
        quietHoursStart: caller.quiet_hours_start,
        quietHoursEnd: caller.quiet_hours_end,
        phoneLastFour: caller.phone_last_four,
      },
      metadata,
    };
    const payloadFingerprint = await fingerprint(fingerprintInput(core, caller.phone_e164));
    const preview = storedPreviewSchema.parse({
      ...core,
      fingerprint: payloadFingerprint,
      maskedPhone: maskPhone(caller.phone_e164, caller.phone_last_four),
      purpose: modeConfig[parsed.data.mode].purpose,
      questions: modeConfig[parsed.data.mode].questions,
      duration: modeConfig[parsed.data.mode].duration,
    });
    const { data: creation, error: creationError } = await supabase.rpc("create_call_preview", {
      target_session: previewId,
      target_company: company.id,
      target_member: caller.id,
      target_user: user.id,
      target_mode: parsed.data.mode,
      target_provider: provider,
      target_fingerprint: payloadFingerprint,
      target_preview: preview,
    });
    if (creationError) throw creationError;
    const result = creation as { created?: boolean; previewId?: string; status?: string; providerCallId?: string | null } | null;
    if (!result?.created) {
      return NextResponse.json({
        message: result?.status === "dispatching" && !result.providerCallId
          ? "A previous call dispatch has an ambiguous result. Confirm that same preview again to reconcile it before creating another."
          : "You already have an unresolved callback. Finish or expire it before creating another preview.",
        previewId: result?.previewId,
        status: result?.status,
      }, { status: 409 });
    }

    return NextResponse.json({
      previewId,
      companyVersion: core.companyVersion,
      contextVersion: core.contextVersion,
      memberId: caller.id,
      mode: parsed.data.mode,
      provider,
      requestedBy: user.id,
      createdAt,
      expiresAt,
      fingerprint: payloadFingerprint,
      recipient: caller.display_name,
      maskedPhone: preview.maskedPhone,
      purpose: preview.purpose,
      questions: preview.questions,
      duration: preview.duration,
      contextItems: preview.contextItems,
      task,
      warning: live
        ? "Review the exact script below. This company version and masked destination will place a real outbound call after confirmation."
        : "Review the exact script below. Safe demo mode is active; no phone will be dialled.",
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not prepare the callback." }, { status: 500 });
  }
}
