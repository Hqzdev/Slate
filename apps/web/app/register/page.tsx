import { AuthPage } from "@/components/AuthPage";

export default function RegisterPage() {
  return (
    <AuthPage
      mode="register"
      title={
        <>
          Create one room for <span>work and context</span>.
        </>
      }
      subtitle="Your first workspace starts with an editor, canvas, and sandbox ready to share."
      submitLabel="Create account"
      submittingLabel="Creating workspace..."
      footerText="Already have an account?"
      footerHref="/login"
      footerLabel="Sign in"
    />
  );
}
