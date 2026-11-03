import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createApplication } from "../apps/api/src/app.mjs";
import { hashPassword, signToken } from "../apps/api/src/auth.mjs";

let application;
let baseUrl;
let adminToken;
let userTokens;

before(async () => {
  application = createApplication({
    dbPath: ":memory:",
    authSecret: "concurrency-test-secret",
  });
  await new Promise((resolve) => {
    application.server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${application.server.address().port}`;

  const admin = application.db
    .prepare("SELECT * FROM users WHERE username = 'admin'")
    .get();
  adminToken = signToken(admin, "concurrency-test-secret");

  const insertUser = application.db.prepare(
    `INSERT INTO users
       (id, username, password_hash, role, nickname, avatar_url, created_at)
     VALUES (?, ?, ?, 'USER', ?, NULL, ?)`,
  );
  const passwordHash = hashPassword("concurrency123");
  userTokens = Array.from({ length: 24 }, (_, index) => {
    const id = `concurrent-user-${index}`;
    insertUser.run(id, `concurrent-${index}`, passwordHash, `并发用户${index}`, new Date().toISOString());
    return signToken({ id, role: "USER" }, "concurrency-test-secret");
  });
});

after(async () => {
  if (application) await application.close();
});

async function jsonRequest(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

test("concurrent registration never exceeds event capacity", async () => {
  const eventId = randomUUID();
  const now = Date.now();
  const iso = (hours) => new Date(now + hours * 3_600_000).toISOString();
  application.db
    .prepare(
      `INSERT INTO events (
         id, title, description, location, cover_url, starts_at, ends_at,
         registration_opens_at, registration_closes_at, fee_cents, capacity,
         published, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, 10, 1, ?, ?)`,
    )
    .run(
      eventId,
      "并发报名测试",
      "验证并发报名不会突破名额上限。",
      "并发测试场",
      iso(24),
      iso(26),
      iso(-1),
      iso(12),
      new Date().toISOString(),
      new Date().toISOString(),
    );

  const results = await Promise.all(
    userTokens.map((token) =>
      jsonRequest(`/api/events/${eventId}/registrations`, {
        method: "POST",
        token,
      }),
    ),
  );
  assert.equal(results.filter((result) => result.status === 201).length, 10);
  assert.equal(results.filter((result) => result.status === 409).length, 14);

  const detail = await jsonRequest(`/api/events/${eventId}`);
  assert.equal(detail.payload.event.registeredCount, 10);
  assert.equal(detail.payload.event.remainingSlots, 0);
});
