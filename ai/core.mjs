import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

export function validateTestCase(testCase) {
  const required = [
    "id",
    "requirementId",
    "title",
    "type",
    "priority",
    "preconditions",
    "steps",
    "expected",
  ];
  const missing = required.filter(
    (field) => testCase[field] === undefined || testCase[field] === null,
  );
  if (missing.length) {
    throw new Error(`Test case missing fields: ${missing.join(", ")}`);
  }
  if (!["positive", "boundary", "negative"].includes(testCase.type)) {
    throw new Error(`Unsupported test case type: ${testCase.type}`);
  }
  if (!["P0", "P1", "P2"].includes(testCase.priority)) {
    throw new Error(`Unsupported priority: ${testCase.priority}`);
  }
  return true;
}

export function deduplicateTestCases(cases) {
  const seen = new Set();
  return cases.filter((testCase) => {
    const key = `${testCase.requirementId}|${testCase.type}|${testCase.title}`
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function testCaseCoverage(cases, requirements) {
  const covered = new Set(cases.map((testCase) => testCase.requirementId));
  return {
    requirements: requirements.length,
    coveredRequirements: covered.size,
    coverageRate:
      requirements.length === 0
        ? 0
        : Number((covered.size / requirements.length).toFixed(4)),
  };
}

export function validateTriageResult(result) {
  const required = [
    "category",
    "rootCause",
    "evidence",
    "suggestedFix",
    "severity",
    "confidence",
  ];
  const missing = required.filter(
    (field) => result[field] === undefined || result[field] === null,
  );
  if (missing.length) {
    throw new Error(`Triage result missing fields: ${missing.join(", ")}`);
  }
  if (!Array.isArray(result.evidence) || result.evidence.length === 0) {
    throw new Error("Triage evidence must be a non-empty array");
  }
  if (typeof result.confidence !== "number" || result.confidence < 0 || result.confidence > 1) {
    throw new Error("Triage confidence must be between 0 and 1");
  }
  return true;
}

export function parseJsonResponse(content) {
  if (typeof content !== "string") {
    throw new Error("Model response is not text");
  }
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

export async function callDeepSeekJson({
  system,
  user,
  apiKey,
  model = "deepseek-chat",
  baseUrl = "https://api.deepseek.com",
  timeoutMs = 45_000,
}) {
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `DeepSeek request failed: ${response.status} ${await response.text()}`,
      );
    }
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    return parseJsonResponse(content);
  } finally {
    clearTimeout(timer);
  }
}
