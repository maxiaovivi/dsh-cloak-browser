# dsh-cloak-browser

English | [简体中文](./README.zh-CN.md)

## Install

### Requirements

- Node.js 20 or newer
- [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) `0.1.0-rc.6`
- Linux, macOS, or Windows on a platform supported by CloakBrowser

### Install directly from GitHub

```bash
dsh plugin --profile web add -w github:maxiaovivi/dsh-cloak-browser

# Confirm that the bundle was composed into the profile.
dsh --profile web --dump-config | grep -A24 cloak-browser
```

Restart DSH after installation:

```bash
dsh --profile web
```

`-w` is required because a DSH profile is a pnpm workspace root. Replace `web`
with another profile name if that profile provides the DSH `tools` and
`attachments` services.

### Install from a local clone

Use this path when developing or auditing the plugin:

```bash
git clone https://github.com/maxiaovivi/dsh-cloak-browser.git
cd dsh-cloak-browser
npm ci

# Ubuntu/Debian only; this may request sudo permission.
npx playwright-core install-deps chromium

dsh plugin --profile web add -w "$PWD"
dsh --profile web --dump-config | grep -A24 cloak-browser
dsh --profile web
```

The GitHub installation installs package dependencies through pnpm. A local
link requires `npm ci` in the cloned directory so Node can resolve its runtime
dependencies.

### License and proxy environment

Do not put credentials in `cordis.patch.yml` or tool arguments. Export them in
the environment that starts DSH:

```bash
export CLOAKBROWSER_LICENSE_KEY='your-license-key'       # optional
export CLOAKBROWSER_PROXY_URL='http://user:pass@host:port' # optional
dsh --profile web
```

Without a license key, CloakBrowser selects its available free build. On first
browser use it downloads and verifies a roughly 200 MB Chromium archive. The
extracted cache can use substantially more disk space under `~/.cloakbrowser`.
You do **not** need `playwright install chromium`.

### Uninstall

```bash
dsh plugin --profile web remove -w dsh-cloak-browser
```

Restart DSH after removal. Browser binaries cached under `~/.cloakbrowser` are
managed separately by the CloakBrowser CLI.

## What this project is

`dsh-cloak-browser` is an independent, community-maintained native browser
tool bundle for DeepSeek Harness. It connects two upstream products:

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) provides
  the Cordis plugin runtime, Agent loop, tool pipeline, model routing, and
  durable attachment store.
- [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) provides the
  Playwright-compatible Chromium launcher, source-level fingerprint patches,
  optional humanized input, proxy/GeoIP integration, and browser binary
  distribution.

This repository is not an official DeepSeek or CloakHQ project and is not
affiliated with or endorsed by either organization.

The integration is deliberately thin:

```text
DSH native Tool → per-Agent BrowserContext map → CloakBrowser → Playwright
```

There is no MCP server, separate middleware process, remote browser service, or
model-supplied JavaScript evaluator. The small session map is retained because
browser state must survive across tool calls and must not leak between Agents.

## Features

- Native DSH tools with schemas, canonical JSON results, UI presentation, and
  Code Mode compatibility.
- Lazy browser startup: Chromium starts only when an Agent calls a browser tool.
- One isolated BrowserContext per Agent, automatically closed on
  `agent/disposed` or plugin unload.
- Bounded page snapshots with short-lived element references such as
  `p1:s3:e8`; stale references fail closed after page mutations.
- Navigation, click, fill, select, keyboard, wait, extraction, screenshot, tab,
  and lifecycle tools.
- Durable DSH image attachments for image-capable models and text snapshot
  fallback for text-only routes.
- Optional humanized mouse, typing, and scrolling through CloakBrowser.
- Ephemeral contexts by default and per-Agent persistent profile directories
  when explicitly enabled.
- Domain allow/deny rules, explicit local/private-address blocking, page and
  output limits, cooperative cancellation, and browser cleanup.
- A resident routing prompt that selects the browser for rendered or
  interactive tasks while keeping simple public-text lookups on lighter web
  search/fetch tools.

## Tools and Agent workflow

Recommended flow:

```text
browser_open / browser_navigate
  → browser_snapshot
  → browser_click / browser_type / browser_select
  → browser_snapshot again after the page changes
  → browser_close when the browser task is complete
```

| Tool | Purpose |
|---|---|
| `browser_open` | Lazily open the current Agent's browser session |
| `browser_navigate` | Navigate the active tab to an allowed URL |
| `browser_snapshot` | Return bounded page text and interactive element refs |
| `browser_click` | Click a ref from the latest snapshot |
| `browser_type` | Fill a textbox and optionally press Enter |
| `browser_select` | Select an option in a `<select>` element |
| `browser_press` | Press a bounded set of navigation keys |
| `browser_wait` | Wait for text or for a short interval |
| `browser_extract` | Extract bounded text, HTML, or an attribute without arbitrary JS |
| `browser_screenshot` | Attach an image on vision routes or return metadata on text routes |
| `browser_tabs` | List, select, or close tabs |
| `browser_close` | Close and forget the current Agent's browser session |

