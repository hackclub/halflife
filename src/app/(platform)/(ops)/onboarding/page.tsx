import { redirect } from "next/navigation"

/** The dashboard is now the only onboarding entry point. */
export default function LegacyOnboardingRedirect() {
  redirect("/dashboard")
}
