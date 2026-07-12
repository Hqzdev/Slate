import { isIP } from "node:net";
import { NextRequest } from "next/server";

const supportedHeaders = new Set(["cf-connecting-ip", "x-forwarded-for", "x-real-ip"]);

export class ClientIpAddressResolver {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = process.env) {}

  resolve(request: NextRequest | undefined) {
    if (!request) return null;
    const header = this.configuredHeader();
    if (!header) return null;
    const raw = request.headers.get(header);
    if (!raw) return null;
    const value = header === "x-forwarded-for" ? raw.split(",", 1)[0]?.trim() : raw.trim();
    return value && isIP(value) !== 0 ? value : null;
  }

  isProductionConfigured() {
    return this.environment.NODE_ENV !== "production" || this.configuredHeader() !== null;
  }

  private configuredHeader() {
    const configured = this.environment.TRUSTED_PROXY_CLIENT_IP_HEADER?.trim().toLowerCase();
    if (configured && supportedHeaders.has(configured)) return configured;
    if (this.environment.NODE_ENV === "production") return null;
    return "x-forwarded-for";
  }
}

export const clientIpAddressResolver = new ClientIpAddressResolver();
