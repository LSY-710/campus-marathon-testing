import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApplication } from "../apps/api/src/app.mjs";

let application;
let baseUrl;
let userToken;
let user;
let adminToken;
let admin;
let signupEvent;
let registrationId;
let reviewId;

async function request(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

before(async () => {
  application = createApplication({
    dbPath: ":memory:",
    authSecret: "test-secret-with-enough-entropy",
  });
  await new Promise((resolve) => {
    application.server.listen(0, "127.0.0.1", resolve);
  });
  const address = application.server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (application) {
    await application.close();
  }
});

test("health endpoint reports service availability", async () => {
  const { response, payload } = await request("/api/health");
  assert.equal(response.status, 200);
  assert.equal(payload.status, "ok");
  assert.equal(payload.service, "marathon-platform");
});

test("administrator console is served without exposing API data", async () => {
  const response = await fetch(`${baseUrl}/admin/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(response.headers.get("content-security-policy"), /default-src/);
  const html = await response.text();
  assert.match(html, /马拉松管理系统/);
});

test("user web console and root redirect are available", async () => {
  const root = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/user/");

  const response = await fetch(`${baseUrl}/user/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const html = await response.text();
  assert.match(html, /CAMPUS RUN/);
});

test("authentication rejects invalid credentials and issues roles", async () => {
  const invalid = await request("/api/auth/login", {
    method: "POST",
    body: { username: "user", password: "wrong-password" },
  });
  assert.equal(invalid.response.status, 401);
  assert.equal(invalid.payload.error.code, "INVALID_CREDENTIALS");

  const userLogin = await request("/api/auth/login", {
    method: "POST",
    body: { username: "user", password: "user1234" },
  });
  assert.equal(userLogin.response.status, 200);
  assert.equal(userLogin.payload.user.role, "USER");
  userToken = userLogin.payload.token;
  user = userLogin.payload.user;

  const adminLogin = await request("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: "admin123" },
  });
  assert.equal(adminLogin.response.status, 200);
  assert.equal(adminLogin.payload.user.role, "ADMIN");
  adminToken = adminLogin.payload.token;
  admin = adminLogin.payload.user;
});

test("protected endpoints require authentication and role permissions", async () => {
  const missingToken = await request("/api/me/registrations");
  assert.equal(missingToken.response.status, 401);

  const wrongRole = await request("/api/admin/dashboard", {
    token: userToken,
  });
  assert.equal(wrongRole.response.status, 403);
  assert.equal(wrongRole.payload.error.code, "FORBIDDEN");
});

test("event discovery supports status filtering and search", async () => {
  const all = await request("/api/events?pageSize=50");
  assert.equal(all.response.status, 200);
  assert.ok(all.payload.items.length >= 5);
  assert.ok(all.payload.items.some((event) => event.status === "REGISTERING"));
  assert.ok(all.payload.items.some((event) => event.status === "UPCOMING"));
  assert.ok(all.payload.items.some((event) => event.status === "ENDED"));

  signupEvent = all.payload.items.find(
    (event) => event.status === "REGISTERING" && event.feeCents > 0,
  );
  assert.ok(signupEvent);

  const filtered = await request(
    "/api/events?status=REGISTERING&q=%E6%A0%A1%E5%9B%AD",
  );
  assert.equal(filtered.response.status, 200);
  assert.ok(
    filtered.payload.items.every((event) => event.status === "REGISTERING"),
  );
  assert.ok(
    filtered.payload.items.every((event) =>
      `${event.title} ${event.location} ${event.description}`.includes("校园"),
    ),
  );
});

test("registration follows the waiting-payment state and blocks duplicates", async () => {
  const created = await request(
    `/api/events/${signupEvent.id}/registrations`,
    { method: "POST", token: userToken },
  );
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.registration.status, "WAIT_PAYMENT");
  registrationId = created.payload.registration.id;

  const duplicate = await request(
    `/api/events/${signupEvent.id}/registrations`,
    { method: "POST", token: userToken },
  );
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.payload.error.code, "ALREADY_REGISTERED");

  const paid = await request(`/api/registrations/${registrationId}/pay`, {
    method: "POST",
    token: userToken,
  });
  assert.equal(paid.response.status, 200);
  assert.equal(paid.payload.registration.status, "REGISTERED");

  const mine = await request("/api/me/registrations", { token: userToken });
  const saved = mine.payload.items.find((item) => item.id === registrationId);
  assert.equal(saved.status, "REGISTERED");
  assert.ok(saved.paidAt);
});

