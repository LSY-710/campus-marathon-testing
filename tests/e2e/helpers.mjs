import { expect } from "@playwright/test";

export async function apiLogin(request, username, password) {
  const response = await request.post("/api/auth/login", {
    data: { username, password },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

export function authHeaders(session) {
  return { Authorization: `Bearer ${session.token}` };
}

export async function createTestEvent(request, adminSession, overrides = {}) {
  const now = Date.now();
  const iso = (hours) => new Date(now + hours * 3_600_000).toISOString();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = {
    title: `自动化测试赛事 ${suffix}`,
    description: "用于 Playwright 端到端测试的独立赛事数据。",
    location: "测试体育场",
    registrationOpensAt: iso(-2),
    registrationClosesAt: iso(48),
    startsAt: iso(72),
    endsAt: iso(76),
    feeCents: 5000,
    capacity: 100,
    published: true,
    ...overrides,
  };
  const response = await request.post("/api/admin/events", {
    headers: authHeaders(adminSession),
    data: body,
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).event;
}

export async function registerForEvent(
  request,
  userSession,
  eventId,
  { pay = true } = {},
) {
  const response = await request.post(`/api/events/${eventId}/registrations`, {
    headers: authHeaders(userSession),
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  if (pay && payload.registration.status === "WAIT_PAYMENT") {
    const paid = await request.post(
      `/api/registrations/${payload.registration.id}/pay`,
      { headers: authHeaders(userSession) },
    );
    expect(paid.ok()).toBeTruthy();
  }
  return payload.registration;
}

export async function loginUserUi(page) {
  await page.getByTestId("user-login-open").click();
  await page.getByTestId("login-submit").click();
  await expect(page.getByRole("button", { name: /奔跑的同学/ })).toBeVisible();
}

export async function loginAdminUi(page) {
  await page.goto("/admin/");
  await page.locator('input[name="username"]').fill("admin");
  await page.locator('input[name="password"]').fill("admin123");
  await page.getByRole("button", { name: "登录系统" }).click();
  await expect(page.locator("#page-title")).toHaveText("工作台");
}
