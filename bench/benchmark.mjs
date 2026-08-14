import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { cpus, platform, release, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { createCloakBrowserPlugin } from "../lib/plugin.mjs";

const jsonOnly = process.argv.includes("--json");
const humanize = !process.argv.includes("--no-humanize");
const sampleCount = Math.max(3, Number.parseInt(process.env.BENCH_SAMPLES ?? "5", 10));

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const round = (value) => Number(value.toFixed(2));
  return {
    samples: sorted.length,
    minMs: round(sorted[0]),
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    maxMs: round(sorted[sorted.length - 1]),
    meanMs: round(sum / sorted.length)
  };
}

async function timed(operation) {
  const startedAt = performance.now();
  const value = await operation();
  return { value, milliseconds: performance.now() - startedAt };
}

async function sample(operation, count = sampleCount) {
  const values = [];
  let lastValue;
  for (let index = 0; index < count; index += 1) {
    const result = await timed(operation);
    values.push(result.milliseconds);
    lastValue = result.value;
  }
  return { stats: stats(values), value: lastValue };
}

function processTreeRssBytes() {
  if (platform() !== "linux") return undefined;
  try {
    const output = execFileSync("ps", ["-eo", "pid=,ppid=,rss="], { encoding: "utf8" });
    const rows = output.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
    const children = new Map();
    const rss = new Map();
    for (const [pid, parent, kilobytes] of rows) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(pid);
      rss.set(pid, kilobytes * 1024);
    }
    const queue = [process.pid];
    const visited = new Set();
    let total = 0;
    while (queue.length > 0) {
      const pid = queue.shift();
      if (visited.has(pid)) continue;
      visited.add(pid);
      total += rss.get(pid) ?? 0;
      queue.push(...(children.get(pid) ?? []));
    }
    return total;
  } catch {
    return undefined;
  }
}

function benchmarkHtml(buttons = 300) {
  const controls = Array.from({ length: buttons }, (_value, index) => `<button type="button" onclick="document.querySelector('#count').textContent=String(Number(document.querySelector('#count').textContent)+1)">Action ${index + 1}</button>`).join("");
  const text = "Rendered benchmark content ".repeat(800);
  return `<!doctype html><html><head><title>DSH Cloak benchmark</title><style>body{font-family:sans-serif}button{margin:2px}</style></head><body><label>Query <input aria-label="Query"></label><label>Region <select aria-label="Region"><option value="id">Indonesia</option><option value="sg">Singapore</option></select></label><span id="count">0</span>${controls}<main>${text}</main></body></html>`;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function createHarness() {
  const tools = new Map();
  const attachments = {
    imageLimits: { mediaTypes: ["image/jpeg", "image/png"] },
    async saveImage({ data, mediaType, name }) {
      return { attachmentId: "benchmark-image", mediaType, bytes: data.byteLength, width: 1280, height: 720, name };
    }
  };
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
    attachments,
    get(name) {
      if (name === "attachments") return attachments;
      if (name === "llm") return { resolveModelInfo: async () => ({ inputModalities: ["text", "image"] }) };
      return undefined;
    },
    on() { return () => {}; },
    effect(execute) { const dispose = execute(); return async () => dispose?.(); }
  };
  return { ctx, tools };
}

function agent(id) {
  return {
    id,
    options: { provider: "benchmark", model: "vision" },
    session: { requestHeader: () => ({ config: { provider: "benchmark", model: "vision" } }) }
  };
}

function execFor(subject) {
  return { agent: subject, signal: new AbortController().signal, deferContext() {} };
}

