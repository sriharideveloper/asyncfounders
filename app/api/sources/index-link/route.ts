import { NextResponse } from "next/server";
import { z } from "zod";
import { adminSupabase, authenticatedUser } from "../../../../lib/supabase";
import { chunksOf } from "../../../../lib/source-indexing";
import { fetchPublicWebSource } from "../../../../lib/web-source";

export const maxDuration = 60;

const requestSchema = z.union([
  z.object({ companyId: z.string().uuid(), url: z.string().url().max(2000), label: z.string().trim().min(1).max(240) }),
  z.object({ companyId: z.string().uuid(), sourceId: z.string().uuid() }),
]);

export async function POST(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ message: "Sign in again before indexing a link." }, { status: 401 });
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ message: "The link indexing request is invalid." }, { status: 400 });
    const supabase = adminSupabase();
    const { data: membership } = await supabase.from("company_members").select("id").eq("company_id", parsed.data.companyId).eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (!membership) return NextResponse.json({ message: "You are not an active member of this company." }, { status: 403 });

    let sourceId: string | null = null;
    let url: string;
    let label: string;
    if ("sourceId" in parsed.data) {
      const { data: source } = await supabase.from("sources").select("id,url,label,kind").eq("id", parsed.data.sourceId).eq("company_id", parsed.data.companyId).maybeSingle();
      if (!source || source.kind !== "link" || !source.url) return NextResponse.json({ message: "That link source was not found." }, { status: 404 });
      sourceId = source.id; url = source.url; label = source.label;
    } else {
      url = parsed.data.url; label = parsed.data.label;
    }

    const page = await fetchPublicWebSource(url);
    const chunks = chunksOf(page.text);
    if (!sourceId) {
      const { data: source, error } = await supabase.from("sources").insert({
        company_id: parsed.data.companyId, kind: "link", label, url: page.finalUrl,
        mime_type: page.contentType, byte_size: page.byteSize, index_status: "queued", chunk_count: 0, added_by: user.id,
      }).select("id").single();
      if (error || !source) throw error ?? new Error("The link source could not be saved.");
      sourceId = source.id;
    }
    await supabase.from("source_chunks").delete().eq("source_id", sourceId);
    for (let start = 0; start < chunks.length; start += 100) {
      const { error } = await supabase.from("source_chunks").insert(chunks.slice(start, start + 100).map((content, offset) => ({ source_id: sourceId, company_id: parsed.data.companyId, ordinal: start + offset, content })));
      if (error) throw error;
    }
    const { error: updateError } = await supabase.from("sources").update({ url: page.finalUrl, mime_type: page.contentType, byte_size: page.byteSize, index_status: "indexed", chunk_count: chunks.length }).eq("id", sourceId);
    if (updateError) throw updateError;
    return NextResponse.json({ sourceId, chunkCount: chunks.length, finalUrl: page.finalUrl });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "The link could not be indexed." }, { status: 422 });
  }
}
