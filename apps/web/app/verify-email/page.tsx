import { EmailVerificationPage } from "@/components/EmailVerificationPage";
import { redirect } from "next/navigation";
import { authService } from "@/lib/server/auth";

export default async function VerifyEmailPage() {
  const user = await authService.getCurrentUser();
  if (user?.emailVerifiedAt) redirect(user.onboardingCompletedAt ? "/workspace" : "/onboarding");
  return <EmailVerificationPage />;
}
