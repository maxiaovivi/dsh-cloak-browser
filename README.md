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

Version 0.1.1 and newer reuse the profile's existing `dsh-tools` and `dsh-llm`
runtime instances. This prevents the duplicate-runtime error reported as
`Cannot read properties of undefined (reading 'prepare')`.

If version 0.1.0 was previously installed, remove it once before reinstalling:

```bash
dsh plugin --profile web remove -w dsh-cloak-browser
dsh plugin --profile web add -w github:maxiaovivi/dsh-cloak-browser
```

### Install from a local clone

Use this path when developing or auditing the plugin:

```bash
git clone https://github.com/maxiaovivi/dsh-cloak-browser.git
cd dsh-cloak-browser
npm ci
plugin_tarball=$(npm pack --silent)

# Ubuntu/Debian only; this may request sudo permission.
npx playwright-core install-deps chromium

dsh plugin --profile web add -w "$PWD/$plugin_tarball"
dsh --profile web --dump-config | grep -A24 cloak-browser
dsh --profile web
```

The GitHub installation installs package dependencies through pnpm. The local
workflow installs a packed artifact rather than linking the development tree,
so development-only copies of DSH host packages cannot enter the profile.

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

When a saved or environment license validates as the **Free plan**, the plugin
defaults to an available seat and launches without asking the user. It
serializes concurrent Free-session launches inside one DSH process and reports
local or license-server occupancy without retrying in a loop. It cannot revoke
a session owned by another machine or an abnormal prior process; that
server-side lease must close or expire upstream.

When a proxy URL is present, the plugin enables CloakBrowser GeoIP matching
automatically. Its first use may also download the approximately 70 MB GeoLite
database into the same cache; `mmdb-lib` is already included, so there is no
separate install command.

### Uninstall

```bash
dsh plugin --profile web remove -w dsh-cloak-browser
```

Restart DSH after removal. Browser binaries cached under `~/.cloakbrowser` are
managed separately by the CloakBrowser CLI.

## See it in DSH

This real DSH session opened Wikipedia, discovered the search field from a
bounded snapshot, submitted `CloakBrowser`, verified the result page, captured
a screenshot, and closed the browser. The complete Agent run took 15 seconds.

### End-to-end Agent workflow

![DSH Agent completing a CloakBrowser workflow from open through close](./assets/screenshots/01-agent-browser-workflow.png)

### Structured result-page state with stable element refs

![browser_snapshot returning the Wikipedia result page and bounded element refs](./assets/screenshots/03-structured-page-refs.png)

### Public anti-automation detector demo

In a separate real DSH session, the Agent opened Rebrowser's public bot
detector, waited for the checks, confirmed the rendered results, and closed the
browser. A separate reproducible Pro 150 runner captured the detector page and
reported 5 passed, 3 not triggered, and 0 failed checks. This is evidence for
that public detector only, not a claim that every production anti-bot system
can be bypassed.

![Rebrowser result from CloakBrowser Pro 150 with no failed checks](./assets/screenshots/05-rebrowser-pro-150-result.png)

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
- Automatic bounded page snapshots after navigation and interaction, with
  short-lived element references such as `p1:s3:e8`. Agents can continue from
  the returned state without a separate observation call.
- Snapshot and interaction support for controls inside attached iframes, plus
  form states such as selected, expanded, required, invalid, and read-only.
- Navigation, click, fill, select, keyboard, wait, extraction, screenshot, tab,
  and lifecycle tools.
- Durable DSH image attachments for image-capable models and text snapshot
  fallback for text-only routes.
- Optional humanized mouse, typing, and scrolling through CloakBrowser.
- One automatic retry for CloakBrowser's specific pre-action
  `covered by <none>` false positive during click/fill; other failures still
  fail closed.
- Stable per-Agent fingerprint seeds when no seed is configured explicitly.
- Automatic license-plan detection: validated Free keys launch without user
  confirmation, while concurrent local Free-session launches are serialized.
- Proxy-aware GeoIP consistency enabled automatically when the proxy
  environment variable is present; its runtime dependency is bundled.
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
browser_open(url)
  → Free, paid, or keyless: launches directly without asking
  → occupied Free seat: returns not_started without retrying in a loop
  → returns snapshot + refs
  → browser_click / browser_type / browser_select → returns next snapshot + refs
  → browser_close when the browser task is complete
