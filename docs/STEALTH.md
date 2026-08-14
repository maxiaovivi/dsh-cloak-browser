# Stealth and detection-resistance tests

[简体中文](./STEALTH.zh-CN.md)

This suite answers two separate questions:

1. Does the DSH plugin preserve CloakBrowser's browser-level stealth signals?
2. How does the installed CloakBrowser binary behave on public detector demos?

It is intended for public diagnostics and systems you are authorized to test.
A detector pass is not a promise that an unrelated production anti-abuse system
will accept a session. IP reputation, proxy type, account history, cookies,
behavior, TLS/network path, browser age, and detector updates all matter.

## Run it

The default command runs local checks plus the five core public detectors and
writes `report.json` and screenshots under an ignored evidence directory:

```bash
npm run test:stealth

# Fast, browser-only signals. No detector sites except example.com.
npm run test:stealth:local

# Upstream-aligned settings: stable test seed and fingerprint noise disabled.
npm run test:stealth -- --profile hardened

# Also run CreepJS, fingerprint-scan.com, FingerprintJS, and reCAPTCHA v3.
npm run test:stealth -- --suite full --profile hardened

# Control run without the DSH SessionMap, using CloakBrowser launchContext directly.
npm run test:stealth -- --adapter upstream

# Make any fail, error, or inconclusive result fail CI.
npm run test:stealth -- --strict
```

Optional proxy credentials are read from the environment and never written to
the report:

```bash
export CLOAKBROWSER_TEST_PROXY='socks5://user:pass@host:port'
npm run test:stealth -- --profile hardened
```

Useful CLI options:

| Option | Meaning |
|---|---|
| `--suite local\|public\|full` | Select local, core public, or scored diagnostics |
| `--profile baseline\|hardened` | Compare old upstream defaults with the plugin's safer stealth profile |
| `--adapter plugin\|upstream` | Test the DSH session path or direct CloakBrowser control |
| `--detectors ID,ID` | Run a selected subset, such as `creepjs,recaptcha-v3` |
| `--headed` | Use a visible browser; Linux servers need a real display or Xvfb |
| `--output DIR` | Select the evidence directory |
| `--no-screenshots` | Disable screenshots |
| `--strict` | Return non-zero unless every selected detector passes |

An unrecognized or incomplete page is `inconclusive`, never `pass`. Scored
services are opt-in because they include network/reputation effects and are more
likely to change independently of the plugin.

## Upstream-equivalent checks

