import { NextResponse } from "next/server";
import { callEHealthStatus } from "../../../lib/health";

export const dynamic = "force-dynamic";

export function GET() {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  return NextResponse.json(
    {
      ok: supabaseConfigured,
      service: "asyncfounders",
      supabase: supabaseConfigured ? "configured" : "missing",
      calle: callEHealthStatus(),
    },
    { status: supabaseConfigured ? 200 : 503 },
  );
}
