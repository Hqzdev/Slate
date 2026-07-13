export class EmailVerificationPolicy {
  constructor(private readonly configuredValue: () => string | undefined = () => process.env.EMAIL_VERIFICATION_REQUIRED) {}

  isRequired() {
    return this.configuredValue()?.trim().toLowerCase() !== "false";
  }
}

export const emailVerificationPolicy = new EmailVerificationPolicy();
