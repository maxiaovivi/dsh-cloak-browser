import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { launchContext } from "cloakbrowser";
import { expectedFingerprint, inspectInteractiveLocator, INTERACTIVE_SELECTOR, takePageSnapshot } from "../lib/snapshot.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

test("real CloakBrowser launches, renders, snapshots and screenshots", { timeout: 60_000 }, async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end("<!doctype html><title>DSH benchmark</title><main><button>Continue</button><input aria-label='Query'><p>Rendered locally</p></main>");
  });
  const address = await listen(server);
  const startedAt = performance.now();
  const context = await launchContext({ headless: true, humanize: true, geoip: false });
  const launchMs = performance.now() - startedAt;
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "domcontentloaded" });
    const snapshotStartedAt = performance.now();
    const snapshot = await takePageSnapshot(page, "p1", 1, { maxElements: 20, maxTextChars: 2000 });
    const snapshotMs = performance.now() - snapshotStartedAt;
    const screenshot = await page.screenshot({ type: "jpeg", quality: 80 });

    assert.equal(snapshot.value.title, "DSH benchmark");
    assert.match(snapshot.value.text, /Rendered locally/);
    assert.equal(snapshot.value.elements.length, 2);
    const buttonRef = snapshot.value.elements.find((element) => element.role === "button").ref;
    const buttonEntry = snapshot.refs.get(buttonRef);
    const inspectedButton = await inspectInteractiveLocator(page.locator(INTERACTIVE_SELECTOR).nth(buttonEntry.index));
    assert.equal(inspectedButton.fingerprint, expectedFingerprint(buttonEntry));
    assert.ok(screenshot.byteLength > 1000);
    assert.ok(launchMs < 30_000, `cached launch took ${launchMs.toFixed(1)} ms`);
    assert.ok(snapshotMs < 5_000, `snapshot took ${snapshotMs.toFixed(1)} ms`);
  } finally {
    await context.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
