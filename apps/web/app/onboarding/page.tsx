import { redirect } from "next/navigation";
import { OnboardingSurvey } from "@/components/OnboardingSurvey";
import { authService } from "@/lib/server/auth";
import { emailVerificationPolicy } from "@/lib/server/emailVerificationPolicy";

export default async function OnboardingPage() {
  const user = await authService.getCurrentUser();
  if (!user) redirect("/login?next=/onboarding");
  if (emailVerificationPolicy.isRequired() && !user.emailVerifiedAt) redirect("/verify-email");
  if (user.onboardingCompletedAt) redirect("/workspace");
  return <OnboardingSurvey />;
}
