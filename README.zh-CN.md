# dsh-cloak-browser

[English](./README.md) | 简体中文

## 安装

### 环境要求

- Node.js 20 或更高版本
- [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) `0.1.0-rc.6`
- CloakBrowser 支持的 Linux、macOS 或 Windows 平台

### 直接从 GitHub 安装

```bash
dsh plugin --profile web add -w github:maxiaovivi/dsh-cloak-browser

# 确认 Bundle 已进入 profile 的最终配置。
dsh --profile web --dump-config | grep -A24 cloak-browser
```

安装后重启 DSH：

```bash
dsh --profile web
```

DSH profile 是 pnpm workspace root，所以需要 `-w`。如果其他 profile 同时提供 DSH
`tools` 和 `attachments` 服务，也可以把 `web` 换成对应的 profile 名称。

从 0.1.1 开始，插件会复用 profile 已有的 `dsh-tools` 和 `dsh-llm` 运行时实例，避免重复
运行时引发 `Cannot read properties of undefined (reading 'prepare')`。

如果之前安装过 0.1.0，请先移除一次再重新安装：

```bash
dsh plugin --profile web remove -w dsh-cloak-browser
dsh plugin --profile web add -w github:maxiaovivi/dsh-cloak-browser
```

### 从本地克隆安装

开发或审计插件时使用这种方式：

```bash
git clone https://github.com/maxiaovivi/dsh-cloak-browser.git
cd dsh-cloak-browser
npm ci
plugin_tarball=$(npm pack --silent)

# 仅 Ubuntu/Debian；这一步可能请求 sudo 权限。
npx playwright-core install-deps chromium

dsh plugin --profile web add -w "$PWD/$plugin_tarball"
dsh --profile web --dump-config | grep -A24 cloak-browser
dsh --profile web
```

GitHub 安装会由 pnpm 安装运行依赖。本地流程安装打包产物而不是链接开发目录，避免开发专用
的 DSH 宿主包副本进入 profile。

### License 和代理环境变量

不要把凭据写进 `cordis.patch.yml` 或 Tool 参数；应在启动 DSH 的环境中导出：

```bash
export CLOAKBROWSER_LICENSE_KEY='your-license-key'         # 可选
export CLOAKBROWSER_PROXY_URL='http://user:pass@host:port' # 可选
dsh --profile web
```

没有 License key 时，CloakBrowser 会选择可用的免费版本。首次真正使用浏览器时会下载并校验
约 200MB 的 Chromium 压缩包，解压后的 `~/.cloakbrowser` 缓存会占用更多磁盘空间。不需要执行
`playwright install chromium`。

当环境变量或本地保存的 License 被验证为 **Free plan** 时，新会话第一次调用
`browser_open` 不会启动 Chromium，而是返回确认请求。Agent 会询问当前是否有其他人或设备
正在使用这个 Key；只有用户明确回答“没有”，Agent 才会在第二次调用中自动带上
`free_session_in_use=false` 并启动。回答“有”或“不确定”时不会启动。付费套餐不增加这一轮确认。
该参数是 Agent 根据用户回答填写的 Tool 内部控制，用户不需要手写 Tool JSON 或修改配置。

插件会串行化同一 DSH 进程内的 Free 会话并发启动，并在本地或 License Server 已占用时返回
明确状态，不再循环重试。插件无法撤销另一台机器或异常退出旧进程持有的服务器端租约；这类
租约仍需由上游关闭或等待过期。

存在代理 URL 时，插件会自动启用 CloakBrowser GeoIP 匹配。第一次使用可能还会把约 70MB 的
GeoLite 数据库下载到同一缓存；`mmdb-lib` 已随插件安装，不需要再执行安装命令。

### 卸载

```bash
dsh plugin --profile web remove -w dsh-cloak-browser
```

卸载后重启 DSH。`~/.cloakbrowser` 下的浏览器缓存由 CloakBrowser CLI 单独管理。