async function main() {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(benchmarkHtml());
  });
  const address = await listen(server);
  const targetUrl = `http://127.0.0.1:${address.port}`;
  const { ctx, tools } = createHarness();
  const plugin = createCloakBrowserPlugin();
  plugin.apply(ctx, {
    routePrompt: false,
    headless: true,
    humanize,
    geoip: false,
    blockPrivateNetworks: false,
    allowedDomains: ["127.0.0.1"],
    maxSnapshotElements: 100,
    maxTextChars: 12000
  });

  const memoryBefore = processTreeRssBytes();
  const launchSamples = [];
  let activeAgent;
  try {
    for (let index = 0; index < 3; index += 1) {
      activeAgent = agent(`benchmark-${index}`);
      const exec = execFor(activeAgent);
      const opened = await timed(() => tools.get("browser_open").execute({}, exec));
      launchSamples.push(opened.milliseconds);
      if (index < 2) await tools.get("browser_close").execute({}, exec);
    }

    const exec = execFor(activeAgent);
    const navigate = await timed(() => tools.get("browser_navigate").execute({ url: targetUrl }, exec));
    const memoryOpen = processTreeRssBytes();

    const snapshot = await sample(() => tools.get("browser_snapshot").execute({ max_elements: 100 }, exec));
    const extract = await sample(() => tools.get("browser_extract").execute({ kind: "text", max_chars: 12000 }, exec));
    const screenshot = await sample(() => tools.get("browser_screenshot").execute({ full_page: false }, exec), Math.min(5, sampleCount));
    const clickWorkflow = await sample(async () => {
      const before = await tools.get("browser_snapshot").execute({ max_elements: 100 }, exec);
      const button = before.elements.find((element) => element.role === "button");
      await tools.get("browser_click").execute({ ref: button.ref }, exec);
      return tools.get("browser_snapshot").execute({ max_elements: 100 }, exec);
    }, Math.min(3, sampleCount));
    const typeWorkflow = await sample(async () => {
      const before = await tools.get("browser_snapshot").execute({ max_elements: 100 }, exec);
      const textbox = before.elements.find((element) => element.role === "textbox");
      return tools.get("browser_type").execute({ ref: textbox.ref, text: "benchmark-value" }, exec);
    }, Math.min(3, sampleCount));

    await tools.get("browser_close").execute({}, exec);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const memoryClosed = processTreeRssBytes();
    const { binaryInfo } = await import("cloakbrowser");
    const binary = await binaryInfo();

    const result = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      environment: {
        platform: `${platform()} ${release()}`,
        architecture: process.arch,
        node: process.version,
        cpu: cpus()[0]?.model ?? "unknown",
        logicalCpus: cpus().length,
        totalMemoryBytes: totalmem(),
        cloakBrowserVersion: binary.version,
        cloakBrowserTier: binary.tier,
        binaryWasCached: binary.installed
      },
      workload: {
        localHttp: true,
        humanize,
        domInteractiveElements: 302,
        snapshotElementCap: 100,
        textCharacterCap: 12000,
        samples: sampleCount
      },
      metrics: {
        lazyBrowserOpen: stats(launchSamples),
        firstLazyBrowserOpenMs: Number(launchSamples[0].toFixed(2)),
        subsequentBrowserOpen: stats(launchSamples.slice(1)),
        localNavigationMs: Number(navigate.milliseconds.toFixed(2)),
        pageSnapshot: snapshot.stats,
        snapshotElementsReturned: snapshot.value.elements.length,
        textExtraction: extract.stats,
        extractedCharacters: extract.value.content.length,
        viewportScreenshot: screenshot.stats,
        screenshotBytes: screenshot.value.image?.bytes ?? screenshot.value.bytes,
        snapshotClickSnapshotWorkflow: clickWorkflow.stats,
        snapshotTypeWorkflow: typeWorkflow.stats,
        processTreeRssBytes: {
          before: memoryBefore,
          browserOpen: memoryOpen,
          afterClose: memoryClosed,
          browserDelta: memoryBefore === undefined || memoryOpen === undefined ? undefined : memoryOpen - memoryBefore,
          retainedAfterClose: memoryBefore === undefined || memoryClosed === undefined ? undefined : memoryClosed - memoryBefore
        }
      },
      notes: [
        "The browser binary was already downloaded; download time is excluded.",
        "Navigation targets a local HTTP server, so public-network latency is excluded.",
        "Process-tree RSS is an approximate Linux snapshot and includes Node plus Chromium descendants.",
        "Timings are end-to-end plugin tool-body timings and exclude LLM inference and the outer DSH policy/log pipeline."
      ]
    };

    if (jsonOnly) console.log(JSON.stringify(result, null, 2));
    else {
      console.log("dsh-cloak-browser benchmark");
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    if (activeAgent) await tools.get("browser_close").execute({}, execFor(activeAgent)).catch(() => {});
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

await main();
