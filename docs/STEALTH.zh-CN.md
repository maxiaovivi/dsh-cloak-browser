# 隐身与反检测测试

[English](./STEALTH.md)

这套测试分别回答两个问题：

1. DSH 插件是否完整保留了 CloakBrowser 的浏览器级隐身能力？
2. 本机实际安装的 CloakBrowser 二进制在公开 detector 上表现如何？

它只用于公开诊断页和你有权测试的系统。通过 detector 不代表任意生产风控都会放行；IP 信誉、
代理类型、账号历史、Cookie、行为、TLS/网络路径、浏览器版本新旧以及 detector 更新都会影响结果。

## 运行方法

默认命令运行本地信号和 5 个核心公开 detector，并把 `report.json` 与截图写入已被 Git 忽略的
证据目录：

```bash
npm run test:stealth

# 快速浏览器信号；除 example.com 外不访问 detector。
npm run test:stealth:local

# 上游推荐方向：固定测试 seed、关闭可检测的 fingerprint noise。
npm run test:stealth -- --profile hardened

# 额外运行 CreepJS、fingerprint-scan.com、FingerprintJS 和 reCAPTCHA v3。
npm run test:stealth -- --suite full --profile hardened

# 不经过 DSH SessionMap，直接用 CloakBrowser launchContext 做对照。
npm run test:stealth -- --adapter upstream

# fail、error 或 inconclusive 都让 CI 返回非零。
npm run test:stealth -- --strict
```

代理凭据只从环境变量读取，不会写进报告：

```bash
export CLOAKBROWSER_TEST_PROXY='socks5://user:pass@host:port'
npm run test:stealth -- --profile hardened
```

常用参数：

| 参数 | 含义 |
|---|---|
| `--suite local\|public\|full` | 选择本地、核心公开或评分型诊断 |
| `--profile baseline\|hardened` | 对比旧的上游默认值与插件改进配置 |
| `--adapter plugin\|upstream` | 测 DSH SessionMap 路径或 CloakBrowser 直接对照 |
| `--detectors ID,ID` | 只运行指定项，例如 `creepjs,recaptcha-v3` |
| `--headed` | 使用有界面浏览器；Linux Server 需要真实 display 或 Xvfb |
| `--output DIR` | 指定证据目录 |
| `--no-screenshots` | 不保存截图 |
| `--strict` | 只有全部选中 detector 通过时才返回 0 |

页面未识别或未加载完整会标为 `inconclusive`，绝不会误报为 `pass`。评分型服务默认不运行，
因为它们会混入网络/IP 信誉影响，而且比插件代码更容易独立变化。

## 与上游一致的测试口径