## 项目来源

`dsh-cloak-browser` 是社区维护的独立 DeepSeek Harness 原生浏览器 Tool Bundle，连接了两个
上游产品：

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供 Cordis 插件运行时、
  Agent Loop、Tool 执行管线、模型路由和持久附件存储。
- [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) 提供兼容 Playwright 的 Chromium
  启动器、源码级指纹补丁、可选的人类化输入、代理/GeoIP 集成和浏览器二进制分发。

本仓库不是 DeepSeek 或 CloakHQ 官方项目，也未获得这两个组织的附属或背书关系。

插件采用薄集成：

```text
DSH 原生 Tool → per-Agent BrowserContext Map → CloakBrowser → Playwright
```

没有 MCP Server、独立中间件进程、远程浏览器服务或模型提供的任意 JavaScript 执行器。仅保留
很小的 Session Map，因为浏览器状态需要跨 Tool 调用保持，同时不能在不同 Agent 之间泄漏。

## 产品功能

- 原生 DSH Tool：支持 schema、规范 JSON 返回、UI 展示和 Code Mode。
- 延迟启动：只有 Agent 第一次调用浏览器 Tool 时才启动 Chromium。
- 每个 Agent 拥有隔离的 BrowserContext；`agent/disposed` 或插件卸载时自动关闭。
- 导航和交互后自动返回有界页面快照与短期元素 ref（例如 `p1:s3:e8`），Agent 无需额外调用
  一次观察 Tool 即可继续。
- 自动识别 iframe 内的控件，并返回 selected、expanded、required、invalid、read-only 等表单状态。
- 支持导航、点击、填写、选择、按键、等待、内容提取、截图、标签页和生命周期管理。
- 视觉模型获得 DSH 持久图片附件；纯文本模型自动回退到页面文本快照。
- 通过 CloakBrowser 提供可选的人类化鼠标、输入和滚动。
- CloakBrowser 人类化点击/填写出现特定的 `covered by <none>` 执行前误报时自动重试一次；
  其他错误仍安全失败。
- 未显式配置 seed 时，自动为每个 Agent 派生稳定且哈希化的 fingerprint seed。
- 自动识别 License 套餐：验证为 Free 的 Key 在每次新建会话前要求一次占用确认，付费套餐直接启动；
  同一 DSH 进程内的 Free 会话并发启动会被串行化。
- 检测到代理环境变量时自动启用 GeoIP 一致性，所需运行依赖随插件安装。
- 默认使用临时 Context；显式配置后可使用按 Agent 隔离的持久 profile。
- 支持域名允许/拒绝规则、显式私网地址拦截、页面/输出限制、协作取消和浏览器清理。
- 常驻路由提示让交互或真实渲染任务选择浏览器，而简单公开文本查询继续使用更轻量的 Web Tool。

## Tool 与 Agent 工作流

推荐流程：

```text
browser_open(url)
  → 仅验证为 Free 的 Key：Agent 询问是否有其他人/设备正在使用
     → 没有：Agent 携带确认再次调用 browser_open 并启动
     → 有/不确定：不启动
  → 付费套餐或无 Key 本地构建：直接启动
  → 返回 snapshot + refs
  → browser_click / browser_type / browser_select → 返回下一份 snapshot + refs
  → 浏览器任务完成后 browser_close
```

默认流程不需要在每次操作之间手工调用 `browser_snapshot`。页面自行变化或 Agent 需要刷新视图时，
仍可使用显式 Snapshot Tool。

