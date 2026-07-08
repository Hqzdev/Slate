import { AuthPage } from "@/components/AuthPage";

export default function LoginPage() {
  return (
    <AuthPage
      mode="login"
      title="Sign in to Slate"
      subtitle="Your workspace is where you left it."
      submitLabel="Sign in"
      submittingLabel="Signing in..."
      footerText="New to Slate?"
      footerHref="/register"
      footerLabel="Create an account"
    />
  );
}
