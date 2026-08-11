import { NextResponse } from "next/server";
import { z } from "zod";
import { adminSupabase, authenticatedUser } from "../../../lib/supabase";

const profileSchema = z.object({
  companyId: z.string().uuid(),
  phone: z.string().trim().max(24).optional().default(""),
  consent: z.boolean(),
  timezone: z.string().trim().min(1).max(120),
  quietHoursStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional().default(null),
  quietHoursEnd: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional().default(null),
}).refine((value) => Boolean(value.quietHoursStart) === Boolean(value.quietHoursEnd), {
  message: "Quiet hours require both a start and end time.",
});

export async function POST(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ message: "Sign in again before changing callback settings." }, { status: 401 });
    const parsed = profileSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ message: "Those callback settings are invalid." }, { status: 400 });
    try {
      new Intl.DateTimeFormat("en", { timeZone: parsed.data.timezone }).format();
    } catch {
      return NextResponse.json({ message: "Choose a valid IANA timezone, such as Asia/Kolkata." }, { status: 400 });
    }

    const supabase = adminSupabase();
    const { data, error } = await supabase.rpc("update_callback_profile_for_user", {
      target_company: parsed.data.companyId,
      target_user: user.id,
      callback_phone: parsed.data.phone,
      callback_consent: parsed.data.consent,
      callback_timezone: parsed.data.timezone,
      callback_quiet_hours_start: parsed.data.quietHoursStart,
      callback_quiet_hours_end: parsed.data.quietHoursEnd,
    });
    if (error) {
      const conflict = /already connected/i.test(error.message);
      return NextResponse.json({ message: error.message }, { status: conflict ? 409 : 422 });
    }
    return NextResponse.json({ ok: true, profile: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Callback settings could not be saved." }, { status: 500 });
  }
}