| Tool | 功能 |
|---|---|
| `browser_open` | 延迟打开会话；验证为 Free 的 Key 会先请求用户确认；传入 URL 时同时返回 Snapshot |
| `browser_navigate` | 导航并返回含 ref 的新 Snapshot |
| `browser_snapshot` | 显式刷新有上限的页面/iframe 文本和 ref |
| `browser_click` | 点击 ref 并返回下一份 Snapshot |
| `browser_type` | 填写文本、可选提交并返回下一份 Snapshot |
| `browser_select` | 选择选项并返回下一份 Snapshot |
| `browser_press` | 按下限定导航键并返回下一份 Snapshot |
| `browser_wait` | 等待文本或时间并返回结果 Snapshot |
| `browser_extract` | 提取有上限的文本、HTML 或属性，不执行任意 JS |
| `browser_screenshot` | 视觉路由返回图片附件，文本路由返回元数据 |
| `browser_tabs` | 列出、选择或关闭标签页 |
| `browser_close` | 关闭并清除当前 Agent 的浏览器会话 |

常驻提示会把“打开、浏览、点击、填写、提交、登录、检查渲染状态、网页截图”等请求路由到
`browser_*`。简单公开文本调研仍优先使用 Web Search/Fetch，需要真实渲染或交互时才升级。

示例请求：

```text
使用浏览器打开 https://example.com，检查渲染后的页面，列出可交互元素，完成后关闭浏览器。
```

## 配置

Bundle 默认配置位于 [`cordis.patch.yml`](./cordis.patch.yml)。

| 配置项 | 默认值 | 说明 |
|---|---:|---|
| `headless` | `true` | 无可见窗口运行 Chromium |
| `humanize` | `true` | 启用 CloakBrowser 人类化交互 |
| `humanPreset` | `default` | `default` 或 `careful` 行为预设 |
| `geoip` | `auto` | `proxyEnv` 存在时自动按代理 IP 推导语言和时区，也可显式设为 `true` 或 `false` |
| `proxyEnv` | `CLOAKBROWSER_PROXY_URL` | 保存代理 URL 的环境变量名 |
| `persistentProfileRoot` | 空 | 按 Agent 哈希创建持久 profile 的根目录 |
| `fingerprintSeed` | 空 | 留空时自动派生稳定且哈希化的 per-Agent seed；显式 seed 会覆盖自动值 |
| `fingerprintNoise` | `false` | 关闭 canvas/WebGL/audio/client-rect 注入噪声；实测消除了 5 个 CreepJS lies |
| `fingerprintWindowsFontMetrics` | `false` | Chromium 148+ Windows 字体指标；Linux 必须有真实 Windows 字体集 |
| `allowThirdPartyCookies` | `false` | Chromium 148+ 的内嵌 reCAPTCHA/SSO/支付流程兼容开关 |
| `fingerprintStorageQuotaMb` | `0` | 可选 storage quota；`0` 保留上游自动值 |
| `viewportWidth`、`viewportHeight` | `0`、`0` | 可选匹配 viewport/指纹屏幕尺寸；`0` 使用更安全的自动管理 |
| `allowedDomains` | `[]` | 空数组允许公网；支持精确域名和 `*.example.com` |
| `blockedDomains` | `[]` | 在 allowlist 前检查的拒绝域名 |
| `blockPrivateNetworks` | `true` | 阻止显式 localhost、私网、link-local 和保留 IP URL |
| `maxPages` | `5` | 单个 Agent 会话的最大标签页数 |
| `actionTimeoutMs` | `15000` | 普通 Playwright 操作超时 |
| `typingTimeoutMs` | `90000` | 为刻意放慢的人类化输入提供更长超时 |
| `navigationTimeoutMs` | `30000` | 导航超时 |
| `maxSnapshotElements` | `100` | 单次快照返回的最大 ref 数 |
| `maxTextChars` | `12000` | 页面和提取文本最大长度 |
| `autoSnapshot` | `true` | 在导航和交互结果中自动包含一份新的有界 Snapshot |
| `screenshotFormat` | `jpeg` | `jpeg` 或 `png` |
| `screenshotQuality` | `80` | JPEG 质量 |
| `routePrompt` | `true` | 向 system prompt 注入浏览器选择规则 |

生产环境建议在 profile override 中限制导航域名：

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

