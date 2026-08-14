import assert from "node:assert/strict";
import test from "node:test";
import { buildCloakLaunchOptions, createCloakBrowserPlugin, normalizeConfig } from "../lib/plugin.mjs";

const ITEMS = [
  {
    index: 0,
    tag: "button",
    role: "button",
    name: "Continue",
    type: "",
    href: "",
    disabled: false,
    checked: null
  },
  {
    index: 1,
    tag: "input",
    role: "textbox",
    name: "Search",
    type: "text",
    href: "",
    disabled: false,
    checked: null
  },
  {
    index: 2,
    tag: "select",
    role: "combobox",
    name: "Region",
    type: "",
    href: "",
    disabled: false,
    checked: null
  }
];

class FakeLocator {
  constructor(page, kind, index = 0) {
    this.page = page;
    this.kind = kind;
    this.index = index;
  }

  async evaluateAll() { return ITEMS; }
  nth(index) { return new FakeLocator(this.page, "interactive", index); }
  async evaluate() {
    const item = ITEMS[this.index];
    return { tag: item.tag, role: item.role, name: item.name };
  }
  async scrollIntoViewIfNeeded() {}
  async click() { this.page.clicks += 1; }
  async fill(text) { this.page.filled = text; }
  async press(key) { this.page.lastKey = key; }
  async selectOption(value) { this.page.selected = value; return [value]; }
  async innerText() { return this.kind === "body" ? "Example body" : "Continue"; }
  async innerHTML() { return this.kind === "body" ? "<main>Example body</main>" : "Continue"; }
  async getAttribute(name) { return name === "role" ? "button" : null; }
}

class FakePage {
  constructor() {
    this.currentUrl = "about:blank";
    this.closed = false;
    this.clicks = 0;
    this.filled = "";
    this.selected = "";
    this.lastKey = "";
    this.keyboard = { press: async (key) => { this.lastKey = key; } };
  }

  locator(selector) { return new FakeLocator(this, selector === "body" ? "body" : "interactive"); }
  async goto(url) { this.currentUrl = url; }
  url() { return this.currentUrl; }
  async title() { return this.currentUrl === "about:blank" ? "Blank" : "Example"; }
  isClosed() { return this.closed; }
  async close() { this.closed = true; }
  async bringToFront() {}
  async waitForTimeout() {}
  getByText() { return { first: () => ({ waitFor: async () => {} }) }; }
  async screenshot() { return Buffer.from("fake-jpeg"); }
}

class FakeContext {
  constructor() {
    this.page = new FakePage();
    this.items = [this.page];
    this.handlers = new Map();
    this.closed = false;
  }

  pages() { return this.items; }
  on(name, callback) { this.handlers.set(name, callback); }
  async newPage() {
    const page = new FakePage();
    this.items.push(page);
    this.handlers.get("page")?.(page);
    return page;
  }
  async route(_pattern, handler) { this.routeHandler = handler; }
  setDefaultTimeout(value) { this.defaultTimeout = value; }
  setDefaultNavigationTimeout(value) { this.navigationTimeout = value; }
  async close() { this.closed = true; for (const page of this.items) page.closed = true; }
}

function harness(options = {}) {
  const tools = new Map();
  const listeners = new Map();
  let savedImages = 0;
  const attachments = {
    imageLimits: { mediaTypes: ["image/jpeg", "image/png"] },
    async saveImage({ data, mediaType, name }) {
      savedImages += 1;
      return { attachmentId: "image-1", mediaType, bytes: data.byteLength, width: 100, height: 80, name };
    }
  };
  return {
    ctx: {
      tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
      attachments,
      get(name) {
        if (name === "attachments") return attachments;
        if (name === "llm") return { resolveModelInfo: async () => ({ inputModalities: options.modalities ?? ["text", "image"] }) };
        return undefined;
      },
      on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name); },
      effect(execute) { const dispose = execute(); return async () => dispose?.(); }
    },
    tools,
    listeners,
    savedImages: () => savedImages
  };
}

