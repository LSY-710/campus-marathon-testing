import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  callDeepSeekJson,
  deduplicateTestCases,
  readJson,
  testCaseCoverage,
  validateTestCase,
  writeJson,
  writeText,
} from "./core.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = new Set(process.argv.slice(2));
const offline = args.has("--offline") || !process.env.DEEPSEEK_API_KEY;
const requirements = await readJson(resolve(root, "ai/requirements.json"));
const openapi = await readJson(resolve(root, "docs/openapi.json"));

function offlineCases(requirement) {
  const criteria = requirement.acceptanceCriteria;
  return [
    {
      id: `${requirement.id}-POS`,
      requirementId: requirement.id,
      title: `${requirement.title}：正常主流程`,
      type: "positive",
      priority: requirement.risk,
      preconditions: ["服务正常启动", "测试数据满足正常业务条件"],
      steps: [
        `调用 ${requirement.endpoint}`,
        "使用满足前置条件的合法数据",
        "检查响应状态与业务数据",
      ],
      expected: criteria[0],
    },
    {
      id: `${requirement.id}-BND`,
      requirementId: requirement.id,
      title: `${requirement.title}：边界条件`,
      type: "boundary",
      priority: requirement.risk,
      preconditions: ["准备最小合法数据或时间窗口边界数据"],
      steps: [
        `调用 ${requirement.endpoint}`,
        "将输入设置为允许范围的边界值",
        "验证边界行为与服务器时间判定",
      ],
      expected: criteria[1] ?? criteria[0],
    },
    {
      id: `${requirement.id}-NEG`,
      requirementId: requirement.id,
      title: `${requirement.title}：异常与权限场景`,
      type: "negative",
      priority: requirement.risk,
      preconditions: ["准备非法输入、未授权身份或非法状态数据"],
      steps: [
        `调用 ${requirement.endpoint}`,
        "提交非法数据或使用无权限身份",
        "确认接口拒绝请求且不产生副作用",
      ],
      expected: criteria[2] ?? criteria[0],
    },
  ];
}

function livePrompt() {
  return JSON.stringify({
    instruction:
      "Generate software test cases. Return JSON object with a cases array. Every case must contain id, requirementId, title, type, priority, preconditions, steps, expected. Type is positive, boundary or negative. Priority is P0, P1 or P2. Use only the provided requirements and OpenAPI operations.",
    requirements,
    openapi: {
      paths: Object.keys(openapi.paths),
      securitySchemes: openapi.components?.securitySchemes,
    },
  });
}

let cases;
let mode;
if (offline) {
  mode = "offline-baseline";
  cases = requirements.flatMap(offlineCases);
} else {
  mode = "deepseek";
  const response = await callDeepSeekJson({
    apiKey: process.env.DEEPSEEK_API_KEY,
    system:
      "You are a senior test analyst. Produce concrete, non-duplicated and executable API test scenarios. Respond with JSON only.",
    user: livePrompt(),
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    baseUrl: process.env.DEEPSEEK_BASE_URL,
  });
  cases = response.cases;
}

cases = deduplicateTestCases(cases);
cases.forEach(validateTestCase);
const coverage = testCaseCoverage(cases, requirements);
const summary = {
  generatedAt: new Date().toISOString(),
  mode,
  totalCases: cases.length,
  coverage,
  byType: Object.fromEntries(
    ["positive", "boundary", "negative"].map((type) => [
      type,
      cases.filter((testCase) => testCase.type === type).length,
    ]),
  ),
  byPriority: Object.fromEntries(
    ["P0", "P1", "P2"].map((priority) => [
      priority,
      cases.filter((testCase) => testCase.priority === priority).length,
    ]),
  ),
  cases,
};

await writeJson(resolve(root, "reports/ai-test-cases.json"), summary);
await writeText(
  resolve(root, "reports/ai-test-cases.md"),
  [
    "# AI 测试用例生成报告",
    "",
    `- 模式：${mode}`,
    `- 生成时间：${summary.generatedAt}`,
    `- 用例数量：${summary.totalCases}`,
    `- 需求覆盖率：${(coverage.coverageRate * 100).toFixed(2)}%`,
    `- 正常 / 边界 / 异常：${summary.byType.positive} / ${summary.byType.boundary} / ${summary.byType.negative}`,
    "",
    "## 用例清单",
    "",
    ...cases.map(
      (testCase, index) =>
        `${index + 1}. [${testCase.priority}] ${testCase.title}（${testCase.type}）`,
    ),
    "",
    "> 本报告记录的是测试设计初稿。模型生成的用例必须经过人工审核后才能进入正式回归集。",
  ].join("\n"),
);

console.log(`Generated ${cases.length} test cases using ${mode}`);
console.log(`Requirement coverage: ${(coverage.coverageRate * 100).toFixed(2)}%`);
