const KNOWN_INCOLOMITAS_NETWORK_SIGNALS = new Set(["WEBDRIVER", "connectionRTT"]);

function result(status, summary, evidence, layer = "browser") {
  return { status, summary, layer, evidence };
}

function trueKeys(values = {}) {
  return Object.entries(values).filter(([, value]) => value === true).map(([key]) => key);
}

function classifyLocal(evidence) {
  const checks = {
    navigatorWebdriverFalse: evidence.webdriver === false,
    noHeadlessChromeUa: typeof evidence.userAgent === "string" && evidence.userAgent.includes("Chrome/") && !evidence.userAgent.includes("HeadlessChrome"),
    windowChromeObject: evidence.windowChromeType === "object",
    pluginsPresent: Number.isInteger(evidence.plugins) && evidence.plugins >= 5,
    languagesPresent: Array.isArray(evidence.languages) && evidence.languages.length >= 1,
    noCdpGlobals: Array.isArray(evidence.cdpGlobals) && evidence.cdpGlobals.length === 0
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return result(failed.length === 0 ? "pass" : "fail", failed.length === 0 ? "6/6 local automation signals passed" : `failed: ${failed.join(", ")}`, { ...evidence, checks, failed });
}

function classifySannysoft(evidence) {
  if (!Number.isInteger(evidence.total) || evidence.total < 5) return result("inconclusive", `expected a result table, parsed ${evidence.total ?? 0} rows`, evidence);
  return result(evidence.failed.length === 0 ? "pass" : "fail", evidence.failed.length === 0 ? `${evidence.total}/${evidence.total} checks passed` : `${evidence.total - evidence.failed.length}/${evidence.total}; failed: ${evidence.failed.join(", ")}`, evidence);
}

function classifyIncolumitas(evidence) {
  if (!Number.isInteger(evidence.total) || evidence.total < 30) return result("inconclusive", `expected at least 30 stable results, parsed ${evidence.total ?? 0}`, evidence);
  const knownNetworkOrUpstream = evidence.failedTests.filter((name) => KNOWN_INCOLOMITAS_NETWORK_SIGNALS.has(name));
  const unexpected = evidence.failedTests.filter((name) => !KNOWN_INCOLOMITAS_NETWORK_SIGNALS.has(name));
  const status = unexpected.length === 0 ? "pass" : "fail";
  const suffix = [
    unexpected.length > 0 ? `unexpected: ${unexpected.join(", ")}` : "no unexpected failures",
    knownNetworkOrUpstream.length > 0 ? `separately classified: ${knownNetworkOrUpstream.join(", ")}` : ""
  ].filter(Boolean).join("; ");
  return result(status, `${evidence.passed}/${evidence.total}; ${suffix}`, { ...evidence, knownNetworkOrUpstream, unexpected });
}

function classifyRebrowser(evidence) {
  if (!Number.isInteger(evidence.total) || evidence.total === 0) return result("inconclusive", evidence.error ?? "detections-json was empty", evidence);
  return result(evidence.totalFails === 0 ? "pass" : "fail", evidence.totalFails === 0 ? `${evidence.passed} passed, ${evidence.notTriggered} not triggered, 0 failed` : `failed: ${evidence.failing.join(", ")}`, evidence);
}

function classifyBrowserScan(evidence) {
  if ((evidence.normal ?? 0) + (evidence.abnormal ?? 0) === 0) return result("inconclusive", "could not parse Normal/Abnormal verdicts", evidence);
  return result(evidence.abnormal === 0 ? "pass" : "fail", `Normal: ${evidence.normal}, Abnormal: ${evidence.abnormal}`, evidence);
}

function classifyDeviceAndBrowserInfo(evidence) {
  if (typeof evidence.isBot !== "boolean") return result("inconclusive", "could not parse isBot", evidence);
  const flagged = trueKeys(evidence.checks).filter((name) => name !== "isBot");
  return result(!evidence.isBot && flagged.length === 0 ? "pass" : "fail", !evidence.isBot && flagged.length === 0 ? "isBot=false; all parsed flags false" : `isBot=${evidence.isBot}; flagged: ${flagged.join(", ") || "none"}`, { ...evidence, flagged });
}

function classifyCreepJs(evidence) {
  if (!Number.isInteger(evidence.totalLies)) return result("inconclusive", evidence.error ?? "CreepJS fingerprint was not ready", evidence);
  return result(evidence.totalLies === 0 ? "pass" : "fail", `lies: ${evidence.totalLies}; like-headless: ${evidence.likeHeadlessPct ?? "N/A"}%; headless: ${evidence.headlessPct ?? "N/A"}%; stealth: ${evidence.stealthPct ?? "N/A"}%`, evidence);
}

function classifyFingerprintJs(evidence) {
  if (evidence.isBlocked) return result("fail", "FingerprintJS demo reported a blocked/bot visit", evidence, "browser+network");
  if (evidence.hasFlights) return result("pass", "flight results rendered without a bot/block message", evidence, "browser+network");
  return result("inconclusive", "neither a block verdict nor flight results could be parsed", evidence, "browser+network");
}

function classifyRecaptcha(evidence) {
  if (typeof evidence.score !== "number") return result("inconclusive", "could not parse a reCAPTCHA v3 score", evidence, "browser+network+reputation");
  return result(evidence.score >= 0.7 ? "pass" : "fail", `score: ${evidence.score} (upstream threshold: 0.7)`, evidence, "browser+network+reputation");
}

function classifyFingerprintScan(evidence) {
  const values = Object.values(evidence.botTests ?? {});
  if (values.length === 0) return result("inconclusive", `Castle score: ${evidence.score ?? "not rendered"}; bot-test rows were not parsed`, evidence, "browser+network");
  const failed = Object.entries(evidence.botTests).filter(([, value]) => value === true).map(([key]) => key);
  if (!evidence.score && failed.length === 0) return result("inconclusive", "parsed bot flags were false, but the Castle risk score did not render", { ...evidence, failed }, "browser+network");
  return result(failed.length === 0 ? "pass" : "fail", `Castle score: ${evidence.score ?? "not rendered"}; ${failed.length === 0 ? "all parsed bot flags false" : `failed: ${failed.join(", ")}`}`, { ...evidence, failed }, "browser+network");
}

async function poll(page, collect, ready, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  let evidence;
  do {
    evidence = await page.evaluate(collect);
    if (ready(evidence)) return evidence;
    await page.waitForTimeout(intervalMs);
  } while (Date.now() < deadline);
  return evidence;
}

const local = {
  id: "local-signals",
  name: "Local automation signals",
  url: "https://example.com/",
  tier: "local",
  timeoutMs: 30000,
  classify: classifyLocal,
  collect: (page) => page.evaluate(async () => {
    let highEntropy = null;
    try {
      highEntropy = await navigator.userAgentData?.getHighEntropyValues(["fullVersionList", "platform", "platformVersion"]);
    } catch {}
    const gl = document.createElement("canvas").getContext("webgl");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      webdriver: navigator.webdriver,
      userAgent: navigator.userAgent,
      highEntropy,
      windowChromeType: typeof window.chrome,
      plugins: navigator.plugins.length,
      languages: [...navigator.languages],
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory ?? null,
      screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight },
      viewport: { width: innerWidth, height: innerHeight, outerWidth, outerHeight },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      gpuVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      gpuRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      cdpGlobals: Object.keys(window).filter((key) => key.startsWith("cdc_") || key.startsWith("__webdriver"))
    };
  })
};

