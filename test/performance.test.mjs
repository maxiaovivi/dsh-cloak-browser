import assert from "node:assert/strict";
import test from "node:test";
import { takePageSnapshot } from "../lib/snapshot.mjs";

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

test("snapshot projection stays bounded with 500 interactive elements", async () => {
  const rawItems = Array.from({ length: 500 }, (_value, index) => ({
    index,
    tag: "button",
    role: "button",
    name: `Action ${index + 1}`,
    type: "",
    href: "",
    disabled: false,
    checked: null
  }));
  const interactive = { evaluateAll: async () => rawItems };
  const body = { innerText: async () => "page text ".repeat(5000) };
  const page = {
    locator(selector) { return selector === "body" ? body : interactive; },
    url: () => "https://example.com/large",
    title: async () => "Large page"
  };

  const samples = [];
  let latest;
  for (let sequence = 1; sequence <= 25; sequence += 1) {
    const startedAt = performance.now();
    latest = await takePageSnapshot(page, "p1", sequence, { maxElements: 100, maxTextChars: 12000 });
    samples.push(performance.now() - startedAt);
  }

  assert.equal(latest.value.elements.length, 100);
  assert.equal(latest.value.elementsTruncated, true);
  assert.equal(latest.value.text.length, 12000);
  assert.equal(latest.value.textTruncated, true);
  assert.ok(percentile(samples, 0.95) < 250, `snapshot projection P95 was ${percentile(samples, 0.95).toFixed(2)} ms`);
});
