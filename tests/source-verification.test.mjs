import assert from "node:assert/strict";
import test from "node:test";
import {
  createSourceVerifier,
  extractPublishedDate,
  getBlockedSourceReason,
  looksLikeListingPage,
  normalizeSourceUrl
} from "../scripts/source-verification.mjs";

function htmlResponse(url, html, status = 200) {
  const bytes = new TextEncoder().encode(html);
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({
      "content-type": "text/html; charset=utf-8",
      "content-length": String(bytes.byteLength)
    }),
    async arrayBuffer() { return bytes.buffer; }
  };
}

test("硬过滤招聘、CSDN 与跟踪参数重复链接", () => {
  assert.match(getBlockedSourceReason({ url: "https://blog.csdn.net/a", title: "汽车芯片" }), /^blocked_host:/);
  assert.equal(getBlockedSourceReason({ url: "https://example.com/news/1", title: "校园招聘" }), "blocked_title");
  assert.equal(getBlockedSourceReason({ url: "https://example.com/news/2", title: "某公司获得车载控制器专利" }), "blocked_title");
  assert.equal(getBlockedSourceReason({ url: "https://example.com/news/3", title: "2026 年职称评审通过人员名单" }), "blocked_title");
  assert.equal(getBlockedSourceReason({ url: "https://example.com/news/4", title: "为孙公司提供 1 亿元担保" }), "blocked_title");
  assert.equal(
    normalizeSourceUrl("https://example.com/a/?utm_source=test&from=feed#part"),
    "https://example.com/a"
  );
});

test("识别页面日期并拒绝新闻列表页", () => {
  assert.equal(extractPublishedDate('<meta property="article:published_time" content="2026-08-26T10:00:00+08:00">'), "2026-08-26");
  assert.equal(looksLikeListingPage({
    url: "https://example.com/news",
    title: "News Center",
    html: "<html><body>list</body></html>"
  }), true);
});

test("真实页面验证会校正日期并过滤 404、过期页面和招聘页", async () => {
  const longText = "这是一篇与汽车产业、智能驾驶、供应链和量产进度相关的真实新闻正文。".repeat(12);
  const pages = new Map([
    ["https://example.com/article", htmlResponse(
      "https://example.com/article",
      `<html><head><meta property="article:published_time" content="2026-08-26"></head><body><article><h1>量产新闻</h1><p>${longText}</p></article></body></html>`
    )],
    ["https://example.com/old", htmlResponse(
      "https://example.com/old",
      `<html><head><meta name="date" content="2026-06-01"></head><body><article><p>${longText}</p></article></body></html>`
    )],
    ["https://example.com/missing", htmlResponse("https://example.com/missing", "not found", 404)]
  ]);
  let fetchCalls = 0;
  const verifier = createSourceVerifier({
    env: { PAGE_MIN_TEXT_CHARS: "250", PAGE_FETCH_CONCURRENCY: "2" },
    fetchImpl: async (url) => {
      fetchCalls += 1;
      return pages.get(url);
    },
    logger: { log() {}, warn() {} }
  });
  const verified = await verifier.verifyItems([
    { title: "量产新闻", sourceUrl: "https://example.com/article", publishedAt: "2026-08-27" },
    { title: "旧新闻", sourceUrl: "https://example.com/old", publishedAt: "2026-08-25" },
    { title: "不存在", sourceUrl: "https://example.com/missing", publishedAt: "2026-08-25" },
    { title: "校园招聘", sourceUrl: "https://example.com/jobs/1", publishedAt: "2026-08-25" }
  ], {
    mode: "industry",
    industryFromDate: "2026-08-01",
    reportDate: "2026-08-27"
  });

  assert.equal(fetchCalls, 3, "招聘链接应在发起 HTTP 请求前被过滤");
  assert.equal(verified.length, 1);
  assert.equal(verified[0].publishedAt, "2026-08-26", "应以页面实际发布日期覆盖模型日期");
  assert.equal(verifier.stats.rejected, 3);
});

test("Partner 动态会拒绝超过近期窗口的旧闻", async () => {
  const longText = "这是一篇与汽车芯片量产和客户项目有关的真实新闻正文。".repeat(16);
  const verifier = createSourceVerifier({
    env: { PAGE_MIN_TEXT_CHARS: "250", PAGE_FETCH_CONCURRENCY: "2" },
    fetchImpl: async (url) => htmlResponse(
      url,
      `<html><head><meta property="article:published_time" content="${url.endsWith("recent") ? "2026-07-01" : "2024-01-01"}"></head><body><article>${longText}</article></body></html>`
    ),
    logger: { log() {}, warn() {} }
  });
  const verified = await verifier.verifyItems([
    { newsTitle: "近期量产", sourceUrl: "https://example.com/recent", publishedAt: "2026-07-01" },
    { newsTitle: "历史项目", sourceUrl: "https://example.com/old-partner", publishedAt: "2024-01-01" }
  ], {
    mode: "partner",
    partnerFromDate: "2025-08-29",
    reportDate: "2026-08-28"
  });

  assert.deepEqual(verified.map((item) => item.newsTitle), ["近期量产"]);
  assert.equal(verifier.stats.reasons["date_out_of_partner_window:2024-01-01"], 1);
});
