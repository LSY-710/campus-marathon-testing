import { expect, test } from "@playwright/test";
import {
  apiLogin,
  createTestEvent,
  loginAdminUi,
  registerForEvent,
} from "./helpers.mjs";

test("管理员可以登录、查看工作台并创建赛事", async ({ page }) => {
  await page.goto("/admin/");

  await expect(page.getByRole("heading", { name: "马拉松管理系统" })).toBeVisible();
  await page.locator('input[name="username"]').fill("admin");
  await page.locator('input[name="password"]').fill("admin123");
  await page.getByRole("button", { name: "登录系统" }).click();

  await expect(page.locator("#page-title")).toHaveText("工作台");
  await expect(page.getByText("总赛事数")).toBeVisible();
  await expect(page.getByText("正式报名人数")).toBeVisible();

  await page.getByRole("button", { name: "新建赛事" }).click();
  const dialog = page.locator("#resource-dialog");
  await expect(dialog).toBeVisible();
  const title = `Playwright 自动化测试校园跑 ${Date.now()}`;
  await dialog.getByLabel("赛事名称").fill(title);
  await dialog.getByLabel("举办地点").fill("东区体育场");
  await dialog
    .getByLabel("活动介绍")
    .fill("用于验证管理员创建赛事流程的自动化测试赛事。");
  await dialog.getByRole("button", { name: "保存" }).click();

  await expect(page.getByText("赛事已创建")).toBeVisible();
  await expect(page.locator("#page-title")).toHaveText("赛事管理");
  await expect(page.locator("#page-content h2").first()).toHaveText("赛事管理");
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
});

test("管理员可以审核用户提交的比赛评价", async ({ page, request }) => {
  const adminSession = await apiLogin(request, "admin", "admin123");
  const userSession = await apiLogin(request, "runner2", "runner123");
  const event = await createTestEvent(request, adminSession);
  await registerForEvent(request, userSession, event.id);

  const reviewContent = `等待审核的端到端测试评价 ${Date.now()}`;
  const review = await request.post(`/api/events/${event.id}/reviews`, {
    headers: { Authorization: `Bearer ${userSession.token}` },
    data: { content: reviewContent },
  });
  expect(review.ok()).toBeTruthy();

  await loginAdminUi(page);
  await page.locator('[data-page="reviews"]').click();

  const reviewRow = page.locator("tr", {
    hasText: reviewContent,
  });
  await expect(reviewRow).toBeVisible();
  await reviewRow.getByRole("button", { name: "通过" }).click();
  await expect(page.getByText("评价审核完成")).toBeVisible();
  await expect(
    page.locator("tr", {
      hasText: reviewContent,
    }),
  ).toContainText("已通过");
});

test("管理员可以编辑并删除独立赛事", async ({ page, request }) => {
  const adminSession = await apiLogin(request, "admin", "admin123");
  const event = await createTestEvent(request, adminSession, {
    title: `待编辑赛事 ${Date.now()}`,
  });

  await loginAdminUi(page);
  await page.locator('[data-page="events"]').click();
  const row = page.locator("tr", { hasText: event.title });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "编辑" }).click();
  const dialog = page.locator("#resource-dialog");
  await dialog.getByLabel("赛事名称").fill(`${event.title} 已编辑`);
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("赛事已更新")).toBeVisible();
  await expect(page.getByText(`${event.title} 已编辑`)).toBeVisible();

  page.once("dialog", (confirmation) => confirmation.accept());
  const editedRow = page.locator("tr", { hasText: `${event.title} 已编辑` });
  await editedRow.getByRole("button", { name: "删除" }).click();
  await expect(page.getByText("赛事已删除")).toBeVisible();
  await expect(page.getByText(`${event.title} 已编辑`)).toHaveCount(0);
});

test("管理员可以按赛事名称搜索", async ({ page, request }) => {
  const adminSession = await apiLogin(request, "admin", "admin123");
  const event = await createTestEvent(request, adminSession, {
    title: `搜索目标赛事 ${Date.now()}`,
  });

  await loginAdminUi(page);
  await page.locator('[data-page="events"]').click();
  await page.locator('form[data-search-form="events"] input[name="q"]').fill(
    event.title,
  );
  await page.locator('form[data-search-form="events"] button').click();
  await expect(page.getByText(event.title)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("普通用户不能通过网页进入管理员工作台", async ({ page }) => {
  await page.goto("/admin/");
  await page.locator('input[name="username"]').fill("user");
  await page.locator('input[name="password"]').fill("user1234");
  await page.getByRole("button", { name: "登录系统" }).click();
  await expect(page.locator("#login-error")).toContainText(
    "当前账号不是管理员",
  );
  await expect(page.locator("#app-view")).toBeHidden();
});

test("管理员可以按状态筛选报名记录", async ({ page, request }) => {
  const adminSession = await apiLogin(request, "admin", "admin123");
  const userSession = await apiLogin(request, "runner2", "runner123");
  const event = await createTestEvent(request, adminSession);
  await request.post(`/api/events/${event.id}/registrations`, {
    headers: { Authorization: `Bearer ${userSession.token}` },
  });

  await loginAdminUi(page);
  await page.locator('[data-page="registrations"]').click();
  await page.locator('form[data-search-form="registrations"] select').selectOption(
    "WAIT_PAYMENT",
  );
  await page.locator('form[data-search-form="registrations"] button').click();
  const row = page.locator("tr", { hasText: event.title });
  await expect(row).toBeVisible();
  await expect(row).toContainText("待缴费");
});
