#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { binaryInfo } from "cloakbrowser";
import { SessionMap, buildCloakLaunchOptions, normalizeConfig } from "../lib/plugin.mjs";
import { detectorsForSuite } from "./detectors.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseOptions() {
  if (process.argv.includes("--help")) {
    console.log(`Usage: node stealth/run.mjs [options]

Options:
  --suite local|public|full       local signals; public detectors; or scored services (default: public)
  --profile baseline|hardened    current defaults or upstream-aligned test settings (default: baseline)
  --adapter plugin|upstream      plugin SessionMap or direct launchContext control (default: plugin)
  --detectors ID,ID              run only selected detector IDs from the chosen suite
  --headed                       run with a visible browser (recommended with Xvfb on Linux)
  --headless                     force headless mode (default)
  --output DIRECTORY             evidence directory (default: stealth/results/<timestamp>-<profile>)
  --no-screenshots               do not capture detector screenshots
  --strict                       exit non-zero on fail/error/inconclusive

Proxy credentials are read only from CLOAKBROWSER_TEST_PROXY.
Optional hardened settings: CLOAKBROWSER_TEST_FINGERPRINT_SEED and
CLOAKBROWSER_TEST_WINDOWS_FONT_METRICS=1.`);
    process.exit(0);
  }
  const suite = valueAfter("--suite") ?? "public";
  const profile = valueAfter("--profile") ?? "baseline";
  const adapter = valueAfter("--adapter") ?? "plugin";
  const detectorIds = valueAfter("--detectors")?.split(",").map((value) => value.trim()).filter(Boolean);
  if (!new Set(["local", "public", "full"]).has(suite)) throw new Error("--suite must be local, public, or full");
  if (!new Set(["baseline", "hardened"]).has(profile)) throw new Error("--profile must be baseline or hardened");
  if (!new Set(["plugin", "upstream"]).has(adapter)) throw new Error("--adapter must be plugin or upstream");
  const headless = !process.argv.includes("--headed");
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return {
    suite,
    profile,
    adapter,
    detectorIds,
    headless: process.argv.includes("--headless") ? true : headless,
    screenshots: !process.argv.includes("--no-screenshots"),
    strict: process.argv.includes("--strict"),
    output: resolve(valueAfter("--output") ?? `stealth/results/${stamp}-${profile}`)
  };
}

function majorVersion(version) {
  const value = Number.parseInt(String(version).split(".")[0], 10);
  return Number.isFinite(value) ? value : 0;
}

function testConfig(options, binary) {
  const proxyConfigured = Boolean(process.env.CLOAKBROWSER_TEST_PROXY);
  const hardened = options.profile === "hardened";
  const supports148 = majorVersion(binary.version) >= 148;
  const windowsFontMetrics = hardened && supports148 && process.env.CLOAKBROWSER_TEST_WINDOWS_FONT_METRICS === "1";
  return normalizeConfig({
    routePrompt: false,
    headless: options.headless,
    humanize: true,
    geoip: proxyConfigured,
    proxyEnv: "CLOAKBROWSER_TEST_PROXY",
    navigationTimeoutMs: 60000,
    actionTimeoutMs: 30000,
    maxPages: 5,
    fingerprintNoise: !hardened,
    ...(hardened ? {
      fingerprintSeed: process.env.CLOAKBROWSER_TEST_FINGERPRINT_SEED ?? "dsh-cloak-stealth-test-v1",
      fingerprintWindowsFontMetrics: windowsFontMetrics,
      allowThirdPartyCookies: supports148 && options.suite === "full"
    } : {})
  });
}

function safeBinaryInfo(info) {
  return {
    wrapper: info.wrapper,
    version: info.version,
    bundledVersion: info.bundledVersion,
    installedVersion: info.installedVersion,
    tier: info.tier,
    platform: info.platform,
    installed: info.installed
  };
}

