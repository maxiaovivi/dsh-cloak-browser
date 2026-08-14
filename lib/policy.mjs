import { isIP } from "node:net";

function normalizeHostname(hostname) {
  const lower = String(hostname).trim().toLowerCase();
  return lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
}

function domainMatches(hostname, pattern) {
  const host = normalizeHostname(hostname);
  const candidate = normalizeHostname(pattern).replace(/^\.+|\.+$/g, "");
  if (candidate === "*") return true;
  if (candidate.startsWith("*.")) {
    const suffix = candidate.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return host === candidate;
}

function isPrivateIpv4(hostname) {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPrivateIpv6(hostname) {
  const host = normalizeHostname(hostname);
  if (host === "::" || host === "::1") return true;
  if (host.startsWith("::ffff:")) return isPrivateIpv4(host.slice(7));
  const first = Number.parseInt(host.split(":", 1)[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    host.startsWith("2001:db8:")
  );
}

export function isPrivateHostname(hostname) {
  const host = normalizeHostname(hostname).replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const kind = isIP(host);
  if (kind === 4) return isPrivateIpv4(host);
  if (kind === 6) return isPrivateIpv6(host);
  return false;
}

export function assertAllowedUrl(rawUrl, policy = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new Error(`invalid URL: ${rawUrl}`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`only http:// and https:// URLs are allowed: ${rawUrl}`);
  if (url.username || url.password) throw new Error("credentials in browser URLs are not allowed; configure proxy/site credentials outside tool arguments");

  const hostname = normalizeHostname(url.hostname);
  const blocked = policy.blockedDomains ?? [];
  if (blocked.some((pattern) => domainMatches(hostname, pattern))) throw new Error(`navigation to ${hostname} is blocked by browser policy`);
  const allowed = policy.allowedDomains ?? [];
  if (allowed.length > 0 && !allowed.some((pattern) => domainMatches(hostname, pattern))) {
    throw new Error(`navigation to ${hostname} is outside allowedDomains`);
  }
  if ((policy.blockPrivateNetworks ?? true) && isPrivateHostname(hostname)) {
    throw new Error(`navigation to private/local host ${hostname} is blocked`);
  }
  return url;
}

export { domainMatches };
