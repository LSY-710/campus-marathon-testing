# 安全测试报告

执行命令：

```powershell
npm run test:security
npm run test:concurrency
```

## 结果

- 安全测试：6/6 通过。
- 并发报名测试：1/1 通过。
- 生产依赖漏洞：0。

## 覆盖项

- API、用户端和管理端安全响应头。
- 篡改 Bearer Token 被拒绝。
- 客户端提交管理员角色不能提升权限。
- SQL 注入形态的搜索词按普通文本处理。
- 登录错误不泄露密码哈希或内部堆栈。
- 登录失败达到阈值后返回 429 和 Retry-After。
- 24 个用户并发争抢 10 个名额时，仅 10 个报名成功，14 个返回冲突，剩余名额为 0。

## 加固措施

- 增加 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 和 `Permissions-Policy`。
- 对登录失败按客户端地址与用户名实施 60 秒窗口限流。
- 所有角色和权限仍以服务器数据库中的身份为准。
