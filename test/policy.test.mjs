import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedUrl, domainMatches, isPrivateHostname } from "../lib/policy.mjs";

test("domain patterns support exact hosts and wildcard subdomains", () => {
  assert.equal(domainMatches("example.com", "example.com"), true);
  assert.equal(domainMatches("www.example.com", "*.example.com"), true);
  assert.equal(domainMatches("example.com", "*.example.com"), true);
  assert.equal(domainMatches("notexample.com", "*.example.com"), false);
});

test("private and local hosts are detected", () => {
  for (const host of ["localhost", "service.local", "127.0.0.1", "10.1.2.3", "172.20.1.1", "192.168.1.1", "::1", "fd00::1"]) {
    assert.equal(isPrivateHostname(host), true, host);
  }
  assert.equal(isPrivateHostname("example.com"), false);
  assert.equal(isPrivateHostname("8.8.8.8"), false);
});

test("URL policy enforces protocols, credentials and domain rules", () => {
  const policy = { allowedDomains: ["*.example.com"], blockedDomains: ["admin.example.com"], blockPrivateNetworks: true };
  assert.equal(assertAllowedUrl("https://www.example.com/path", policy).hostname, "www.example.com");
  assert.throws(() => assertAllowedUrl("https://admin.example.com", policy), /blocked/);
  assert.throws(() => assertAllowedUrl("https://example.net", policy), /outside allowedDomains/);
  assert.throws(() => assertAllowedUrl("file:///etc/passwd", policy), /only http/);
  assert.throws(() => assertAllowedUrl("https://user:secret@example.com", policy), /credentials/);
  assert.throws(() => assertAllowedUrl("http://127.0.0.1:8080", { allowedDomains: [], blockedDomains: [] }), /private\/local/);
});
