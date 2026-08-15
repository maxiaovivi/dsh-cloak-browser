# 性能测试

[English](./PERFORMANCE.md)

## 结果摘要

测试时间为 2026-08-15，环境为 Node.js 24.19、Linux x64、AMD Ryzen 9
7940HS、15GB 内存、CloakBrowser 免费版 Chromium 146，浏览器二进制已经缓存。目标是包含
302 个交互元素的本机 HTTP 页面；快照上限为 100 个 ref 和 12,000 个文本字符。

## 自动工作流对比

0.2 版默认在导航和交互 Tool 中返回一份新 Snapshot，因此到达相同页面状态所需的 DSH/LLM
Tool 边界明显减少：

| 等价工作流 | 手工 Snapshot | 自动 Snapshot | 减少 |
|---|---:|---:|---:|
| 导航后观察 | 2 次 Tool 调用 | 1 次 Tool 调用 | 50% |
| Snapshot 后操作并观察 | 3 次 Tool 调用 | 2 次 Tool 调用 | 33% |

成对基准中两种模式执行相同浏览器操作，并返回相同的最终 100-ref Snapshot。关闭 humanize
时，点击/观察 P50 为 205.84ms 对 202.36ms，输入/观察为 171.37ms 对 164.91ms；默认开启
humanize 时分别为 7,371.96ms 对 6,876.06ms，以及 10,158.49ms 对 9,979.18ms。这说明减少
Tool 调用没有以浏览器执行性能为代价；模型往返时间没有计入，而减少调用主要会在这里继续获益。

| 端到端 Tool 操作 | `humanize=true` P50 | `humanize=false` P50 |
|---|---:|---:|
| 首次延迟启动浏览器 | 635 ms | 651 ms |
| 后续启动浏览器 | 183 ms | 184 ms |
| 本地页面导航 | 34 ms | 42 ms |
| 100-ref 页面快照 | 29 ms | 30 ms |
| 提取 12,000 字符 | 1.2 ms | 1.3 ms |
| 视口 JPEG 截图 | 51 ms | 52 ms |
| 快照 → 点击 → 快照 | 6,273 ms | 161 ms |
| 快照 → 输入 15 字符 | 11,485 ms | 84 ms |

Linux 进程树 RSS 近似增加量：开启 humanize 时约 810MiB，关闭时约 782MiB。它包含基准 Node
进程和全部 Chromium 子进程。浏览器关闭 300ms 后仍比导入前基线高 168MiB/137MiB；这个短期
值包含 Node/Playwright 模块和分配器保留，不能单独作为浏览器进程泄漏的证据。

## 如何理解

- 二进制缓存后，浏览器启动低于 1 秒。首次调用还需要动态模块初始化；本机后续 Chromium
  进程约 183ms 启动。
- 快照、提取和截图相对于模型推理和公网延迟都很小，薄 DSH 适配层不是主要吞吐瓶颈。
- humanize 有意成为交互耗时主体：本次点击工作流约慢 39 倍，输入工作流约慢 136 倍。这是
  隐蔽性/真实性取舍，不是框架额外开销。
- 主要资源成本是 Chromium 内存。当前版本为了隔离让每个 Agent 拥有进程支持的会话，并发
  Browser Agent 数量应根据可用内存和 CloakBrowser 授权限制设置。
- 可信内部测试追求吞吐时可配置 `humanize=false`；只有授权任务确实需要人类化节奏时才开启。
- 短文本的人类化输入已经接近普通 action timeout，因此输入使用独立的 90 秒默认超时
  `typingTimeoutMs`。

## 方法与限制

- 不包含约 200MB 浏览器压缩包的下载和解压；二进制已经缓存。
- 导航目标是本机 HTTP 服务，不包含 DNS、代理、目标站点和公网延迟。
- 结果为插件 Tool body 端到端耗时，不包含模型推理以及 DSH 外层审批、策略和日志管线。
- 人类化工作流取 3 个样本，观测操作取 5 个样本；结果描述当前主机，不是普遍性能保证。
- 截图由 Chromium 真实生成，但附件存储使用内存 mock，不包含持久存储延迟。

原始结果（包括自动工作流成对对比）保存在 [`bench/results`](../bench/results)，可重新运行：

```bash
npm run benchmark:json
node bench/benchmark.mjs --json --no-humanize
node bench/benchmark.mjs --json --no-humanize --no-auto-snapshot
```

通过 `BENCH_SAMPLES=<n>` 增加默认的 5 个观测样本。