The resident prompt routes requests containing actions such as open, browse,
click, fill, submit, log in, inspect rendered state, or capture a webpage to
`browser_*`. Simple public-text research remains on web search/fetch until real
rendering or interaction is required.

Example request:

```text
Use the browser to open https://example.com, inspect the rendered page, list
the interactive elements, and close the browser when finished.
```

## Configuration

The default Bundle configuration is in [`cordis.patch.yml`](./cordis.patch.yml).

| Setting | Default | Description |
|---|---:|---|
| `headless` | `true` | Run Chromium without a visible window |
| `humanize` | `true` | Enable CloakBrowser humanized interactions |
| `humanPreset` | `default` | `default` or `careful` behavior preset |
| `geoip` | `false` | Derive locale/timezone from the proxy IP when supported |
| `proxyEnv` | `CLOAKBROWSER_PROXY_URL` | Name of the environment variable containing the proxy URL |
| `persistentProfileRoot` | empty | Root for hashed per-Agent persistent profiles |
| `allowedDomains` | `[]` | Empty permits public hosts; supports exact and `*.example.com` patterns |
| `blockedDomains` | `[]` | Host patterns denied before the allowlist |
| `blockPrivateNetworks` | `true` | Block explicit localhost, private, link-local, and reserved IP URLs |
| `maxPages` | `5` | Maximum tabs per Agent session |
| `actionTimeoutMs` | `15000` | Ordinary Playwright action timeout |
| `navigationTimeoutMs` | `30000` | Navigation timeout |
| `maxSnapshotElements` | `100` | Maximum refs returned by a snapshot |
| `maxTextChars` | `12000` | Maximum returned page/extraction text |
| `screenshotFormat` | `jpeg` | `jpeg` or `png` |
| `screenshotQuality` | `80` | JPEG quality |
| `routePrompt` | `true` | Install browser-selection guidance in the system prompt |

For production automation, restrict navigations in your profile override:

```yaml
- id: cloak-browser
  config:
    allowedDomains:
      - 'example.com'
      - '*.example.com'
    blockedDomains:
      - 'admin.example.com'
    persistentProfileRoot: '/var/lib/dsh/cloak-profiles'
```

Keep profile, fingerprint, proxy, timezone, and locale consistent for the same
site identity. Never give an Agent your everyday Chrome profile.

## Security boundaries

- `browser_type.text` is recorded in DSH tool logs. Do not pass passwords, API
  keys, cookies, or tokens through it. A credential-store-backed input tool is
  intentionally outside the current release.
- Page content is untrusted input and is explicitly described that way to the
  Agent; it must not override system or user instructions.
- `allowedDomains` applies to top-level navigations. It is an application guard,
  not a complete network sandbox. DNS rebinding and page subresources require
  container/firewall enforcement in high-assurance deployments.
- The plugin blocks model-supplied arbitrary JavaScript evaluation.
- Use only on systems and websites you are authorized to automate, and follow
  applicable law and site terms.

## Upstream licensing

The code in this repository is released under the [MIT License](./LICENSE).

CloakBrowser's wrapper source is MIT-licensed, but the Chromium binary it
downloads is distributed under CloakHQ's separate
[Binary License](https://github.com/CloakHQ/CloakBrowser/blob/main/BINARY-LICENSE.md).
Review that license before redistribution, reverse engineering, binary
modification, or offering a customer-controlled Browser-as-a-Service product.

## Compatibility and validation

The current release pins:

| Component | Version |
|---|---|
| DeepSeek Harness packages | `0.1.0-rc.6` |
| CloakBrowser wrapper | `0.5.7` |
| Playwright Core | `1.62.0` |
| Node.js | `>=20` |

Validation performed for this release:

- Unit tests for domain policy, private-host rejection, snapshot refs, stale-ref
  rejection, per-Agent isolation, attachment output, and cleanup.
- A clean temporary DSH Web profile installation and full Cordis/Web startup.
- A real free-tier CloakBrowser Chromium launch, navigation to
  `https://example.com`, and DOM snapshot extraction on Linux x64.
- `npm audit`, syntax checks, and npm package dry-run.

Run local checks with:

```bash
npm run check
npm test
npm audit --omit=dev
npm pack --dry-run
```

The tests use a fake BrowserContext and do not download Chromium.
