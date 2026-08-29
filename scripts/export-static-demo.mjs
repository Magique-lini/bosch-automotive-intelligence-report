import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.resolve(process.argv[2] || path.join(rootDir, "outputs", "static-demo"));
const reports = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "reports.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(path.join(rootDir, "config", "scouting.json"), "utf8"));
const styles = fs.readFileSync(path.join(rootDir, "app", "globals.css"), "utf8")
  .replace(/^@import\s+"tailwindcss";\s*/m, "");

const payload = JSON.stringify({ reports, categories: config.industryCategories })
  .replaceAll("<", "\\u003c")
  .replaceAll(">", "\\u003e")
  .replaceAll("&", "\\u0026");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>汽车行业情报日报</title>
  <style>${styles}</style>
</head>
<body>
  <div id="app"></div>
  <script>
    const DATA = ${payload};
    const archiveDates = Object.keys(DATA.reports).sort((a, b) => b.localeCompare(a)).slice(0, 20);
    const state = { query: "", partnerCategory: "全部", updatesOnly: false, archiveDate: archiveDates[0] };

    const escapeHtml = (value = "") => String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
    const formatDate = (date) => date ? date.replaceAll("-", ".") : "待首次采集";
    const statusLabels = {
      NEW: "NEW 新动态",
      UPDATED: "UPDATED 已修订",
      "NO CHANGE": "NO CHANGE 无变化",
      BASELINE: "LATEST 当前最新"
    };
    const statusClass = (status) => status.toLowerCase().replace(" ", "-");

    function renderNewsCard(item) {
      return \`<article class="news-card">
        <div class="news-meta">
          \${item.isNew ? '<span class="new-flag">NEW</span>' : ""}
          <span>\${escapeHtml(item.source)}</span>
          <time>\${formatDate(item.publishedAt)}</time>
          <span>可信度 \${escapeHtml(item.confidence)}</span>
        </div>
        <h4>\${escapeHtml(item.title)}</h4>
        <p>\${escapeHtml(item.summary)}</p>
        <p class="highlight"><strong>重点：</strong>\${escapeHtml(item.highlight)}</p>
        <div class="tag-row">
          <div>\${(item.tags || []).map((tag) => \`<span>#\${escapeHtml(tag)}</span>\`).join("")}</div>
          <a href="\${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">原文 ↗</a>
        </div>
      </article>\`;
    }

    function renderPartner(partner) {
      const news = partner.news.map((item, index) => \`<section class="partner-news">
        <div class="partner-news-meta">
          <span>\${String(index + 1).padStart(2, "0")}</span>
          <time>\${formatDate(item.publishedAt)}</time>
          <span>可信度 \${escapeHtml(item.confidence)}</span>
        </div>
        <h4>\${escapeHtml(item.newsTitle)}</h4>
        <p>\${escapeHtml(item.summary)}</p>
        <p class="partner-highlight"><strong>重点：</strong>\${escapeHtml(item.highlight)}</p>
        <a href="\${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">\${escapeHtml(item.source)} ↗</a>
      </section>\`).join("");

      return \`<article class="partner-row">
        <div class="partner-name"><h3>\${escapeHtml(partner.name)}</h3><span>\${escapeHtml(partner.category)}</span></div>
        <div class="partner-focus">
          <span class="priority priority-\${escapeHtml(partner.priority)}">\${escapeHtml(partner.priority)}</span>
          <p>\${escapeHtml(partner.focus)}</p>
          <span class="status status-\${statusClass(partner.status)}">\${statusLabels[partner.status] || escapeHtml(partner.status)}</span>
        </div>
        <div class="partner-news-list">\${news}</div>
      </article>\`;
    }

    function render() {
      const report = DATA.reports[state.archiveDate] || DATA.reports[archiveDates[0]];
      const partners = report.partners;
      const normalized = state.query.trim().toLowerCase();
      const partnerCategories = [...new Set(partners.map((partner) => partner.category))];
      const filteredPartners = partners.filter((partner) => {
        const categoryMatch = state.partnerCategory === "全部" || partner.category === state.partnerCategory;
        const updateMatch = !state.updatesOnly || ["NEW", "UPDATED"].includes(partner.status);
        const searchable = [partner.name, partner.focus, partner.category, ...partner.news.flatMap((item) => [item.newsTitle, item.summary, item.highlight, item.source])].join(" ").toLowerCase();
        return categoryMatch && updateMatch && (!normalized || searchable.includes(normalized));
      });
      const newCount = report.industryNews.filter((item) => item.isNew).length;
      const partnerUpdateCount = partners.filter((item) => ["NEW", "UPDATED"].includes(item.status)).length;
      const sourceCount = new Set(report.industryNews.map((item) => item.source)).size;

      document.getElementById("app").innerHTML = \`<main>
        <header class="masthead">
          <h1>汽车行业情报日报</h1>
          <div class="report-meta"><span>报告日期</span><strong>\${formatDate(state.archiveDate)}</strong><small>最后更新 08:00 CST</small></div>
        </header>
        <nav class="section-nav" aria-label="日报栏目"><a href="#industry">行业动态</a><a href="#partners">Partner Watchlist</a><a href="#archive">20天归档</a></nav>

        <section class="content-section industry-section" id="industry">
          <div class="section-heading"><div><span>PART 01</span><h2>每日行业动态</h2></div><p>\${formatDate(state.archiveDate)} · 共 \${report.industryNews.length} 条 · \${sourceCount} 个来源 · 今日新增 \${newCount} 条</p></div>
          <div class="industry-grid">
            \${DATA.categories.map((category, index) => {
              const items = report.industryNews.filter((item) => item.category === category);
              return \`<section class="news-category"><header><span>\${String(index + 1).padStart(2, "0")}</span><h3>\${escapeHtml(category)}</h3><em>\${items.length} 条</em></header>\${items.length ? items.map(renderNewsCard).join("") : '<div class="empty-state"><span>—</span><p>近 30 日未检出高置信度重要动态</p></div>'}</section>\`;
            }).join("")}
          </div>
        </section>

        <section class="content-section partner-section" id="partners">
          <div class="section-heading"><div><span>PART 02</span><h2>关键 Partner 最新动态</h2></div><p>\${partners.length} 家监测 · \${partners.reduce((total, partner) => total + partner.news.length, 0)} 条动态 · 本期变化 \${partnerUpdateCount} 家</p></div>
          <div class="control-bar">
            <label class="search-field"><span>搜索</span><input id="partner-search" value="\${escapeHtml(state.query)}" placeholder="Partner、产品、新闻或标签"></label>
            <label><span>分类</span><select id="partner-category"><option>全部</option>\${partnerCategories.map((category) => \`<option\${state.partnerCategory === category ? " selected" : ""}>\${escapeHtml(category)}</option>\`).join("")}</select></label>
            <label class="toggle"><input id="updates-only" type="checkbox"\${state.updatesOnly ? " checked" : ""}><span>仅看更新</span></label>
            <div class="result-count"><strong>\${filteredPartners.length}</strong> / \${partners.length}</div>
          </div>
          <div class="partner-table"><div class="partner-row partner-header" aria-hidden="true"><span>Partner / 分类</span><span>关注业务 / 状态</span><span>最近动态</span></div>\${filteredPartners.map(renderPartner).join("")}</div>
        </section>

        <section class="content-section archive-section" id="archive">
          <div class="section-heading"><div><span>PART 03</span><h2>最近 20 天日报</h2></div></div>
          <div class="archive-grid">\${archiveDates.map((date, index) => \`<button type="button" data-date="\${date}" class="\${state.archiveDate === date ? "active" : ""}"><span>\${String(index + 1).padStart(2, "0")}</span><strong>\${formatDate(date)}</strong><small>\${index === 0 ? "当前报告" : "历史快照"}</small></button>\`).join("")}</div>
        </section>
      </main>\`;

      document.getElementById("partner-search").addEventListener("input", (event) => { state.query = event.target.value; render(); document.getElementById("partner-search").focus(); });
      document.getElementById("partner-category").addEventListener("change", (event) => { state.partnerCategory = event.target.value; render(); });
      document.getElementById("updates-only").addEventListener("change", (event) => { state.updatesOnly = event.target.checked; render(); });
      document.querySelectorAll("[data-date]").forEach((button) => button.addEventListener("click", () => { state.archiveDate = button.dataset.date; state.query = ""; state.partnerCategory = "全部"; state.updatesOnly = false; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
    }

    render();
  </script>
</body>
</html>
`;

fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, "index.html");
fs.writeFileSync(outputPath, html);
fs.writeFileSync(
  path.join(outputDir, "使用说明.txt"),
  [
    "汽车行业情报日报｜静态演示版",
    "",
    "1. 双击 index.html，即可用浏览器打开。",
    "2. 搜索、分类、仅看更新和历史日期切换均可使用。",
    "3. 本演示版内容固定为打包时的数据，不会联网，也不会自动更新。",
    "4. 原文链接需要联网才能打开。",
    ""
  ].join("\n")
);
console.log(`静态演示页面已生成：${outputPath}`);
