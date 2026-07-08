import { AuthPage } from "@/components/AuthPage";

export default function RegisterPage() {
  return (
    <AuthPage
      mode="register"
      title="Create your account"
      subtitle="We'll set up your first workspace with an editor, a canvas, and a sandbox as soon as you're in."
      submitLabel="Create account"
      submittingLabel="Creating workspace..."
      footerText="Already have an account?"
      footerHref="/login"
      footerLabel="Sign in"
    />
  );
}
