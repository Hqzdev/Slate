import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const keyLength = 64;

export class PasswordService {
  async hash(password: string) {
    const salt = randomBytes(16).toString("base64url");
    const derivedKey = await scryptAsync(password, salt, keyLength);
    return `${salt}:${Buffer.from(derivedKey as Buffer).toString("base64url")}`;
  }

  async verify(password: string, storedHash: string) {
    const [salt, key] = storedHash.split(":");
    if (!salt || !key) return false;

    const storedKey = Buffer.from(key, "base64url");
    const derivedKey = await scryptAsync(password, salt, storedKey.length);
    return timingSafeEqual(storedKey, Buffer.from(derivedKey as Buffer));
  }
}

export const passwordService = new PasswordService();
