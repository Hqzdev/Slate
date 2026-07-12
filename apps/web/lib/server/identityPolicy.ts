export type PasswordStrength = "strong" | "weak";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string) {
  return emailPattern.test(value) && value.length <= 254;
}

export function isValidUsername(value: string) {
  return usernamePattern.test(value);
}

export function getPasswordValidationError(password: string, identifiers: string[]) {
  if (password.length < 12 || password.length > 128) return "Password must be between 12 and 128 characters";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) return "Password must include uppercase, lowercase, number, and symbol";
  const normalizedPassword = password.toLowerCase();
  if (identifiers.some((identifier) => identifier.length >= 3 && normalizedPassword.includes(identifier.toLowerCase()))) return "Password cannot contain your email or username";
  if (/(.)\1{3,}/.test(password) || /password|qwerty|123456|letmein/i.test(password)) return "Choose a less predictable password";
  return null;
}

export function passwordStrength(password: string, identifiers: string[]) : PasswordStrength {
  return getPasswordValidationError(password, identifiers) ? "weak" : "strong";
}
