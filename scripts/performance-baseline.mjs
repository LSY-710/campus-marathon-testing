import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import autocannon from "autocannon";
import { createApplication } from "../apps/api/src/app.mjs";
import { writeJson, writeText } from "../ai/core.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const duration = Number(process.env.PERF_DURATION_SECONDS ?? 10);
const application = createApplication({
  dbPath: ":memory:",
  authSecret: "performance-test-secret",
});

await new Promise((resolveListen) => {
  application.server.listen(0, "127.0.0.1", resolveListen);
});

const address = application.server.address();
let result;
try {
  result = await autocannon({
    url: `http://127.0.0.1:${address.port}/api/events?pageSize=20`,
    connections: 10,
    duration,
    pipelining: 1,
    headers: { accept: "application/json" },
  });
} finally {
  await application.close();
}

const summary = {
  generatedAt: new Date().toISOString(),
  scenario: "GET /api/events?pageSize=20",
  durationSeconds: duration,
  connections: 10,
  requests: {
    averagePerSecond: result.requests.average,
    total: result.requests.total,
  },
  latencyMs: {
    average: result.latency.average,
    p95: result.latency.p97_5,
    p99: result.latency.p99,
    maximum: result.latency.max,
  },
  throughputBytesPerSecond: result.throughput.average,
  errors: result.errors,
  timeouts: result.timeouts,
  non2xx: result.non2xx,
};

await writeJson(resolve(root, "reports/performance-baseline.json"), summary);
await writeText(
  resolve(root, "reports/performance-baseline.md"),
  [
    "# API 性能基线",
    "",
    `- 场景：${summary.scenario}`,
    `- 持续时间：${duration} 秒`,
    `- 并发连接：10`,
    `- 平均吞吐：${summary.requests.averagePerSecond} req/s`,
    `- 请求总数：${summary.requests.total}`,
    `- 平均延迟：${summary.latencyMs.average} ms`,
    `- P95 延迟：${summary.latencyMs.p95} ms`,
    `- P99 延迟：${summary.latencyMs.p99} ms`,
    `- 最大延迟：${summary.latencyMs.maximum} ms`,
    `- 错误：${summary.errors}`,
    `- 超时：${summary.timeouts}`,
    `- 非 2xx：${summary.non2xx}`,
    "",
    "> 本结果是本机内存数据库和单进程环境基线，不代表生产集群容量。",
  ].join("\n"),
);

console.log(
  `Performance baseline: ${summary.requests.averagePerSecond} req/s, P95 ${summary.latencyMs.p95} ms, P99 ${summary.latencyMs.p99} ms`,
);
