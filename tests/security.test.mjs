import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApplication } from "../apps/api/src/app.mjs";

let application;
let baseUrl;

async function request(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

before(async () => {
  application = createApplication({
    dbPath: ":memory:",
    authSecret: "security-test-secret",
  });
  await new Promise((resolve) => {
    application.server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${application.server.address().port}`;
});

after(async () => {
  if (application) await application.close();
});

test("security headers are present on API and static responses", async () => {
  for (const path of ["/api/health", "/user/", "/admin/"]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  }
});

test("tampered bearer token is rejected", async () => {
  const login = await request("/api/auth/login", {
    method: "POST",
    body: { username: "user", password: "user1234" },
  });
  const result = await request("/api/me", {
    token: `${login.payload.token}tampered`,
  });
  assert.equal(result.response.status, 401);
  assert.equal(result.payload.error.code, "UNAUTHORIZED");
});

test("client-supplied role fields cannot elevate privileges", async () => {
  const login = await request("/api/auth/login", {
    method: "POST",
    body: { username: "user", password: "user1234", role: "ADMIN" },
  });
  assert.equal(login.payload.user.role, "USER");
  const dashboard = await request("/api/admin/dashboard", {
    token: login.payload.token,
  });
  assert.equal(dashboard.response.status, 403);
});

test("SQL injection shaped search text is treated as data", async () => {
  const payload = await request(
    `/api/events?q=${encodeURIComponent("' OR 1=1 --")}`,
  );
  assert.equal(payload.response.status, 200);
  assert.deepEqual(payload.payload.items, []);
});

test("login errors do not expose stack traces or stored password hashes", async () => {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: { username: "user", password: "wrong-password" },
  });
  const serialized = JSON.stringify(result.payload);
  assert.equal(result.response.status, 401);
  assert.doesNotMatch(serialized, /scrypt:|at .*app\.mjs/i);
});

test("repeated failed logins are rate limited", async () => {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    last = await request("/api/auth/login", {
      method: "POST",
      body: { username: "runner2", password: `wrong-${attempt}-password` },
    });
  }
  assert.equal(last.response.status, 429);
  assert.equal(last.payload.error.code, "LOGIN_RATE_LIMITED");
  assert.ok(Number(last.response.headers.get("retry-after")) > 0);
});
