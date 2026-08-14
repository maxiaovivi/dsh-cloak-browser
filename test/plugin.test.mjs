import assert from "node:assert/strict";
import test from "node:test";
import { createCloakBrowserPlugin } from "../lib/plugin.mjs";

const ITEMS = [{
  index: 0,
  tag: "button",
  role: "button",
  name: "Continue",
  type: "",
  href: "",
  disabled: false,
  checked: null
}];

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

function harness() {
  const tools = new Map();
  const listeners = new Map();
  const attachments = {
    imageLimits: { mediaTypes: ["image/jpeg", "image/png"] },
    async saveImage({ data, mediaType, name }) {
      return { attachmentId: "image-1", mediaType, bytes: data.byteLength, width: 100, height: 80, name };
    }
  };
  return {
    ctx: {
      tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
      attachments,
      get(name) {
        if (name === "attachments") return attachments;
        if (name === "llm") return { resolveModelInfo: async () => ({ inputModalities: ["text", "image"] }) };
        return undefined;
      },
      on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name); },
      effect(execute) { const dispose = execute(); return async () => dispose?.(); }
    },
    tools,
    listeners
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
