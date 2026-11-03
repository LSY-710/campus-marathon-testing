import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  callDeepSeekJson,
  readJson,
  validateTriageResult,
  writeJson,
  writeText,
} from "./core.mjs";
import { classifyOffline, triageRules } from "./triage.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = new Set(process.argv.slice(2));
const limitIndex = process.argv.indexOf("--limit");
const limit =
  limitIndex >= 0 ? Number(process.argv[limitIndex + 1] || 10) : Infinity;
const offline = args.has("--offline") || !process.env.DEEPSEEK_API_KEY;
const scenarios = await readJson(resolve(root, "ai/triage-scenarios.json"));

function buildCases() {
  return scenarios.flatMap((scenario, scenarioIndex) =>
    Array.from({ length: 5 }, (_, variantIndex) => ({
      id: `TRIAGE-${String(scenarioIndex + 1).padStart(2, "0")}-${variantIndex + 1}`,
      log: `${scenario.logs[variantIndex % scenario.logs.length]}\nrun=${variantIndex + 1}; job=marathon-ci-${scenarioIndex + 1}`,
      expectedCategory: scenario.category,
      expectedSeverity: scenario.severity,
      rootCause: scenario.rootCause,
      fixKeywords: scenario.fixKeywords,
    })),
  );
}

async function classifyLive(testCase) {
  const response = await callDeepSeekJson({
    apiKey: process.env.DEEPSEEK_API_KEY,
    system:
      "You are a CI failure triage analyst. Return JSON with category, rootCause, evidence array, suggestedFix, severity and confidence from 0 to 1. Base conclusions only on supplied logs.",
    user: JSON.stringify({
      task: "Triage this failed automated test.",
      log: testCase.log,
      allowedCategories: triageRules.map((rule) => rule.category),
    }),
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    baseUrl: process.env.DEEPSEEK_BASE_URL,
  });
  return response;
}

const cases = buildCases().slice(0, limit);
const results = [];
for (const testCase of cases) {
  const startedAt = performance.now();
  let result;
  let jsonValid = false;
  let error;
  try {
    result = offline
      ? classifyOffline(testCase.log)
      : await classifyLive(testCase);
    validateTriageResult(result);
    jsonValid = true;
  } catch (caught) {
    error = caught.message;
    result = {
      category: "UNKNOWN",
      rootCause: caught.message,
      evidence: [testCase.log.split("\n")[0].slice(0, 180)],
      suggestedFix: "",
      severity: "UNKNOWN",
      confidence: 0,
    };
  }
  const latencyMs = Number((performance.now() - startedAt).toFixed(2));
  const combinedText = [
    result.rootCause,
    result.suggestedFix,
    ...(result.evidence ?? []),
  ]
    .join(" ")
    .toLowerCase();
  results.push({
    caseId: testCase.id,
    expectedCategory: testCase.expectedCategory,
    actualCategory: result.category,
    categoryCorrect: result.category === testCase.expectedCategory,
    severityCorrect: result.severity === testCase.expectedSeverity,
    fixHit: testCase.fixKeywords.some((keyword) =>
      combinedText.includes(keyword.toLowerCase()),
    ),
    jsonValid,
    latencyMs,
    result,
    error,
  });
}

const total = results.length;
const ratio = (value) =>
  total === 0 ? 0 : Number((value / total).toFixed(4));
const summary = {
  generatedAt: new Date().toISOString(),
  mode: offline ? "offline-baseline" : "deepseek",
  sampleCount: total,
  dataSource: "synthetic labeled CI failures",
  metrics: {
    jsonValidRate: ratio(results.filter((result) => result.jsonValid).length),
    categoryAccuracy: ratio(
      results.filter((result) => result.categoryCorrect).length,
    ),
    severityAccuracy: ratio(
      results.filter((result) => result.severityCorrect).length,
    ),
    fixHitRate: ratio(results.filter((result) => result.fixHit).length),
    averageLatencyMs: Number(
      (
        results.reduce((sum, result) => sum + result.latencyMs, 0) /
        Math.max(1, total)
      ).toFixed(2),
    ),
  },
  results,
};

await writeJson(resolve(root, "reports/ai-triage-evaluation.json"), summary);
await writeText(
  resolve(root, "reports/ai-triage-evaluation.md"),
  [
    "# AI 故障分诊评估",
    "",
    `- 模式：${summary.mode}`,
    `- 样本：${summary.sampleCount} 条合成故障`,
    `- JSON 合法率：${(summary.metrics.jsonValidRate * 100).toFixed(2)}%`,
    `- 分类准确率：${(summary.metrics.categoryAccuracy * 100).toFixed(2)}%`,
    `- 严重级别准确率：${(summary.metrics.severityAccuracy * 100).toFixed(2)}%`,
    `- 修复建议命中率：${(summary.metrics.fixHitRate * 100).toFixed(2)}%`,
    `- 平均延迟：${summary.metrics.averageLatencyMs} ms`,
    "",
    "## 结果说明",
    "",
    "当前默认执行离线基线，用于验证数据结构、评分逻辑和报告流程。它不代表真实大模型的泛化能力。",
    "设置 `DEEPSEEK_API_KEY` 并移除 `--offline` 后，可运行真实 DeepSeek 评估；正式简历数据应基于真实 CI 故障日志复核后再使用。",
  ].join("\n"),
);

console.log(`Evaluated ${summary.sampleCount} synthetic failures using ${summary.mode}`);
console.log(`Category accuracy: ${(summary.metrics.categoryAccuracy * 100).toFixed(2)}%`);