The implementation follows CloakBrowser's official
[`tests/test_stealth.py`](https://github.com/CloakHQ/CloakBrowser/blob/main/tests/test_stealth.py),
[`examples/stealth_test.py`](https://github.com/CloakHQ/CloakBrowser/blob/main/examples/stealth_test.py),
and
[`examples/fingerprint_scan_test.py`](https://github.com/CloakHQ/CloakBrowser/blob/main/examples/fingerprint_scan_test.py).
It adds stricter parsing, evidence capture, and a direct-upstream control mode.

| Detector | Pass rule | Layer |
|---|---|---|
| Local signals | `webdriver=false`, normal Chrome UA, `window.chrome`, 5+ plugins, languages, no common CDP globals | Browser |
| SannySoft | Parsed table has zero failed rows | Browser |
| Incolumitas | 30+ stable results and no unexpected failures; `WEBDRIVER` and `connectionRTT` are reported separately | Browser + network diagnostic |
| Rebrowser | `detections-json.totalFails == 0` | Browser |
| BrowserScan | At least one verdict parsed and zero `Abnormal` verdicts | Browser |
| Device & Browser Info | `isBot=false` and every parsed detail flag is false | Browser |
| CreepJS | `window.Fingerprint.lies.totalLies == 0`; percentages are also recorded | Browser fingerprint |
| fingerprint-scan.com | All parsed automation flags false and the Castle score rendered; otherwise inconclusive | Browser + service |
| FingerprintJS scraping demo | Flight results render and no blocking/tampering verdict appears | Browser + network/reputation |
| reCAPTCHA v3 demo | A score is parsed and is at least 0.7, matching upstream's example threshold | Browser + network/reputation |

## Observed results

Tested 2026-08-15 (Asia/Jakarta) with wrapper `0.5.7`, free Chromium
`146.0.7680.177.5`, Linux x64, headless mode, no proxy, no Windows font set,
and no GeoIP database.

### Core public suite

| Detector | Plugin | Direct upstream control | Evidence |
|---|---:|---:|---|
| Local automation signals | Pass | Pass | 6/6 |
| SannySoft | Pass | Pass | 37/37 |
| Incolumitas | Pass | Pass | 35/36; only documented `WEBDRIVER` signal |
| Rebrowser | Pass | Pass | 0 failed; 5 passed, 3 not triggered |
| BrowserScan | Pass | Pass | Normal 1, Abnormal 0 |
| Device & Browser Info | Fail | Fail | `hasInconsistentTimingResolution=true` |

The plugin and direct `launchContext` control produced the same 5/6 outcome.
Therefore this run found no stealth regression introduced by the DSH plugin or
its SessionMap. The remaining failure reproduces without the plugin and belongs
to the installed Chromium 146/browser environment.

### Scored and comprehensive checks

| Check | Baseline | Improved/default plugin profile |
|---|---|---|
| CreepJS lies | Fail: 5 lies | Pass: 0 lies, 25% like-headless, 0% headless, 0% stealth |
| fingerprint-scan.com | Automation flags false, Castle score absent | Same; classified inconclusive because the score did not render |
| FingerprintJS scraping demo | Not used as a baseline | Fail: anti-detect browser tampering/access denied |
| reCAPTCHA v3 demo | Not used as a baseline | One run scored 0.9; a repeat did not render a score, so this result is not stable |

Disabling fingerprint noise removed all five CreepJS lies without introducing a
core-suite regression, so `fingerprintNoise=false` is now the plugin default.
Forcing a 1920×1080 Playwright viewport on Chromium 146 was rejected as a
default: it produced an impossible inner/outer-height combination and increased
CreepJS's like-headless score. Automatic viewport handling remains the default.

## Closing the remaining gap

The current plugin exposes the upstream options needed for a stronger setup,
but it cannot manufacture binary patches, fonts, or a reputable network path.
For high-friction authorized testing:

1. Sign in and update to the newest CloakBrowser binary, then verify the actual
   version. The upstream's current FingerprintJS guidance requires Chromium
   148+ and its latest published results use a newer build.
2. On Linux, install the baseline emoji/CJK fonts and a legally obtained real
   Windows font set before enabling `fingerprintWindowsFontMetrics`.
3. Prefer headed mode with a real display or Xvfb where the target is sensitive
   to headless signals.
4. Use a reputable residential proxy and `geoip=true`; keep proxy country,
   timezone, locale, profile, and fingerprint identity consistent.
5. Reuse a persistent profile and a stable `fingerprintSeed` for a returning
   identity. Do not reuse one identity across unrelated users.
6. Enable `allowThirdPartyCookies` only for embedded flows that require it, such
   as a reCAPTCHA/SSO flow that otherwise never completes; it requires 148+.

```bash
npx cloakbrowser login
npx cloakbrowser update
npx cloakbrowser info --json
```

Example profile override after the prerequisites are met:

```yaml
- id: cloak-browser
  config:
    headless: false
    humanize: true
    geoip: true
    fingerprintSeed: returning-visitor-01
    fingerprintNoise: false
    fingerprintWindowsFontMetrics: true
    persistentProfileRoot: /var/lib/dsh/cloak-profiles
```

Do not enable Windows font metrics without Chromium 148+ and the matching fonts.
Do not interpret a public demo result as authorization to automate another site.
