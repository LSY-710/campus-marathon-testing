# 校园马拉松赛事服务平台

这是一个用于软件测试与测试开发实践的全栈项目。项目根据校园马拉松小程序的功能展示重新设计并独立实现，重点建设可验证的业务状态、权限边界和自动化测试体系。

## 当前范围

- 用户：活动列表、搜索、详情、报名、模拟缴费、评价、个人报名与证书。
- 管理员：工作台、赛事、报名、成绩、证书、学校和评价审核。
- 测试：单元测试、接口测试和业务状态流转测试。
- 数据：Node.js 内置 SQLite，默认数据库为 `data/marathon.db`。

微信支付、真实微信登录、对象存储等外部依赖通过演示适配方式处理。生产接入时需要配置微信 AppID、商户号和文件存储。

## 运行

需要 Node.js 22.5 或更高版本。

```powershell
npm start
```

启动后访问：

- 用户端：`http://localhost:3000/user/`
- 管理端：`http://localhost:3000/admin/`
- 健康检查：`http://localhost:3000/api/health`
- 小程序接口：`http://localhost:3000/api/`

演示账号：

- 管理员：`admin` / `admin123`
- 普通用户：`user` / `user1234`

## 测试

```powershell
npm test
```

测试使用独立的内存数据库，不会污染本地演示数据。

浏览器端到端测试使用本机 Microsoft Edge：

```powershell
npm run test:e2e
```

测试覆盖普通用户登录、收藏、报名、缴费、评价、搜索筛选，以及管理员登录、赛事创建和评价审核。

微信小程序冒烟测试需要先登录微信开发者工具，并保持 API 服务运行：

```powershell
& "D:\HBuilderx\微信web开发者工具\cli.bat" auto `
  --project ".\apps\miniapp" `
  --port 9420 `
  --auto-port 9422 `
  --trust-project

$env:WECHAT_WS = "ws://127.0.0.1:9422"
npm run test:miniapp
```

测试覆盖首页、赛事列表、详情、登录、个人中心、评价和证书页面，截图保存在 `test-results/miniapp`。

## AI 测试

未配置 API 密钥时默认运行为可重复的离线基线，用于验证测试设计、结果结构和评估逻辑：

```powershell
npm run ai:generate -- --offline
npm run ai:evaluate -- --offline
npm run test:ai
```

配置 `DEEPSEEK_API_KEY` 后，移除 `--offline` 即可调用 DeepSeek：

```powershell
$env:DEEPSEEK_API_KEY = "<set-in-local-environment>"
npm run ai:generate
npm run ai:evaluate
```

接口规范位于 `docs/openapi.json`。AI 生成与故障分诊报告分别写入 `reports/ai-test-cases.md` 和 `reports/ai-triage-evaluation.md`。离线基线的指标只用于验证工具链，不作为真实模型效果或简历业绩。

## 目录

```text
apps/
  api/          API 服务、数据库与领域逻辑
  admin/        管理员 Web 端
  miniapp/      原生微信小程序
  user-web/     普通用户 H5 网页
docs/
  openapi.json
  product-scope.md
  test-strategy.md
ai/
  requirements.json
  triage-scenarios.json
scripts/
  seed.mjs
tests/
  e2e/          Playwright 浏览器端到端测试
```

## 下一阶段

1. 完善收藏管理、资料编辑、我的评价和证书 PDF 下载。
2. 扩充 Playwright 管理端与小程序端到端场景。
3. 接入 CI、性能基线与安全测试。
4. 建立 AI 测试用例生成和失败分诊评估集。
