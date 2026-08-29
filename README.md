# Partner 汽车行业情报日报

这是一个可独立迁移的汽车行业新闻与关键 Partner 监测网站。首页展示最近 30 天内的高价值行业动态；固定监测 21 家 Partner，每家保留 2–3 条最新有效汽车业务新闻，不受 30 天窗口限制。日报以 JSON 快照保存，默认滚动保留最近 20 期。

## 功能口径

- 五个固定行业栏目每日更新：车企动态、零部件企业、产经聚焦、政策动态、人事变动。
- 每栏最低 2 条，优先收录对项目、价格、供应、量产、合规和竞争格局有影响的新闻。
- Partner 名单固定，每家保留 2–3 条动态且不设时间下限；发现更新时显示 `NEW`。
- 来源、来源发布日期、概要、业务重点、可信度和原文链接均在页面展示。
- `data/reports.json` 最多保留 20 个日期快照。

## 本地运行

需要 Node.js 22.13 或更高版本，以及 pnpm 11。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

浏览器访问 `http://localhost:3000`。

生产模式：

```bash
pnpm build
pnpm start
```

## 配置 AI 自动抓取

项目支持智谱和 OpenAI，默认示例使用智谱。先复制环境变量模板：

```bash
cp .env.example .env
```

然后打开 `.env`，至少填写智谱 API Key：

```dotenv
AI_PROVIDER=zhipu
ZHIPU_API_KEY=你的智谱API密钥
ZHIPU_MODEL=glm-4.7-flashx
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4
ZHIPU_SEARCH_ENGINE=search_pro
```

然后生成当天日报：

```bash
pnpm report:update
```

智谱模式使用两阶段管线：先直接调用 `/web_search` 获取 Search-Pro 返回的结构化标题、摘要、发布日期和真实链接，再通过 `/chat/completions` 调用 GLM-4.7-FlashX 负责筛选、归类、摘要和生成日报 JSON。模型不得生成 Search-Pro 候选或历史基线之外的 URL。首次建立可验证基线时，21 家 Partner 会各自执行一次独立搜索，避免多公司组合 query 导致空结果和来源错配。建立基线后，默认每天搜索 1 次行业新闻并独立轮换 2 家 Partner，其他公司延用上期已验证基线。行业主 query 返回空结果时会自动换用两组更短的关键词。搜索工具与模型分别计费。OpenAI 模式继续使用 `/responses`、`web_search` 和严格 JSON Schema。两种模式的结果都会再打开真实 URL，过滤招聘/CSDN/泛 ESG/获奖榜单来源、HTTP 错误页、首页或列表页，并以页面或 Search-Pro 的发布日期进行校验。

行业栏目不足最低条数时，脚本会先复用并重新验证上一期仍在 30 天窗口内的新闻，再针对缺失栏目自动补搜（默认最多 2 次）。Partner 链接过滤后不足时也会定向补搜，最后才复用并验证上期基线。单次补搜超时、API 报错、返回非法 JSON 或缺少数组时，脚本会记录警告并继续其他搜索；个别栏目或 Partner 最终不足也不会阻止已验证日报的保存。警告会写入 `sourceAudit.warnings`，仅当本次没有任何通过验证的行业或 Partner 新闻时才保留旧报告。

主日报或补搜返回语法损坏的 JSON、超时或临时服务错误时，默认会自动请求 2 次，可通过 `AI_REQUEST_ATTEMPTS` 调整为 1–5 次。主生成多次失败但存在历史报告时，脚本会用最近一期内容作为基线，继续真实链接验证和定向补搜。

主日报请求默认最长等待 5 分钟，单次行业或 Partner 补搜最长等待 2 分钟。补搜循环自身已提供多次尝试，因此单次补搜不再叠加内层重试。等待期间每 30 秒输出一次进度日志。可通过 `AI_REQUEST_TIMEOUT_MS`、`AI_REPAIR_REQUEST_TIMEOUT_MS` 和 `AI_PROGRESS_INTERVAL_MS` 调整。

如需切回 OpenAI，将 `.env` 改为：

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-5.4-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

为了兼容旧配置，如果未填写 `AI_PROVIDER`，脚本也会根据 `glm-*` 模型名称或 `bigmodel.cn` 地址自动识别智谱。智谱联网搜索可能与模型调用分别计费，具体以开放平台账户权益为准。

如需补录指定日期，可临时设置：

```bash
REPORT_DATE=2026-07-29 pnpm report:update
```

## 每天自动运行

Linux/macOS 可使用 cron。下面示例每天上海时间 08:00 更新并写入日志：

```cron
CRON_TZ=Asia/Shanghai
0 8 * * * cd /absolute/path/to/partner-daily && /usr/bin/env pnpm report:update >> update.log 2>&1
```

更新数据后，如网站以静态构建或容器方式部署，需要重新执行构建/发布流程。

## Docker 迁移

安装 Docker Desktop 后，把整个代码目录复制到任意电脑，创建 `.env`，然后运行：

```bash
docker compose up --build
```

访问 `http://localhost:3000`。停止服务：

```bash
docker compose down
```

更新日报可在主机运行 `pnpm report:update`，再执行 `docker compose up --build -d`；也可把定时任务接入 CI/CD。

## 自定义监测范围

- `config/scouting.json`：栏目、来源优先级、搜索主题、Partner 名单和关键词。
- `data/reports.json`：日报快照数据。
- `app/Dashboard.tsx`：页面交互与排版。
- `scripts/update-report.mjs`：搜索、校验、变化比较和 20 期归档逻辑。

修改 Partner 名单时，同时更新 `config/scouting.json`。下一次执行更新命令后，新名单会写入日报。

## 安全说明

- `.env` 已被 Git 与 Docker 构建忽略，不要把真实 API Key 写进源码或提交到版本库。
- 自动摘要用于业务线索筛查，不替代采购报价、法务意见、认证结论或公司正式公告。
- 对价格、供货和项目定点等敏感信息，建议点击原文并进行二次验证。
