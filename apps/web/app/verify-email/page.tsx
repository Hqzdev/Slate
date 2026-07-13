import { EmailVerificationPage } from "@/components/EmailVerificationPage";
import { redirect } from "next/navigation";
import { authService } from "@/lib/server/auth";
import { emailVerificationPolicy } from "@/lib/server/emailVerificationPolicy";

export default async function VerifyEmailPage() {
  const user = await authService.getCurrentUser();
  if (user && (!emailVerificationPolicy.isRequired() || user.emailVerifiedAt)) redirect(user.onboardingCompletedAt ? "/workspace" : "/onboarding");
  return <EmailVerificationPage />;
}
