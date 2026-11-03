export const triageRules = [
  {
    category: "AUTHENTICATION",
    severity: "HIGH",
    pattern: /401|token|令牌|登录|授权头|bearer/i,
    rootCause: "访问令牌缺失、过期或被篡改",
    fix: "重新登录以获取有效令牌，并检查请求是否携带 Authorization 头。",
  },
  {
    category: "AUTHORIZATION",
    severity: "HIGH",
    pattern: /403|forbidden|permission|权限|角色/i,
    rootCause: "当前用户角色无权访问目标接口",
    fix: "检查账号角色和管理员权限配置，确认没有使用普通用户令牌。",
  },
  {
    category: "VALIDATION",
    severity: "MEDIUM",
    pattern: /400|validation|required|invalid|校验|必填|字段格式|empty string|缺少.*字段/i,
    rootCause: "请求数据不满足字段校验规则",
    fix: "检查必填字段、类型和格式，在客户端与接口层同时补充校验。",
  },
  {
    category: "BUSINESS_STATE",
    severity: "HIGH",
    pattern: /409|duplicate|state|缴费|报名|状态|paid_registration|already_registered/i,
    rootCause: "业务状态不满足当前操作允许的前置条件",
    fix: "检查报名、缴费和审核状态，按状态机要求修正前置数据。",
  },
  {
    category: "DATA_INTEGRITY",
    severity: "HIGH",
    pattern: /unique constraint|constraint failed|foreign key|unique.*用户|duplicate.*row|唯一约束|重复数据/i,
    rootCause: "数据库唯一约束或关联关系阻止写入",
    fix: "检查重复数据和关联记录，使用幂等写入或在事务内完成更新。",
  },
  {
    category: "NETWORK",
    severity: "HIGH",
    pattern: /econnrefused|failed to fetch|dns|network|连接|网络|api 地址/i,
    rootCause: "客户端无法连接 API 服务或网络地址错误",
    fix: "确认 API 地址、服务进程和网络连通性，检查域名可达性。",
  },
  {
    category: "DATABASE_LOCK",
    severity: "HIGH",
    pattern: /database is locked|sqlite_busy|数据库.*锁|transaction busy|concurrent writes|并发写/i,
    rootCause: "数据库被并发写入锁定",
    fix: "缩短事务范围，串行化冲突写入，并为 SQLite 设置合理的 busy timeout。",
  },
  {
    category: "UI_LOCATOR",
    severity: "MEDIUM",
    pattern: /locator|selector|not found|未找到元素|元素.*出现|element/i,
    rootCause: "自动化定位器未匹配到目标页面元素",
    fix: "检查页面是否渲染成功，优先使用稳定的 role、label 或 data-testid 定位器。",
  },
  {
    category: "TIMEOUT",
    severity: "MEDIUM",
    pattern: /timeout|timed out|exceeded.*ms|超时/i,
    rootCause: "接口或页面在等待时间内未完成响应",
    fix: "定位慢查询或慢接口，优化执行时间并设置合理的等待阈值。",
  },
  {
    category: "FLAKY",
    severity: "LOW",
    pattern: /flaky|passed on retry|intermittent|重试后通过|parallel run|共享数据库/i,
    rootCause: "测试受共享状态或异步时序影响而不稳定",
    fix: "隔离测试数据，移除执行顺序依赖，并检查异步等待条件。",
  },
];

export function classifyOffline(log) {
  const categoryPriority = [
    "AUTHORIZATION",
    "AUTHENTICATION",
    "DATA_INTEGRITY",
    "FLAKY",
    "DATABASE_LOCK",
    "NETWORK",
    "UI_LOCATOR",
    "TIMEOUT",
    "BUSINESS_STATE",
    "VALIDATION",
  ];
  const rule = categoryPriority
    .map((category) =>
      triageRules.find((candidate) => candidate.category === category),
    )
    .find((candidate) => candidate.pattern.test(log));
  if (!rule) {
    return {
      category: "UNKNOWN",
      rootCause: "日志中缺少可识别的故障特征",
      evidence: [log.slice(0, 180)],
      suggestedFix: "补充失败断言、请求响应和前后日志后重新分诊。",
      severity: "UNKNOWN",
      confidence: 0.35,
    };
  }
  return {
    category: rule.category,
    rootCause: rule.rootCause,
    evidence: [log.split("\n")[0].slice(0, 180)],
    suggestedFix: rule.fix,
    severity: rule.severity,
    confidence: 0.82,
  };
}
