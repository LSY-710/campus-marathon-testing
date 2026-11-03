import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveEventStatus,
  registrationAvailability,
} from "../apps/api/src/event-status.mjs";
import {
  hashPassword,
  signToken,
  verifyPassword,
  verifyToken,
} from "../apps/api/src/auth.mjs";

const event = {
  published: 1,
  registration_opens_at: "2026-11-01T00:00:00.000Z",
  registration_closes_at: "2026-11-10T00:00:00.000Z",
  starts_at: "2026-11-15T00:00:00.000Z",
  ends_at: "2026-11-15T06:00:00.000Z",
};

test("event status covers upcoming, registering and ended boundaries", () => {
  assert.equal(
    deriveEventStatus(event, new Date("2026-10-31T23:59:59.000Z")),
    "UPCOMING",
  );
  assert.equal(
    deriveEventStatus(event, new Date("2026-11-01T00:00:00.000Z")),
    "REGISTERING",
  );
  assert.equal(
    deriveEventStatus(event, new Date("2026-11-10T00:00:00.000Z")),
    "REGISTERING",
  );
  assert.equal(
    deriveEventStatus(event, new Date("2026-11-15T06:00:01.000Z")),
    "ENDED",
  );
});

test("registration availability exposes a reason outside the window", () => {
  assert.deepEqual(
    registrationAvailability(event, new Date("2026-10-31T12:00:00.000Z")),
    { open: false, reason: "报名尚未开始" },
  );
  assert.deepEqual(
    registrationAvailability(event, new Date("2026-11-05T12:00:00.000Z")),
    { open: true, reason: null },
  );
  assert.deepEqual(
    registrationAvailability(event, new Date("2026-11-11T12:00:00.000Z")),
    { open: false, reason: "报名已截止" },
  );
});

test("password hashes verify only the original password", () => {
  const encoded = hashPassword("secure-password");
  assert.notEqual(encoded, "secure-password");
  assert.equal(verifyPassword("secure-password", encoded), true);
  assert.equal(verifyPassword("incorrect-password", encoded), false);
});

test("signed tokens preserve claims and reject tampering or expiry", () => {
  const user = { id: "user-1", role: "USER" };
  const token = signToken(user, "test-secret", 60);
  const claims = verifyToken(token, "test-secret");
  assert.equal(claims.sub, user.id);
  assert.equal(claims.role, user.role);
  assert.equal(verifyToken(`${token}x`, "test-secret"), null);
  assert.equal(verifyToken(token, "wrong-secret"), null);

  const expired = signToken(user, "test-secret", -1);
  assert.equal(verifyToken(expired, "test-secret"), null);
});
