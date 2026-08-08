import type { Metadata } from "next";
import { AsyncFoundersConsole } from "../asyncfounders-console";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your private AsyncFounders company workspace.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  return <AsyncFoundersConsole/>;
}