function agent(id) {
  return {
    id,
    options: { provider: "test", model: "vision" },
    session: { requestHeader: () => ({ config: { provider: "test", model: "vision" } }) }
  };
}

function execFor(subject, extra = {}) {
  return { agent: subject, signal: new AbortController().signal, deferContext() {}, ...extra };
}

test("stealth configuration maps to constrained CloakBrowser launch options", () => {
  const config = normalizeConfig({
    headless: false,
    geoip: true,
    proxyEnv: "TEST_PROXY",
    fingerprintSeed: "returning-visitor-42",
    fingerprintNoise: false,
    fingerprintWindowsFontMetrics: true,
    allowThirdPartyCookies: true,
    fingerprintStorageQuotaMb: 5000,
    viewportWidth: 1920,
    viewportHeight: 1080
  });
  assert.deepEqual(buildCloakLaunchOptions(config, { TEST_PROXY: "socks5://proxy.example:1080" }), {
    headless: false,
    humanize: true,
    humanPreset: "default",
    geoip: true,
    releaseChannel: "stable",
    proxy: "socks5://proxy.example:1080",
    args: [
      "--fingerprint=returning-visitor-42",
      "--fingerprint-noise=false",
      "--fingerprint-windows-font-metrics",
      "--fingerprint-allow-3p-cookies",
      "--fingerprint-storage-quota=5000",
      "--fingerprint-screen-width=1920",
      "--fingerprint-screen-height=1080"
    ],
    viewport: { width: 1920, height: 1080 }
  });
  assert.throws(() => normalizeConfig({ fingerprintSeed: "bad=value" }), /fingerprintSeed/);
  assert.throws(() => normalizeConfig({ viewportWidth: 1920, viewportHeight: 0 }), /must both/);
});

test("plugin defaults disable detectable fingerprint noise without forcing a viewport", () => {
  const options = buildCloakLaunchOptions(normalizeConfig());
  assert.equal(options.args.includes("--fingerprint-noise=false"), true);
  assert.equal("viewport" in options, false);
});

test("plugin exposes a compact native browser tool set and uses snapshot refs", async () => {
  const created = [];
  const { ctx, tools } = harness();
  const plugin = createCloakBrowserPlugin({ browserApiLoader: async () => ({
    launchContext: async () => { const context = new FakeContext(); created.push(context); return context; }
  }) });
  plugin.apply(ctx, { routePrompt: false, allowedDomains: ["example.com"] });

  assert.deepEqual([...tools.keys()].sort(), [
    "browser_click", "browser_close", "browser_extract", "browser_navigate", "browser_open", "browser_press",
    "browser_screenshot", "browser_select", "browser_snapshot", "browser_tabs", "browser_type", "browser_wait"
  ]);
  assert.equal(tools.get("browser_type").timeoutMs, 90000);

  const subject = agent("agent-a");
  const exec = execFor(subject);
  const opened = await tools.get("browser_open").execute({ url: "https://example.com" }, exec);
  assert.equal(opened.url, "https://example.com");
  assert.equal(created.length, 1);

  const snapshot = await tools.get("browser_snapshot").execute({}, exec);
  assert.equal(snapshot.elements[0].ref, "p1:s1:e1");
  const clicked = await tools.get("browser_click").execute({ ref: snapshot.elements[0].ref }, exec);
  assert.equal(clicked.status, "clicked");
  assert.equal(created[0].page.clicks, 1);
  await assert.rejects(tools.get("browser_click").execute({ ref: snapshot.elements[0].ref }, exec), /stale/);

  const screenshot = await tools.get("browser_screenshot").execute({}, exec);
  assert.equal(screenshot.attached, true);
  assert.equal(screenshot.image.attachmentId, "image-1");

  assert.deepEqual(await tools.get("browser_close").execute({}, exec), { closed: true });
  assert.equal(created[0].closed, true);
});

