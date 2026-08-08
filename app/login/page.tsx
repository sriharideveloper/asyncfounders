import type { Metadata } from "next";
import { AsynFoundersConsole } from "../asynfounders-console";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your private AsyncFounders company workspace.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  return <AsynFoundersConsole/>;
}
