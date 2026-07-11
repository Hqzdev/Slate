import { AuthPage } from "@/components/AuthPage";

export default function LoginPage() {
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