const sannysoft = {
  id: "sannysoft",
  name: "SannySoft Bot Test",
  url: "https://bot.sannysoft.com/",
  tier: "public",
  timeoutMs: 45000,
  classify: classifySannysoft,
  collect: (page) => poll(page, () => {
    const rows = [...document.querySelectorAll("table tr")];
    const parsed = rows.map((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 2) return null;
      return { key: cells[0].innerText.trim(), value: cells[1].innerText.trim().slice(0, 300), failed: (cells[1].className || "").includes("failed") };
    }).filter(Boolean);
    return { total: parsed.length, failed: parsed.filter((item) => item.failed).map((item) => item.key), rows: parsed };
  }, (value) => value.total >= 5, 15000)
};

const incolumitas = {
  id: "incolumitas",
  name: "Incolumitas Bot Detector",
  url: "https://bot.incolumitas.com/",
  tier: "public",
  timeoutMs: 60000,
  classify: classifyIncolumitas,
  collect: async (page) => {
    let lastTotal = -1;
    let stable = 0;
    return poll(page, () => {
      const text = document.body.innerText;
      const ok = [...text.matchAll(/"([\w-]+)":\s*"OK"/g)].map((match) => match[1]);
      const failedTests = [...text.matchAll(/"([\w-]+)":\s*"FAIL"/g)].map((match) => match[1]);
      return { passed: ok.length, failed: failedTests.length, failedTests, total: ok.length + failedTests.length };
    }, (value) => {
      stable = value.total >= 30 && value.total === lastTotal ? stable + 1 : 0;
      lastTotal = value.total;
      return stable >= 1;
    }, 35000, 2000);
  }
};

