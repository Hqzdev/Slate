import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { ClientIpAddressResolver } from "../lib/server/clientIpAddress";

test("development accepts a normalized forwarded address", () => {
  const resolver = new ClientIpAddressResolver({ NODE_ENV: "development" });
  const request = new NextRequest("https://slate.test", { headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.4" } });
  assert.equal(resolver.resolve(request), "203.0.113.8");
});

test("production accepts only the explicitly configured proxy header", () => {
  const resolver = new ClientIpAddressResolver({ NODE_ENV: "production", TRUSTED_PROXY_CLIENT_IP_HEADER: "cf-connecting-ip" });
  const request = new NextRequest("https://slate.test", {
    headers: { "cf-connecting-ip": "2001:db8::1", "x-forwarded-for": "203.0.113.8" }
  });
  assert.equal(resolver.resolve(request), "2001:db8::1");
  assert.equal(resolver.isProductionConfigured(), true);
});

test("production rejects unconfigured and malformed forwarded identity", () => {
  const unconfigured = new ClientIpAddressResolver({ NODE_ENV: "production" });
  const malformed = new ClientIpAddressResolver({ NODE_ENV: "production", TRUSTED_PROXY_CLIENT_IP_HEADER: "x-real-ip" });
  assert.equal(unconfigured.resolve(new NextRequest("https://slate.test", { headers: { "x-forwarded-for": "203.0.113.8" } })), null);
  assert.equal(unconfigured.isProductionConfigured(), false);
  assert.equal(malformed.resolve(new NextRequest("https://slate.test", { headers: { "x-real-ip": "forged" } })), null);
});
