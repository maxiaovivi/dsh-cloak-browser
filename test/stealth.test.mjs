import assert from "node:assert/strict";
import test from "node:test";
import {
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
} from "../stealth/detectors.mjs";

test("local classifier enforces the six upstream automation signals", () => {
  const evidence = {
    webdriver: false,
    userAgent: "Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36",
    windowChromeType: "object",
    plugins: 5,
    languages: ["en-US"],
    cdpGlobals: []
  };
  assert.equal(classifyLocal(evidence).status, "pass");
  assert.equal(classifyLocal({ ...evidence, webdriver: true }).status, "fail");
});

test("detector parsers never turn missing content into a pass", () => {
  assert.equal(classifySannysoft({ total: 0, failed: [] }).status, "inconclusive");
  assert.equal(classifyIncolumitas({ total: 0, passed: 0, failedTests: [] }).status, "inconclusive");
  assert.equal(classifyRebrowser({ total: 0, totalFails: 0, failing: [] }).status, "inconclusive");
  assert.equal(classifyBrowserScan({ normal: 0, abnormal: 0 }).status, "inconclusive");
  assert.equal(classifyDeviceAndBrowserInfo({ isBot: null, checks: {} }).status, "inconclusive");
  assert.equal(classifyCreepJs({ totalLies: null }).status, "inconclusive");
  assert.equal(classifyFingerprintJs({ isBlocked: false, hasFlights: false }).status, "inconclusive");
  assert.equal(classifyRecaptcha({ score: null }).status, "inconclusive");
});

test("Device & Browser Info reports every parsed true detail flag", () => {
  const verdict = classifyDeviceAndBrowserInfo({
    isBot: true,
    checks: { isBot: true, hasWebdriverTrue: false, hasInconsistentTimingResolution: true }
  });
  assert.equal(verdict.status, "fail");
  assert.deepEqual(verdict.evidence.flagged, ["hasInconsistentTimingResolution"]);
});

test("scored detectors do not overstate missing scores or new block wording", () => {
  assert.equal(classifyFingerprintScan({ score: null, botTests: { WebDriver: false } }).status, "inconclusive");
  assert.equal(classifyFingerprintJs({ isBlocked: true, hasFlights: false }).status, "fail");
});

test("Incolumitas separates documented network/false-positive signals", () => {
  const knownOnly = classifyIncolumitas({ total: 32, passed: 30, failed: 2, failedTests: ["WEBDRIVER", "connectionRTT"] });
  assert.equal(knownOnly.status, "pass");
  assert.deepEqual(knownOnly.evidence.unexpected, []);
  const unexpected = classifyIncolumitas({ total: 32, passed: 31, failed: 1, failedTests: ["permissions"] });
  assert.equal(unexpected.status, "fail");
});

test("suite selection keeps scored/reputation services opt-in", () => {
  assert.deepEqual(detectorsForSuite("local").map((item) => item.tier), ["local"]);
  assert.equal(detectorsForSuite("public").every((item) => item.tier !== "scored"), true);
  assert.equal(detectorsForSuite("full").some((item) => item.id === "recaptcha-v3"), true);
});