test("browser sessions are isolated by Agent and disposed with the Agent", async () => {
  const created = [];
  const { ctx, tools, listeners } = harness();
  const plugin = createCloakBrowserPlugin({ browserApiLoader: async () => ({
    launchContext: async () => { const context = new FakeContext(); created.push(context); return context; }
  }) });
  plugin.apply(ctx, { routePrompt: false });

  const first = agent("first");
  const second = agent("second");
  await tools.get("browser_open").execute({}, execFor(first));
  await tools.get("browser_open").execute({}, execFor(second));
  assert.equal(created.length, 2);

  await listeners.get("agent/disposed")({ agent: first });
  assert.equal(created[0].closed, true);
  assert.equal(created[1].closed, false);
});

test("interaction, extraction and tab tools preserve the snapshot contract", async () => {
  const created = [];
  const { ctx, tools } = harness();
  const plugin = createCloakBrowserPlugin({ browserApiLoader: async () => ({
    launchContext: async () => { const context = new FakeContext(); created.push(context); return context; }
  }) });
  plugin.apply(ctx, { routePrompt: false });
  const exec = execFor(agent("interactions"));
  await tools.get("browser_open").execute({}, exec);

  let snapshot = await tools.get("browser_snapshot").execute({}, exec);
  const textbox = snapshot.elements.find((element) => element.role === "textbox");
  await tools.get("browser_type").execute({ ref: textbox.ref, text: "query", submit: true }, exec);
  assert.equal(created[0].page.filled, "query");
  assert.equal(created[0].page.lastKey, "Enter");

  snapshot = await tools.get("browser_snapshot").execute({}, exec);
  const select = snapshot.elements.find((element) => element.role === "combobox");
  await tools.get("browser_select").execute({ ref: select.ref, value: "id" }, exec);
  assert.equal(created[0].page.selected, "id");

  await tools.get("browser_press").execute({ key: "Escape" }, exec);
  assert.equal(created[0].page.lastKey, "Escape");
  const extracted = await tools.get("browser_extract").execute({ kind: "text", max_chars: 7 }, exec);
  assert.equal(extracted.content, "Example");
  assert.equal(extracted.truncated, true);

  const secondPage = await created[0].newPage();
  secondPage.currentUrl = "https://second.example";
  let tabs = await tools.get("browser_tabs").execute({ action: "list" }, exec);
  assert.equal(tabs.tabs.length, 2);
  const firstPageId = tabs.tabs.find((tab) => tab.url === "about:blank").pageId;
  tabs = await tools.get("browser_tabs").execute({ action: "select", page_id: firstPageId }, exec);
  assert.equal(tabs.tabs.find((tab) => tab.pageId === firstPageId).active, true);
  await tools.get("browser_tabs").execute({ action: "close", page_id: firstPageId }, exec);
  assert.equal(created[0].page.closed, true);
  await tools.get("browser_close").execute({}, exec);
});

test("text-only routes return screenshot metadata without storing an attachment", async () => {
  const created = [];
  const harnessState = harness({ modalities: ["text"] });
  const plugin = createCloakBrowserPlugin({ browserApiLoader: async () => ({
    launchContext: async () => { const context = new FakeContext(); created.push(context); return context; }
  }) });
  plugin.apply(harnessState.ctx, { routePrompt: false });
  const exec = execFor(agent("text-model"));
  const result = await harnessState.tools.get("browser_screenshot").execute({}, exec);
  assert.equal(result.attached, false);
  assert.match(result.reason, /does not declare image input/);
  assert.equal(harnessState.savedImages(), 0);
  await harnessState.tools.get("browser_close").execute({}, exec);
});

test("an abort during lazy launch closes the newly created BrowserContext", async () => {
  let context;
  const { ctx, tools } = harness();
  const plugin = createCloakBrowserPlugin({ browserApiLoader: async () => ({
    launchContext: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      context = new FakeContext();
      return context;
    }
  }) });
  plugin.apply(ctx, { routePrompt: false });
  const controller = new AbortController();
  const pending = tools.get("browser_open").execute({}, { agent: agent("aborted"), signal: controller.signal, deferContext() {} });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(context.closed, true);
});