test("review stays private until an administrator approves it", async () => {
  const created = await request(
    `/api/events/${signupEvent.id}/reviews`,
    {
      method: "POST",
      token: userToken,
      body: { content: "路线组织清晰，补给点安排合理。" },
    },
  );
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.review.status, "PENDING");
  reviewId = created.payload.review.id;

  const publicBefore = await request(
    `/api/events/${signupEvent.id}/reviews`,
  );
  assert.equal(publicBefore.response.status, 200);
  assert.ok(
    publicBefore.payload.items.every((review) => review.id !== reviewId),
  );

  const approve = await request(`/api/admin/reviews/${reviewId}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "APPROVED" },
  });
  assert.equal(approve.response.status, 200);

  const publicAfter = await request(
    `/api/events/${signupEvent.id}/reviews`,
  );
  assert.ok(publicAfter.payload.items.some((review) => review.id === reviewId));
});

test("review ownership prevents other users or administrators from deleting user content", async () => {
  const denied = await request(`/api/reviews/${reviewId}`, {
    method: "DELETE",
    token: adminToken,
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.payload.error.code, "FORBIDDEN");
});

test("result and certificate preserve completion and issuance constraints", async () => {
  const result = await request("/api/admin/results", {
    method: "POST",
    token: adminToken,
    body: {
      userId: user.id,
      eventId: signupEvent.id,
      finishTimeSeconds: 3588,
      groupName: "10 公里大众组",
    },
  });
  assert.equal(result.response.status, 201);

  const registrations = await request("/api/me/registrations", {
    token: userToken,
  });
  assert.equal(
    registrations.payload.items.find((item) => item.id === registrationId)
      .status,
    "COMPLETED",
  );

  const created = await request("/api/admin/certificates", {
    method: "POST",
    token: adminToken,
    body: { userId: user.id, eventId: signupEvent.id },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.certificate.status, "UNISSUED");

  const beforeIssue = await request("/api/me/certificates", {
    token: userToken,
  });
  assert.equal(beforeIssue.payload.items.length, 0);

  const issued = await request(
    `/api/admin/certificates/${created.payload.certificate.id}/issue`,
    { method: "PATCH", token: adminToken },
  );
  assert.equal(issued.response.status, 200);
  assert.equal(issued.payload.certificate.status, "ISSUED");

  const afterIssue = await request("/api/me/certificates", {
    token: userToken,
  });
  assert.equal(afterIssue.payload.items.length, 1);
  assert.equal(afterIssue.payload.items[0].eventId, signupEvent.id);
  assert.match(afterIssue.payload.items[0].serialNo, /^MAR-\d{4}-[A-F0-9]{8}$/);
});

test("administrator can create an event only when date ordering is valid", async () => {
  const now = new Date();
  const later = (days) =>
    new Date(now.getTime() + days * 86400000).toISOString();
  const body = {
    title: "接口测试校园夜跑",
    description: "用于验证管理员创建赛事和日期边界。",
    location: "东区运动场",
    registrationOpensAt: later(1),
    registrationClosesAt: later(5),
    startsAt: later(8),
    endsAt: later(8.2),
    feeCents: 3000,
    capacity: 120,
    published: true,
  };
  const created = await request("/api/admin/events", {
    method: "POST",
    token: adminToken,
    body,
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.event.title, body.title);

  const invalid = await request("/api/admin/events", {
    method: "POST",
    token: adminToken,
    body: { ...body, registrationClosesAt: later(9) },
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.payload.error.code, "VALIDATION_ERROR");
});
