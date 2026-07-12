import { AuthPage } from "@/components/AuthPage";
import { redirect } from "next/navigation";
import { authService } from "@/lib/server/auth";

type LoginPageProps = {
  searchParams: Promise<{
    invite?: string | string[];
    next?: string | string[];
  }>;
};

function getSingleSearchParameter(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

function getAuthenticatedRedirectPath(invite: string | null, next: string | null, onboardingCompletedAt: Date | null) {
  if (!onboardingCompletedAt) return "/onboarding";
  if (invite) return `/invite/${encodeURIComponent(invite)}`;
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/workspace";
  if (next === "/login" || next.startsWith("/login?") || next === "/register" || next.startsWith("/register?")) return "/workspace";
  return next;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [user, parameters] = await Promise.all([authService.getCurrentUser(), searchParams]);
  if (user) {
    redirect(getAuthenticatedRedirectPath(
      getSingleSearchParameter(parameters.invite),
      getSingleSearchParameter(parameters.next),
      user.onboardingCompletedAt
    ));
  }

  return (
    <AuthPage
      mode="login"
      title={
        <>
          Return to your <span>shared room</span>.
        </>
      }
      subtitle="Sign in to continue with the code, decisions, and activity your team kept together."
      submitLabel="Sign in"
      submittingLabel="Signing in..."
      footerText="New to Slate?"
      footerHref="/register"
      footerLabel="Create an account"
    />
  );
}