实现基于 CloakBrowser 官方
[`tests/test_stealth.py`](https://github.com/CloakHQ/CloakBrowser/blob/main/tests/test_stealth.py)、
[`examples/stealth_test.py`](https://github.com/CloakHQ/CloakBrowser/blob/main/examples/stealth_test.py)
和
[`examples/fingerprint_scan_test.py`](https://github.com/CloakHQ/CloakBrowser/blob/main/examples/fingerprint_scan_test.py)，
并额外加入严格解析、证据保存和 direct-upstream 对照模式。

| Detector | 通过标准 | 主要层次 |
|---|---|---|
| 本地信号 | `webdriver=false`、正常 Chrome UA、`window.chrome`、5+ plugins、languages、无常见 CDP globals | 浏览器 |
| SannySoft | 成功解析表格且 0 个 failed row | 浏览器 |
| Incolumitas | 至少 30 个稳定结果且无意外失败；`WEBDRIVER` 与 `connectionRTT` 单独报告 | 浏览器 + 网络诊断 |
| Rebrowser | `detections-json.totalFails == 0` | 浏览器 |
| BrowserScan | 至少解析到一个 verdict，且 `Abnormal=0` | 浏览器 |
| Device & Browser Info | `isBot=false`，并且解析到的所有 detail flag 都为 false | 浏览器 |
| CreepJS | `window.Fingerprint.lies.totalLies == 0`，同时记录百分比 | 浏览器指纹 |
| fingerprint-scan.com | 自动化 flag 全为 false，并成功得到 Castle score；缺 score 时为不确定 | 浏览器 + 服务 |
| FingerprintJS demo | 成功显示航班，且没有 blocking/tampering verdict | 浏览器 + 网络/信誉 |
| reCAPTCHA v3 demo | 成功解析 score 且不低于上游示例阈值 0.7 | 浏览器 + 网络/信誉 |

## 本机实测结果

测试时间为 2026-08-15（Asia/Jakarta）。环境：wrapper `0.5.7`、免费 Chromium
`146.0.7680.177.5`、Linux x64、headless、无代理、无 Windows 字体集、无 GeoIP 数据库。

### 核心公开测试

| Detector | 插件路径 | 上游 direct 对照 | 证据 |
|---|---:|---:|---|
| 本地自动化信号 | 通过 | 通过 | 6/6 |
| SannySoft | 通过 | 通过 | 37/37 |
| Incolumitas | 通过 | 通过 | 35/36；仅上游已注明的 `WEBDRIVER` |
| Rebrowser | 通过 | 通过 | 0 failed；5 passed、3 not triggered |
| BrowserScan | 通过 | 通过 | Normal 1、Abnormal 0 |
| Device & Browser Info | 失败 | 失败 | `hasInconsistentTimingResolution=true` |

插件与 direct `launchContext` 都是完全相同的 5/6，因此本次测试没有发现 DSH 插件或 SessionMap
引入隐身能力退化。剩余失败不经过插件也能复现，属于当前 Chromium 146/运行环境层。

### 评分与综合测试

| 检查 | Baseline | 改进后/插件默认配置 |
|---|---|---|
| CreepJS lies | 失败：5 lies | 通过：0 lies、25% like-headless、0% headless、0% stealth |
| fingerprint-scan.com | 自动化 flags 为 false，Castle score 未显示 | 相同；因为缺 score，严格判为不确定 |
| FingerprintJS scraping demo | 未作为 baseline 使用 | 失败：anti-detect browser tampering / access denied |
| reCAPTCHA v3 demo | 未作为 baseline 使用 | 一次得到 0.9；重复运行未显示 score，因此不稳定 |

关闭 fingerprint noise 消除了 CreepJS 的全部 5 个 lies，且没有让核心套件退化，因此插件默认值已改为
`fingerprintNoise=false`。在 Chromium 146 强制 Playwright viewport 为 1920×1080 会产生不可能的
inner/outer height 组合，并提高 CreepJS like-headless 分数，所以没有把它设成默认，继续由 CloakBrowser
自动管理 viewport。

## 如何缩小剩余差距

插件已经透传更强配置所需的上游参数，但不能凭空提供浏览器二进制补丁、字体或优质网络出口。
对高风控目标做授权测试时：

1. 登录并更新到最新 CloakBrowser 二进制，再核实实际版本。上游当前 FingerprintJS 配置要求
   Chromium 148+，最新公开成绩使用的版本也比本机更新。
2. Linux 先安装基础 emoji/CJK 字体，并合法取得真实 Windows 字体集，再打开
   `fingerprintWindowsFontMetrics`。
3. 对 headless 敏感的目标优先使用 headed + 真实 display 或 Xvfb。
4. 使用信誉良好的住宅代理并启用 `geoip=true`，保持代理国家、timezone、locale、profile 和
   fingerprint identity 一致。
5. 回访身份使用 persistent profile 和稳定的 `fingerprintSeed`；不同用户不要复用同一身份。
6. 只有 reCAPTCHA/SSO 等内嵌流程确实无法完成时才打开 `allowThirdPartyCookies`；该参数要求 148+。

```bash
npx cloakbrowser login
npx cloakbrowser update
npx cloakbrowser info --json
```

满足前置条件后的 profile override 示例：

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

没有 Chromium 148+ 和对应字体时，不要开启 Windows font metrics。公开 demo 的通过结果也不构成
自动化其他站点的授权。