同一个站点身份应保持 profile、fingerprint、代理、timezone 和 locale 一致。不要把日常 Chrome
profile 交给 Agent。

## 安全边界

- `browser_type.text` 会进入 DSH Tool 日志，不能传递密码、API key、Cookie 或 Token。当前版本
  有意不包含凭据存储驱动的输入 Tool。
- 页面内容属于不可信输入；插件会明确告诉 Agent，网页内容不能覆盖系统或用户指令。
- `allowedDomains` 用于顶层导航，是应用层护栏而不是完整网络沙箱。高安全环境仍需用容器/防火墙
  防止 DNS rebinding 和网页子资源访问私网。
- 插件不允许模型提供任意 JavaScript 执行代码。
- 仅在你有权自动化的系统和网站上使用，并遵守法律与站点条款。

## 上游许可

本仓库代码使用 [MIT License](./LICENSE)。

CloakBrowser wrapper 源码使用 MIT，但其下载的 Chromium 二进制由 CloakHQ 单独的
[Binary License](https://github.com/CloakHQ/CloakBrowser/blob/main/BINARY-LICENSE.md) 管理。
在重分发、逆向、修改二进制，或对外提供客户可控 Browser-as-a-Service 前必须审阅该许可。

## 兼容性与验证

当前版本锁定：

| 组件 | 版本 |
|---|---|
| dsh-cloak-browser | `0.3.0` |
| DeepSeek Harness packages | `0.1.0-rc.6` |
| CloakBrowser wrapper | `0.5.7` |
| Playwright Core | `1.62.0` |
| Node.js | `>=20` |

当前版本执行过：

- 域名策略、私网拒绝、自动及 iframe snapshot ref、过期 ref、安全 actionability 重试、稳定
  per-Agent seed、Agent 隔离、图片附件和清理单元测试。
- 在干净的临时 DSH Web profile 中安装并完整启动 Cordis/Web。
- Linux x64 免费版 CloakBrowser Chromium 真实启动、本地页面导航、iframe 发现、ref 验证和截图。
- 通过插件路径和 CloakBrowser direct 对照运行上游同口径的本地及公开隐身 detector；完整报告见下文。
- `npm audit`、语法检查和 npm package dry-run。

本地验证命令：

```bash
npm run check
npm test
npm audit --omit=dev
npm pack --dry-run
```

单元测试使用假的 BrowserContext，不会下载 Chromium。

## 隐身测试结果

在本文档所列 Linux 主机上，使用免费 Chromium 146、headless、无代理且无 Windows 字体时，插件
通过 5/6 个核心公开 detector。直接调用 CloakBrowser `launchContext` 的对照结果完全相同；两者都只在
Device & Browser Info 的 `hasInconsistentTimingResolution` 失败。关闭 fingerprint noise 后，CreepJS
从 5 lies 改进为 0，因此它已成为插件默认值。FingerprintJS demo 仍会拦截这个旧二进制/环境；
reCAPTCHA v3 一次得到 0.9，重复运行则没有得到 score。

双语测试方法、命令、严格判定规则、完整结果和升级路径见
[`docs/STEALTH.zh-CN.md`](./docs/STEALTH.zh-CN.md)。公开 detector 会随环境和时间变化，不能保证
无关站点一定放行。

## 性能

在文档所列 Linux 测试机上，缓存后的首次延迟启动约 635ms，后续约 183ms；100-ref 快照 P50
为 29ms，提取 12,000 字符为 1.2ms，视口截图为 51ms。关闭 `humanize` 时“快照→点击→快照”
为 161ms；默认的人类化工作流会有意放慢到 6.27 秒。自动观察把“导航→观察”从两次 Tool
调用降为一次，把“操作→观察”工作流从三次降为两次，且浏览器执行时间没有实测回退。双语
方法、内存数据、对比表和原始 JSON 见
[`docs/PERFORMANCE.zh-CN.md`](./docs/PERFORMANCE.zh-CN.md)。
