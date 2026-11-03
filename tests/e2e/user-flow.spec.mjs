import { expect, test } from "@playwright/test";
import {
  apiLogin,
  createTestEvent,
  loginUserUi,
  registerForEvent,
} from "./helpers.mjs";

test("用户可以在浏览器中完成登录、收藏、报名、缴费与评价", async ({
  page,
}) => {
  const adminSession = await apiLogin(page.request, "admin", "admin123");
  const event = await createTestEvent(page.request, adminSession, {
    title: `浏览器全流程赛事 ${Date.now()}`,
  });

  await page.goto("/user/");
  await expect(page.getByTestId("home-hero")).toBeVisible();
  await expect(page.getByTestId("home-event-list")).toBeVisible();
  await expect(page.getByTestId("event-card").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /RUN/ })).toBeVisible();

  await page.goto(`/user/#/event/${event.id}`);
  await expect(page.getByTestId("event-detail")).toBeVisible();
  await expect(page.getByRole("button", { name: "☆ 收藏" })).toBeVisible();

  await page.getByTestId("user-login-open").click();
  await expect(page.getByTestId("user-login-form")).toBeVisible();
  await page.getByTestId("login-submit").click();
  await expect(page.getByRole("button", { name: /奔跑的同学/ })).toBeVisible();

  await page.getByRole("button", { name: "☆ 收藏" }).click();
  await expect(page.getByRole("button", { name: "★ 已收藏" })).toBeVisible();

  await page.getByTestId("register-button").click();
  await expect(page.getByTestId("pay-button")).toBeVisible();
  await page.getByTestId("pay-button").click();
  await expect(page.getByTestId("registered-button")).toHaveText("已报名");

  await page.getByRole("link", { name: /查看 .* 条评价/ }).click();
  await expect(page.getByTestId("reviews-page")).toBeVisible();
  await page
    .locator("#review-content")
    .fill(`路线组织清晰，校园氛围很好。${Date.now()}`);
  await page.getByTestId("review-submit").click();
  await expect(page.getByText("评价已提交，等待管理员审核")).toBeVisible();

  await page.goto("/user/#/profile");
  await expect(page.getByTestId("profile-dashboard")).toBeVisible();
  await expect(
    page.locator(".registration-row", { hasText: event.title }),
  ).toContainText("已报名");
  await expect(page.getByText("1 场收藏赛事")).toBeVisible();
});

test("赛事筛选与搜索在用户网页端正常工作", async ({ page }) => {
  await page.goto("/user/#/events");
  await expect(page.getByTestId("event-grid")).toBeVisible();

  await page.getByTestId("event-filter-registering").click();
  const cards = page.getByTestId("event-card");
  await expect(cards.first()).toContainText("报名中");

  await page.locator('input[name="q"]').fill("2026 秋季校园马拉松");
  await page.locator("#event-search button").click();
  await expect(page.getByTestId("event-grid")).toBeVisible();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("2026 秋季校园马拉松");
});

test("未登录用户可以浏览赛事，但报名时会要求登录", async ({ page }) => {
  const adminSession = await apiLogin(page.request, "admin", "admin123");
  const event = await createTestEvent(page.request, adminSession);

  await page.goto(`/user/#/event/${event.id}`);
  await expect(page.getByTestId("event-detail")).toBeVisible();
  await page.getByTestId("register-button").click();
  await expect(page.getByTestId("user-login-form")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/event/${event.id}`));
});

test("错误密码显示登录错误，正确密码可以进入个人中心", async ({ page }) => {
  await page.goto("/user/");
  await page.getByTestId("user-login-open").click();
  await page.getByTestId("login-password").fill("wrong-password");
  await page.getByTestId("login-submit").click();
  await expect(page.locator("#login-error")).toContainText(
    "Invalid username or password",
  );

  await page.getByTestId("login-password").fill("user1234");
  await page.getByTestId("login-submit").click();
  await page.goto("/user/#/profile");
  await expect(page.getByTestId("profile-dashboard")).toBeVisible();
});

test("免费赛事报名后直接进入已报名状态", async ({ page }) => {
  const adminSession = await apiLogin(page.request, "admin", "admin123");
  const event = await createTestEvent(page.request, adminSession, {
    title: `免费欢乐跑 ${Date.now()}`,
    feeCents: 0,
  });

  await page.goto(`/user/#/event/${event.id}`);
  await loginUserUi(page);
  await page.getByTestId("register-button").click();
  await expect(page.getByTestId("registered-button")).toHaveText("已报名");
});

test("收藏赛事后可以在我的收藏中重新打开", async ({ page }) => {
  await page.goto("/user/");
  await page.getByTestId("event-card").first().click();
  await page.getByRole("button", { name: "☆ 收藏" }).click();
  await expect(page.getByRole("button", { name: "★ 已收藏" })).toBeVisible();

  await page.goto("/user/#/favorites");
  await expect(page.getByTestId("event-card")).toHaveCount(1);
});

test("用户可以对已报名赛事提交待审核评价", async ({ page }) => {
  const adminSession = await apiLogin(page.request, "admin", "admin123");
  const userSession = await apiLogin(page.request, "user", "user1234");
  const event = await createTestEvent(page.request, adminSession);
  await registerForEvent(page.request, userSession, event.id);

  await page.goto(`/user/#/reviews/${event.id}`);
  await loginUserUi(page);
  await page.locator("#review-content").fill("独立的评价端到端测试内容。");
  await page.getByTestId("review-submit").click();
  await expect(page.getByText("评价已提交，等待管理员审核")).toBeVisible();
});

test("未登录访问证书页面会返回个人登录入口", async ({ page }) => {
  await page.goto("/user/#/certificates");
  await expect(page).toHaveURL(/#\/profile$/);
  await expect(page.getByTestId("profile-login-panel")).toBeVisible();
});
