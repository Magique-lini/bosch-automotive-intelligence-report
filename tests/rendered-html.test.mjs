import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server renders the intelligence report", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /汽车行业情报日报/);
  assert.match(html, /每日行业动态/);
  assert.match(html, /原文 ↗/);
  assert.match(html, /关键 Partner 最新动态/);
  assert.doesNotMatch(html, /BOSCH PARTNER INTELLIGENCE|class="brand-mark"|博世关键 Partner 汽车/i);
  assert.doesNotMatch(html, /每天保存一份不可变快照/);
  assert.doesNotMatch(html, /数据口径|自动更新/);
  assert.doesNotMatch(html, /每家 Partner 始终保留/);
  assert.doesNotMatch(html, /今天，哪些变化/);
  assert.doesNotMatch(html, /PENDING 待采集/);
});

test("seed report covers every fixed section and partner", async () => {
  const [reportsText, configText] = await Promise.all([
    readFile(new URL("../data/reports.json", import.meta.url), "utf8"),
    readFile(new URL("../config/scouting.json", import.meta.url), "utf8"),
  ]);
  const reports = JSON.parse(reportsText);
  const config = JSON.parse(configText);
  const latestDate = Object.keys(reports)
    .filter((date) => {
      const item = reports[date];
      const partnersWithNews = item.partners.filter((partner) => partner.news.length > 0).length;
      return item.industryNews.length >= 5 && partnersWithNews >= Math.ceil(item.partners.length * 0.7);
    })
    .sort((a, b) => b.localeCompare(a))[0];
  const report = reports[latestDate];

  assert.equal(report.partners.length, config.partners.length);
  assert.equal(new Set(report.partners.map((item) => item.name)).size, config.partners.length);
  assert.ok(report.partners.every((item) => item.news.length <= config.partnerNewsMax));
  assert.ok(report.partners.filter((item) => item.news.length >= 1).length >= config.partners.length - 5);
  assert.ok(report.partners.filter((item) => item.news.length >= config.partnerNewsMin).length >= config.partners.length - 12);
  assert.ok(report.partners.every((item) => item.news.every((news) => news.newsTitle && news.sourceUrl && news.publishedAt)));

  assert.ok(report.industryNews.length >= 7);
  assert.ok(new Set(report.industryNews.map((item) => item.category)).size >= config.industryCategories.length - 1);
});