```

The default flow needs no manual `browser_snapshot` between actions. The
explicit snapshot tool remains available when a page changes independently or
an Agent wants to refresh its view.

| Tool | Purpose |
|---|---|
| `browser_open` | Lazily open the session without user confirmation; with a URL, also return a snapshot |
| `browser_navigate` | Navigate and return a fresh snapshot with refs |
| `browser_snapshot` | Explicitly refresh bounded page/frame text and refs |
| `browser_click` | Click a ref and return the next snapshot |
| `browser_type` | Fill a textbox, optionally submit, and return the next snapshot |
| `browser_select` | Select an option and return the next snapshot |
| `browser_press` | Press a bounded navigation key and return the next snapshot |
| `browser_wait` | Wait for text/time and return the resulting snapshot |
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
| `geoip` | `auto` | Automatically derive locale/timezone when `proxyEnv` is set; accepts `true` or `false` overrides |
| `proxyEnv` | `CLOAKBROWSER_PROXY_URL` | Name of the environment variable containing the proxy URL |
| `persistentProfileRoot` | empty | Root for hashed per-Agent persistent profiles |
| `fingerprintSeed` | empty | Empty derives a stable, hashed per-Agent seed automatically; an explicit seed overrides it |
| `fingerprintNoise` | `false` | Disable injected canvas/WebGL/audio/client-rect noise; this removed five CreepJS lies in the documented test |
| `fingerprintWindowsFontMetrics` | `false` | Enable Chromium 148+ Windows font metrics; requires a real Windows font set on Linux |
| `allowThirdPartyCookies` | `false` | Chromium 148+ compatibility switch for embedded reCAPTCHA/SSO/payment flows |
| `fingerprintStorageQuotaMb` | `0` | Optional storage quota override; `0` keeps the upstream automatic value |
| `viewportWidth`, `viewportHeight` | `0`, `0` | Optional matching viewport and fingerprint screen size; `0` keeps safer automatic handling |
| `allowedDomains` | `[]` | Empty permits public hosts; supports exact and `*.example.com` patterns |
| `blockedDomains` | `[]` | Host patterns denied before the allowlist |
| `blockPrivateNetworks` | `true` | Block explicit localhost, private, link-local, and reserved IP URLs |
| `maxPages` | `5` | Maximum tabs per Agent session |
| `actionTimeoutMs` | `15000` | Ordinary Playwright action timeout |
| `typingTimeoutMs` | `90000` | Longer timeout for deliberately slow humanized typing |
| `navigationTimeoutMs` | `30000` | Navigation timeout |
| `maxSnapshotElements` | `100` | Maximum refs returned by a snapshot |
| `maxTextChars` | `12000` | Maximum returned page/extraction text |
| `autoSnapshot` | `true` | Include a fresh bounded snapshot in navigation and interaction results |
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
| dsh-cloak-browser | `0.3.0` |
| DeepSeek Harness packages | `0.1.0-rc.6` |
| CloakBrowser wrapper | `0.5.7` |
| Playwright Core | `1.62.0` |
| Node.js | `>=20` |

Validation performed for this release:

- Unit tests for domain policy, private-host rejection, automatic and iframe
  snapshot refs, stale-ref rejection, safe actionability retries, stable
  per-Agent seeds, Agent isolation, attachment output, and cleanup.
- A clean temporary DSH Web profile installation and full Cordis/Web startup.
- A real free-tier CloakBrowser Chromium launch, navigation to
  a local page, iframe discovery, ref validation, and screenshot capture on
  Linux x64.
- Upstream-equivalent local and public stealth detectors through both the plugin
  and a direct CloakBrowser control; see the reproducible report below.
- `npm audit`, syntax checks, and npm package dry-run.

Run local checks with:

```bash
npm run check
npm test
npm audit --omit=dev
npm pack --dry-run
```

The tests use a fake BrowserContext and do not download Chromium.

## Stealth test results

On the documented Linux host with free Chromium 146, headless mode, no proxy,
and no Windows fonts, the plugin passed 5/6 core public detectors. A direct
CloakBrowser `launchContext` control produced the identical result; both failed
only Device & Browser Info's `hasInconsistentTimingResolution`. CreepJS improved
from 5 lies to 0 after disabling fingerprint noise, so that is now the plugin
default. The FingerprintJS demo still blocked this old binary/environment, while
one reCAPTCHA v3 run scored 0.9 and a repeat was inconclusive.

See [the bilingual methodology, commands, strict verdict rules, complete
results, and upgrade path](./docs/STEALTH.md). Live detector results are
environment- and time-dependent, not a guarantee for unrelated sites.

## Performance

On the documented Linux test host, cached browser startup was about 635 ms on
the first lazy call and 183 ms afterward. A 100-ref snapshot took 29 ms P50,
12,000-character extraction 1.2 ms, and a viewport screenshot 51 ms. With
`humanize=false`, snapshot-click-snapshot took 161 ms; the default humanized
workflow intentionally took 6.27 seconds. Automatic observation reduces
navigate/observe from two Tool calls to one and action/observe workflows from
three calls to two without a measured browser-time regression. See the
bilingual methodology, memory measurements, comparison table, and raw JSON in
[`docs/PERFORMANCE.md`](./docs/PERFORMANCE.md).
