import { NextResponse } from "next/server";
import { z } from "zod";
import { adminSupabase, authenticatedUser } from "../../../../lib/supabase";

const requestSchema = z.object({ companyId: z.string().uuid(), confirmation: z.string().trim().min(2).max(80) });

export async function POST(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ message: "Sign in again before deleting a company." }, { status: 401 });
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ message: "The deletion request is invalid." }, { status: 400 });

    const supabase = adminSupabase();
    const [{ data: company }, { data: member }] = await Promise.all([
      supabase.from("companies").select("id,name").eq("id", parsed.data.companyId).maybeSingle(),
      supabase.from("company_members").select("role,status").eq("company_id", parsed.data.companyId).eq("user_id", user.id).maybeSingle(),
    ]);
    if (!company || !member || member.status !== "active" || !["founder", "admin"].includes(member.role)) {
      return NextResponse.json({ message: "Only a founder or admin can delete this company." }, { status: 403 });
    }
    if (parsed.data.confirmation !== company.name) {
      return NextResponse.json({ message: "Type the company name exactly to confirm deletion." }, { status: 422 });
    }

    const paths: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: objects, error: listError } = await supabase.storage.from("company-sources").list(company.id, { limit: 1000, offset });
      if (listError) throw listError;
      paths.push(...(objects ?? []).filter((item) => item.id).map((item) => `${company.id}/${item.name}`));
      if ((objects?.length ?? 0) < 1000) break;
    }
    for (let start = 0; start < paths.length; start += 100) {
      const { error: removeError } = await supabase.storage.from("company-sources").remove(paths.slice(start, start + 100));
      if (removeError) throw removeError;
    }
    const { error: deleteError } = await supabase.from("companies").delete().eq("id", company.id);
    if (deleteError) throw deleteError;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "The company could not be deleted." }, { status: 500 });
  }
}