const rebrowser = {
  id: "rebrowser",
  name: "Rebrowser Bot Detector",
  url: "https://bot-detector.rebrowser.net/",
  tier: "public",
  timeoutMs: 50000,
  classify: classifyRebrowser,
  collect: (page) => poll(page, () => {
    const element = document.getElementById("detections-json");
    if (!element) return { failing: [], totalFails: 0, passed: 0, notTriggered: 0, total: 0, error: "no detections-json element" };
    try {
      const tests = JSON.parse(element.value);
      const failing = tests.filter((test) => test.rating === 1).map((test) => test.type);
      return { failing, totalFails: failing.length, passed: tests.filter((test) => test.rating === -1).length, notTriggered: tests.filter((test) => test.rating === 0).length, total: tests.length };
    } catch (error) {
      return { failing: [], totalFails: 0, passed: 0, notTriggered: 0, total: 0, error: String(error) };
    }
  }, (value) => value.total > 0, 20000)
};

const browserScan = {
  id: "browserscan",
  name: "BrowserScan Bot Detection",
  url: "https://www.browserscan.net/bot-detection",
  tier: "public",
  timeoutMs: 50000,
  classify: classifyBrowserScan,
  collect: (page) => poll(page, () => {
    const text = document.body.innerText;
    return { normal: (text.match(/\bNormal\b/g) ?? []).length, abnormal: (text.match(/\bAbnormal\b/g) ?? []).length, excerpt: text.slice(0, 1000) };
  }, (value) => value.normal + value.abnormal > 0, 20000)
};

const deviceAndBrowserInfo = {
  id: "device-and-browser-info",
  name: "Device & Browser Info",
  url: "https://deviceandbrowserinfo.com/are_you_a_bot",
  tier: "public",
  timeoutMs: 50000,
  classify: classifyDeviceAndBrowserInfo,
  collect: (page) => poll(page, () => {
    const text = document.body.innerText;
    const checks = {};
    for (const match of text.matchAll(/"([A-Za-z][A-Za-z0-9]*)":\s*(true|false)/g)) checks[match[1]] = match[2] === "true";
    return { isBot: typeof checks.isBot === "boolean" ? checks.isBot : null, checks, excerpt: text.slice(0, 3000) };
  }, (value) => typeof value.isBot === "boolean", 25000)
};

const creepJs = {
  id: "creepjs",
  name: "CreepJS lies",
  url: "https://abrahamjuliot.github.io/creepjs/",
  tier: "scored",
  timeoutMs: 70000,
  classify: classifyCreepJs,
  collect: (page) => poll(page, () => {
    const fingerprint = window.Fingerprint;
    const text = document.body.innerText;
    if (!fingerprint) return { totalLies: null, error: "Fingerprint not ready" };
    const number = (regex) => {
      const match = text.match(regex);
      return match ? Number.parseInt(match[1], 10) : null;
    };
    return {
      totalLies: Number.isInteger(fingerprint.lies?.totalLies) ? fingerprint.lies.totalLies : 0,
      likeHeadlessPct: number(/(\d+)%\s*like headless/i),
      headlessPct: number(/(\d+)%\s*headless:/i),
      stealthPct: number(/(\d+)%\s*stealth:/i),
      platformEstimate: fingerprint.platformEstimate ?? null,
      signals: fingerprint.headless ?? null
    };
  }, (value) => Number.isInteger(value.totalLies), 50000, 2000)
};

