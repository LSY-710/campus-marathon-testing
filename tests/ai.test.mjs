import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  deduplicateTestCases,
  parseJsonResponse,
  testCaseCoverage,
  validateTriageResult,
} from "../ai/core.mjs";
import { classifyOffline } from "../ai/triage.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("offline test-case generation produces valid, de-duplicated coverage", () => {
  execFileSync(
    process.execPath,
    [resolve(root, "ai/generate-test-cases.mjs"), "--offline"],
    { cwd: root, stdio: "pipe" },
  );
  const report = JSON.parse(
    readFileSync(resolve(root, "reports/ai-test-cases.json"), "utf8"),
  );
  assert.equal(report.mode, "offline-baseline");
  assert.equal(report.totalCases, 30);
  assert.equal(report.coverage.coverageRate, 1);
  assert.equal(report.byType.positive, 10);
  assert.equal(report.byType.boundary, 10);
  assert.equal(report.byType.negative, 10);
  assert.equal(
    deduplicateTestCases(report.cases).length,
    report.cases.length,
  );
});

test("coverage calculation detects missing requirements", () => {
  const coverage = testCaseCoverage(
    [
      { requirementId: "A" },
      { requirementId: "A" },
      { requirementId: "B" },
    ],
    [{ id: "A" }, { id: "B" }, { id: "C" }],
  );
  assert.equal(coverage.coveredRequirements, 2);
  assert.equal(coverage.coverageRate, 0.6667);
});

test("offline triage returns a schema-valid structured diagnosis", () => {
  const result = classifyOffline(
    "GET /api/admin/dashboard -> 403 FORBIDDEN insufficient permissions",
  );
  validateTriageResult(result);
  assert.equal(result.category, "AUTHORIZATION");
  assert.equal(result.severity, "HIGH");
  assert.match(result.suggestedFix, /权限|角色/);
});

test("model JSON parser accepts fenced JSON and rejects invalid JSON", () => {
  const parsed = parseJsonResponse('```json\n{"ok":true}\n```');
  assert.equal(parsed.ok, true);
  assert.throws(() => parseJsonResponse("not-json"), /Unexpected token/);
});

test("offline triage evaluation processes the expected synthetic sample set", () => {
  execFileSync(
    process.execPath,
    [resolve(root, "ai/evaluate-triage.mjs"), "--offline"],
    { cwd: root, stdio: "pipe" },
  );
  const report = JSON.parse(
    readFileSync(resolve(root, "reports/ai-triage-evaluation.json"), "utf8"),
  );
  assert.equal(report.mode, "offline-baseline");
  assert.equal(report.sampleCount, 50);
  assert.equal(report.metrics.jsonValidRate, 1);
  assert.equal(report.metrics.categoryAccuracy, 1);
});
