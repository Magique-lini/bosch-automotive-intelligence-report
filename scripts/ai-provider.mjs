function positiveInteger(value, fallback, name) {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} 必须是正整数。`);
  }
  return parsed;
}

const ZHIPU_SEARCH_ENGINES = new Set([
  "search_std",
  "search_pro",
  "search_pro_sogou",
  "search_pro_quark"
]);

function resolveZhipuSearchEngine(env = process.env) {
  const searchEngine = (env.ZHIPU_SEARCH_ENGINE || "search_pro").trim().toLowerCase();
  if (!ZHIPU_SEARCH_ENGINES.has(searchEngine)) {
    throw new Error(
      `不支持的 ZHIPU_SEARCH_ENGINE：${searchEngine}。可选值为 ${[...ZHIPU_SEARCH_ENGINES].join("、")}。`
    );
  }
  return searchEngine;
}

export function detectProvider(env = process.env) {
  if (env.AI_PROVIDER) return env.AI_PROVIDER.trim().toLowerCase();

  const configuredModel = env.AI_MODEL || env.ZHIPU_MODEL || env.OPENAI_MODEL || "";
  const configuredBaseUrl = env.AI_BASE_URL || env.ZHIPU_BASE_URL || env.OPENAI_BASE_URL || "";
  if (env.ZHIPU_API_KEY || /^glm-/i.test(configuredModel) || /bigmodel\.cn/i.test(configuredBaseUrl)) {
    return "zhipu";
  }
  return "openai";
}

export function resolveAiConfig(env = process.env) {
  const provider = detectProvider(env);
  if (!new Set(["openai", "zhipu"]).has(provider)) {
    throw new Error(`不支持的 AI_PROVIDER：${provider}。可选值为 openai 或 zhipu。`);
  }

  const isZhipu = provider === "zhipu";
  const apiKey = isZhipu
    ? env.ZHIPU_API_KEY || env.AI_API_KEY || env.OPENAI_API_KEY
    : env.OPENAI_API_KEY || env.AI_API_KEY;
  const configuredModel = isZhipu
    ? env.ZHIPU_MODEL || env.AI_MODEL || env.OPENAI_MODEL || "glm-4.7-flashx"
    : env.OPENAI_MODEL || env.AI_MODEL || "gpt-5.4-mini";
  const model = isZhipu && /^glm-/i.test(configuredModel) ? configuredModel.toLowerCase() : configuredModel;
  const baseUrl = isZhipu
    ? env.ZHIPU_BASE_URL || env.AI_BASE_URL || env.OPENAI_BASE_URL || "https://open.bigmodel.cn/api/paas/v4"
    : env.OPENAI_BASE_URL || env.AI_BASE_URL || "https://api.openai.com/v1";

  return { provider, isZhipu, apiKey, model, baseUrl };
}

export function resolveEndpoint(baseUrl, endpoint) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return normalizedBaseUrl.endsWith(endpoint) ? normalizedBaseUrl : `${normalizedBaseUrl}${endpoint}`;
}

export function buildZhipuRequestBody({
  env = process.env,
  model,
  prompt,
  industryFromDate,
  reportDate,
  enableWebSearch = true
}) {
  const searchCount = positiveInteger(env.ZHIPU_SEARCH_COUNT, 20, "ZHIPU_SEARCH_COUNT");
  if (searchCount > 50) throw new Error("ZHIPU_SEARCH_COUNT 必须是 1 至 50 之间的整数。");
  const searchEngine = resolveZhipuSearchEngine(env);

  return {
    model,
    messages: [
      {
        role: "system",
        content: "你负责生成可核验的汽车行业情报日报。必须先联网检索，再只根据检索到的可验证来源输出合法 JSON。"
      },
      { role: "user", content: prompt }
    ],
    ...(enableWebSearch
      ? {
          tools: [
            {
              type: "web_search",
              web_search: {
                enable: true,
                search_engine: searchEngine,
                search_result: true,
                search_recency_filter: "noLimit",
                content_size: env.ZHIPU_SEARCH_CONTENT_SIZE || "high",
                count: searchCount,
                search_prompt: `请分析联网搜索结果 {search_result}。优先可靠一手来源，核对标题、原始发布日期和原文链接；行业新闻限定 ${industryFromDate} 至 ${reportDate}，Partner 新闻严格遵守用户提示中的近期窗口。`
              }
            }
          ],
          tool_choice: "auto"
        }
      : {}),
    response_format: { type: "json_object" },
    thinking: { type: env.ZHIPU_THINKING || "enabled" },
    do_sample: false,
    stream: false,
    max_tokens: positiveInteger(env.AI_MAX_OUTPUT_TOKENS, 40000, "AI_MAX_OUTPUT_TOKENS")
  };
}

export function buildOpenAiRequestBody({ env = process.env, model, prompt, outputSchema }) {
  return {
    model,
    tools: [{ type: "web_search" }],
    tool_choice: "auto",
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "partner_intelligence_daily_report",
        strict: true,
        schema: outputSchema
      }
    },
    max_output_tokens: positiveInteger(env.AI_MAX_OUTPUT_TOKENS, 40000, "AI_MAX_OUTPUT_TOKENS")
  };
}

export function extractJsonText(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) return null;
  let text = rawText.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) text = text.slice(firstBrace, lastBrace + 1);
  return text;
}
