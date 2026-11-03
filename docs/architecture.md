# 系统架构

```text
微信小程序 ─┐
           ├─ HTTP JSON API ─ SQLite
管理后台 ──┘
                 │
                 ├─ 鉴权与角色权限
                 ├─ 赛事 / 报名 / 评价
                 └─ 成绩 / 证书 / 学校
```

## 核心模块

- `apps/miniapp`：用户端微信小程序。
- `apps/admin`：管理员 Web 控制台。
- `apps/api`：统一 API、认证、业务规则和 SQLite 数据访问。
- `tests`：领域单元测试与接口集成测试。

## 业务状态机

报名：

```text
WAIT_PAYMENT -> REGISTERED -> COMPLETED
WAIT_PAYMENT -> CANCELLED
REGISTERED   -> CANCELLED
```

评价：

```text
PENDING -> APPROVED
PENDING -> REJECTED
```

证书：

```text
UNISSUED -> ISSUED
```

## 关键设计

- 用户和赛事时间窗口由服务器时间判断，避免依赖客户端时间。
- 正式报名要求完成缴费，成绩录入也只接受已缴费报名。
- 评价默认待审核，公开接口只返回已通过内容。
- 管理员接口统一要求 `ADMIN` 角色。
- 测试使用内存 SQLite，保证用例可重复且互不污染。
