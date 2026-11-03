# Playwright 稳定性基线

- 浏览器：Microsoft Edge
- 端到端场景：14 条
- 重复执行：3 轮
- 总执行次数：42
- 通过：42
- 失败：0
- Flaky：0
- 总耗时：1.2 分钟

执行命令：

```powershell
npx playwright test --repeat-each=3
```

首轮重复测试发现赛事标题、评价内容和公共用户报名状态存在测试数据污染。测试已改为每个场景创建独立赛事和唯一业务数据，最终三轮全部通过。