const fingerprintJs = {
  id: "fingerprintjs-demo",
  name: "FingerprintJS scraping demo",
  url: "https://demo.fingerprint.com/web-scraping",
  tier: "scored",
  timeoutMs: 60000,
  classify: classifyFingerprintJs,
  collect: async (page) => {
    await page.waitForTimeout(5000);
    try {
      await page.getByRole("button", { name: /search/i }).first().click({ timeout: 5000 });
    } catch {}
    return poll(page, () => {
      const text = document.body.innerText;
      const lower = text.toLowerCase();
      return {
        hasFlights: text.includes("Price per adult") || /\$\s*\d/.test(text),
        isBlocked: lower.includes("request was blocked") || lower.includes("bot visit detected") || lower.includes("access denied") || lower.includes("anti-detect browser tampering") || lower.includes("potentially a bot"),
        excerpt: text.slice(0, 1500)
      };
    }, (value) => value.hasFlights || value.isBlocked, 15000);
  }
};

const recaptcha = {
  id: "recaptcha-v3",
  name: "reCAPTCHA v3 score demo",
  url: "https://recaptcha-demo.appspot.com/recaptcha-v3-request-scores.php",
  tier: "scored",
  timeoutMs: 70000,
  classify: classifyRecaptcha,
  collect: (page) => poll(page, () => {
    const text = document.body.innerText;
    const match = text.match(/"score":\s*(\d+(?:\.\d+)?)/);
    return { score: match ? Number.parseFloat(match[1]) : null };
  }, (value) => typeof value.score === "number", 30000, 2000)
};

const fingerprintScan = {
  id: "fingerprint-scan",
  name: "fingerprint-scan.com",
  url: "https://fingerprint-scan.com/",
  tier: "scored",
  timeoutMs: 70000,
  classify: classifyFingerprintScan,
  collect: async (page) => {
    await page.waitForTimeout(20000);
    return page.evaluate(() => {
      const text = document.body.innerText;
      const botTests = {};
      for (const key of ["WebDriver", "Is Selenium Chrome", "CDP Check", "Is Playwright"]) {
        const match = text.match(new RegExp(`${key}\\s+(true|false)`, "i"));
        if (match) botTests[key] = match[1].toLowerCase() === "true";
      }
      return {
        score: document.getElementById("fingerprintScore")?.textContent?.trim() || null,
        botTests,
        signals: {
          noTaskbar: screen.height === screen.availHeight,
          noContentIndex: typeof window.ContentIndex === "undefined",
          noContactsManager: !("contacts" in navigator),
          noDownlinkMax: !("downlinkMax" in (navigator.connection || {})),
          webdriver: navigator.webdriver,
          isPlaywright: "__pwInitScripts" in window || "__playwright__binding__" in window,
          webgpu: typeof navigator.gpu !== "undefined",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }
      };
    });
  }
};

const DETECTORS = Object.freeze([local, sannysoft, incolumitas, rebrowser, browserScan, deviceAndBrowserInfo, creepJs, fingerprintScan, fingerprintJs, recaptcha]);

function detectorsForSuite(suite) {
  if (suite === "local") return DETECTORS.filter((detector) => detector.tier === "local");
  if (suite === "public") return DETECTORS.filter((detector) => detector.tier !== "scored");
  if (suite === "full") return [...DETECTORS];
  throw new Error(`unknown suite "${suite}"; expected local, public, or full`);
}

export {
  DETECTORS,
  classifyBrowserScan,
  classifyCreepJs,
  classifyDeviceAndBrowserInfo,
  classifyFingerprintJs,
  classifyFingerprintScan,
  classifyIncolumitas,
  classifyLocal,
  classifyRecaptcha,
  classifyRebrowser,
  classifySannysoft,
  detectorsForSuite
};
