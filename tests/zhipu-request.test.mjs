import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenAiRequestBody,
  buildZhipuRequestBody,
  extractJsonText,
  resolveAiConfig,
  resolveEndpoint
} from "../scripts/ai-provider.mjs";
import { findIndustryDeficits, mergeIndustryNews } from "../scripts/report-quality.mjs";

test("OpenAI/GPT 模式保留 Responses Web Search 和严格 JSON Schema 参数", () => {
  const env = {
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-5.4-mini",
    OPENAI_BASE_URL: "https://api.openai.com/v1/",
    AI_MAX_OUTPUT_TOKENS: "12000"
  };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["ok"],
    properties: { ok: { type: "boolean" } }
  };
  const config = resolveAiConfig(env);
  const body = buildOpenAiRequestBody({ env, model: config.model, prompt: "生成日报", outputSchema: schema });

  assert.equal(config.provider, "openai");
  assert.equal(resolveEndpoint(config.baseUrl, "/responses"), "https://api.openai.com/v1/responses");
  assert.deepEqual(body.tools, [{ type: "web_search" }]);
  assert.equal(body.tool_choice, "auto");
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema, schema);
  assert.equal(body.max_output_tokens, 12000);
});

test("智谱模式生成 Chat Completions 和 Web Search 参数", () => {
  const env = {
    AI_PROVIDER: "zhipu",
    ZHIPU_API_KEY: "test-key",
    ZHIPU_MODEL: "GLM-4.7-FlashX",
    ZHIPU_BASE_URL: "https://open.bigmodel.cn/api/paas/v4/",
    ZHIPU_SEARCH_ENGINE: "search_pro",
    ZHIPU_SEARCH_COUNT: "20"
  };
  const config = resolveAiConfig(env);
  const body = buildZhipuRequestBody({
    env,
    model: config.model,
    prompt: "生成 JSON 日报",
    industryFromDate: "2026-07-05",
    reportDate: "2026-08-03"
  });

  assert.equal(config.provider, "zhipu");
  assert.equal(config.apiKey, "test-key");
  assert.equal(config.model, "glm-4.7-flashx");
  assert.equal(resolveEndpoint(config.baseUrl, "/chat/completions"), "https://open.bigmodel.cn/api/paas/v4/chat/completions");
  assert.equal(body.response_format.type, "json_object");
  assert.equal(body.tools[0].type, "web_search");
  assert.equal(body.tools[0].web_search.enable, true);
  assert.equal(body.tools[0].web_search.search_engine, "search_pro");
  assert.equal(body.tools[0].web_search.search_recency_filter, "noLimit");
});

test("智谱模式拒绝无效的搜索引擎名称", () => {
  assert.throws(
    () =>
      buildZhipuRequestBody({
        env: { ZHIPU_SEARCH_ENGINE: "search-premium" },
        model: "glm-4.7-flashx",
        prompt: "生成 JSON 日报",
        industryFromDate: "2026-07-05",
        reportDate: "2026-08-03"
      }),
    /ZHIPU_SEARCH_ENGINE/
  );
});

test("已预先取得 Search-Pro 候选时可关闭对话内置搜索", () => {
  const body = buildZhipuRequestBody({
    env: { ZHIPU_SEARCH_ENGINE: "search_pro" },
    model: "glm-4.7-flashx",
    prompt: "仅根据候选链接生成日报",
    industryFromDate: "2026-07-29",
    reportDate: "2026-08-27",
    enableWebSearch: false
  });
  assert.equal(body.tools, undefined);
  assert.equal(body.tool_choice, undefined);
  assert.equal(body.response_format.type, "json_object");
});

test("清理模型偶尔返回的 Markdown JSON 代码块", () => {
  assert.equal(extractJsonText("```json\n{\"ok\":true}\n```"), "{\"ok\":true}");
});

test("复用历史行业新闻时按链接去重并计算缺失栏目", () => {
  const current = [
    { category: "人事变动", title: "任命 A", sourceUrl: "https://example.com/a?utm_source=test", publishedAt: "2026-08-01" }
  ];
  const previous = [
    { category: "人事变动", title: "任命 A", sourceUrl: "https://example.com/a", publishedAt: "2026-08-01" },
    { category: "人事变动", title: "任命 B", sourceUrl: "https://example.com/b", publishedAt: "2026-07-20" }
  ];
  const merged = mergeIndustryNews(current, previous);

  assert.equal(merged.length, 2);
  assert.deepEqual(findIndustryDeficits(merged, ["人事变动"], 2), []);
  assert.deepEqual(findIndustryDeficits(current, ["人事变动"], 2), [
    { category: "人事变动", count: 1, missing: 1 }
  ]);
});