async function runDetector(page, detector, options) {
  process.stdout.write(`  ${detector.name} ... `);
  const started = performance.now();
  let response;
  try {
    response = await page.goto(detector.url, { waitUntil: "domcontentloaded", timeout: detector.timeoutMs });
    const evidence = await detector.collect(page);
    const verdict = detector.classify(evidence);
    const screenshot = options.screenshots ? `${detector.id}.png` : undefined;
    if (screenshot) await page.screenshot({ path: resolve(options.output, screenshot), fullPage: true, type: "png", timeout: detector.timeoutMs });
    const durationMs = Number((performance.now() - started).toFixed(1));
    console.log(`${verdict.status.toUpperCase()} (${durationMs} ms) — ${verdict.summary}`);
    return {
      id: detector.id,
      name: detector.name,
      url: detector.url,
      finalUrl: page.url(),
      tier: detector.tier,
      httpStatus: response?.status() ?? null,
      durationMs,
      screenshot,
      ...verdict
    };
  } catch (error) {
    const durationMs = Number((performance.now() - started).toFixed(1));
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.log(`ERROR (${durationMs} ms) — ${message}`);
    return {
      id: detector.id,
      name: detector.name,
      url: detector.url,
      finalUrl: page.url(),
      tier: detector.tier,
      httpStatus: response?.status() ?? null,
      durationMs,
      status: "error",
      summary: message,
      layer: "unknown",
      evidence: {}
    };
  }
}

async function main() {
  const options = parseOptions();
  const binary = binaryInfo();
  const config = testConfig(options, binary);
  const suiteDetectors = detectorsForSuite(options.suite);
  const detectors = options.detectorIds ? suiteDetectors.filter((detector) => options.detectorIds.includes(detector.id)) : suiteDetectors;
  if (options.detectorIds) {
    const found = new Set(detectors.map((detector) => detector.id));
    const missing = options.detectorIds.filter((id) => !found.has(id));
    if (missing.length > 0) throw new Error(`detector IDs are not in the ${options.suite} suite: ${missing.join(", ")}`);
  }
  await mkdir(options.output, { recursive: true, mode: 0o700 });

  console.log("CloakBrowser plugin stealth test");
  console.log(`  suite=${options.suite} profile=${options.profile} adapter=${options.adapter} mode=${options.headless ? "headless" : "headed"}`);
  console.log(`  binary=${binary.version} tier=${binary.tier} proxy=${process.env.CLOAKBROWSER_TEST_PROXY ? "configured" : "none"}`);
  console.log(`  evidence=${options.output}`);

  let sessions;
  let directContext;
  const startedAt = new Date();
  const results = [];
  let fingerprint = null;
  try {
    let page;
    if (options.adapter === "plugin") {
      sessions = new SessionMap(config, () => import("cloakbrowser"));
      const agent = { id: `stealth-${options.profile}` };
      const session = await sessions.get(agent, new AbortController().signal);
      page = await session.page();
    } else {
      const api = await import("cloakbrowser");
      directContext = await api.launchContext(buildCloakLaunchOptions(config));
      page = directContext.pages()[0] ?? await directContext.newPage();
      directContext.setDefaultTimeout(config.actionTimeoutMs);
      directContext.setDefaultNavigationTimeout(config.navigationTimeoutMs);
    }
    for (const detector of detectors) {
      const detectorResult = await runDetector(page, detector, options);
      results.push(detectorResult);
      if (detector.id === "local-signals") fingerprint = detectorResult.evidence;
    }
  } finally {
    await sessions?.closeAll();
    await directContext?.close().catch(() => {});
  }

  const counts = Object.fromEntries(["pass", "fail", "inconclusive", "error"].map((status) => [status, results.filter((item) => item.status === status).length]));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    method: options.adapter === "plugin" ? "CloakBrowser upstream-equivalent public detector suite through dsh-cloak-browser SessionMap" : "Control run through CloakBrowser launchContext without dsh-cloak-browser SessionMap",
    options: {
      suite: options.suite,
      profile: options.profile,
      adapter: options.adapter,
      detectors: detectors.map((detector) => detector.id),
      headless: options.headless,
      screenshots: options.screenshots,
      proxyConfigured: Boolean(process.env.CLOAKBROWSER_TEST_PROXY),
      geoip: config.geoip,
      fingerprintSeedConfigured: Boolean(config.fingerprintSeed),
      fingerprintNoise: config.fingerprintNoise,
      fingerprintWindowsFontMetrics: config.fingerprintWindowsFontMetrics,
      allowThirdPartyCookies: config.allowThirdPartyCookies,
      viewport: config.viewportWidth > 0 ? { width: config.viewportWidth, height: config.viewportHeight } : "automatic"
    },
    environment: {
      node: process.version,
      os: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model ?? "unknown",
      binary: safeBinaryInfo(binary)
    },
    fingerprint,
    summary: { total: results.length, ...counts },
    results
  };
  await writeFile(resolve(options.output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`Summary: ${counts.pass} pass, ${counts.fail} fail, ${counts.inconclusive} inconclusive, ${counts.error} error`);
  console.log(`Report: ${resolve(options.output, "report.json")}`);
  if (options.strict && (counts.fail > 0 || counts.error > 0 || counts.inconclusive > 0)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
