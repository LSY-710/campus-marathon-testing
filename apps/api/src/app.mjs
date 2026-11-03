import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db.mjs";
import {
  deriveEventStatus,
  registrationAvailability,
  serializeEvent,
} from "./event-status.mjs";
import { signToken, verifyPassword, verifyToken } from "./auth.mjs";
import {
  assertDateOrder,
  HttpError,
  nowIso,
  optionalString,
  paginate,
  parsePagination,
  requireDate,
  requireInteger,
  requireString,
} from "./validation.mjs";

const ADMIN_DIR = fileURLToPath(new URL("../../admin/", import.meta.url));
const USER_WEB_DIR = fileURLToPath(new URL("../../user-web/", import.meta.url));
const MAX_BODY_BYTES = 1024 * 1024;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function addCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJson(res, status, payload) {
  addCorsHeaders(res);
  const body = payload === undefined ? "" : JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res, error) {
  if (error instanceof HttpError) {
    sendJson(res, error.status, {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  console.error(error);
  sendJson(res, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    },
  });
}

function isUniqueConstraint(error) {
  return String(error?.message ?? "").includes("UNIQUE constraint failed");
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

function currentUser(req, db, secret) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const claims = verifyToken(header.slice(7), secret);
  if (!claims) {
    return null;
  }
  return (
    db
      .prepare(
        "SELECT id, username, role, nickname, avatar_url, created_at FROM users WHERE id = ?",
      )
      .get(claims.sub) ?? null
  );
}

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    nickname: user.nickname,
    avatarUrl: user.avatar_url,
    createdAt: user.created_at,
  };
}

function registrationsForEvent(db, eventId) {
  return Number(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM registrations
         WHERE event_id = ? AND status IN ('WAIT_PAYMENT', 'REGISTERED', 'COMPLETED')`,
      )
      .get(eventId).count,
  );
}

function eventPayload(db, event) {
  return serializeEvent(event, {
    registeredCount: registrationsForEvent(db, event.id),
  });
}

function normalizeEventInput(body, existing = null) {
  const title = requireString(
    body.title ?? existing?.title,
    "title",
    { min: 2, max: 120 },
  );
  const description = requireString(
    body.description ?? existing?.description,
    "description",
    { min: 5, max: 3000 },
  );
  const location = requireString(
    body.location ?? existing?.location,
    "location",
    { min: 2, max: 200 },
  );
  const startsAt = requireDate(
    body.startsAt ?? existing?.starts_at,
    "startsAt",
  );
  const endsAt = requireDate(body.endsAt ?? existing?.ends_at, "endsAt");
  const registrationOpensAt = requireDate(
    body.registrationOpensAt ?? existing?.registration_opens_at,
    "registrationOpensAt",
  );
  const registrationClosesAt = requireDate(
    body.registrationClosesAt ?? existing?.registration_closes_at,
    "registrationClosesAt",
  );
  const feeCents = requireInteger(
    body.feeCents ?? existing?.fee_cents ?? 0,
    "feeCents",
    { min: 0, max: 10_000_000 },
  );
  const capacity = requireInteger(
    body.capacity ?? existing?.capacity,
    "capacity",
    { min: 1, max: 100_000 },
  );
  const published =
    body.published === undefined
      ? Boolean(existing?.published ?? true)
      : Boolean(body.published);
  const coverUrl = optionalString(
    body.coverUrl ?? existing?.cover_url,
    "coverUrl",
    { max: 2000 },
  );

  assertDateOrder({
    registrationOpensAt,
    registrationClosesAt,
    startsAt,
    endsAt,
  });

  return {
    title,
    description,
    location,
    startsAt,
    endsAt,
    registrationOpensAt,
    registrationClosesAt,
    feeCents,
    capacity,
    published,
    coverUrl,
  };
}

function registrationRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    nickname: row.nickname,
    eventId: row.event_id,
    eventTitle: row.event_title,
    eventStartsAt: row.event_starts_at,
    status: row.status,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

function reviewRow(row, { admin = false } = {}) {
  return {
    id: row.id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    content: row.content,
    nickname: admin ? row.nickname : "匿名用户",
    status: admin ? row.status : undefined,
    createdAt: row.created_at,
    reviewedAt: admin ? row.reviewed_at : undefined,
    mine: Boolean(row.mine),
  };
}

function certificateRow(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    eventStartsAt: row.event_starts_at,
    eventLocation: row.event_location,
    nickname: row.nickname,
    groupName: row.group_name,
    finishTimeSeconds: row.finish_time_seconds,
    eventDescription: row.event_description,
    serialNo: row.serial_no,
    status: row.status,
    issuedAt: row.issued_at,
    createdAt: row.created_at,
  };
}

function normalizeEventFilter(value) {
  const normalized = String(value ?? "ALL").trim().toUpperCase();
  const aliases = {
    ALL: "ALL",
    "全部": "ALL",
    REGISTERING: "REGISTERING",
    "报名中": "REGISTERING",
    UPCOMING: "UPCOMING",
    "未开始": "UPCOMING",
    ENDED: "ENDED",
    "已结束": "ENDED",
  };
  return aliases[normalized] ?? "ALL";
}

function createRoutes(db, authSecret) {
  const loginFailures = new Map();
  const loginWindowMs = 60_000;
  const maxLoginFailures = 5;
  const requiredRegistration = db.prepare(`
    SELECT status
    FROM registrations
    WHERE user_id = ? AND event_id = ?
  `);

  return [
    {
      method: "POST",
      pattern: /^\/api\/auth\/login$/,
      handler({ req, body, res }) {
        const username = requireString(body.username, "username", {
          min: 3,
          max: 50,
        });
        const password = requireString(body.password, "password", {
          min: 8,
          max: 200,
        });
        const attemptKey = `${req.socket.remoteAddress ?? "unknown"}|${username}`;
        const now = Date.now();
        const attempt = loginFailures.get(attemptKey);
        if (attempt?.blockedUntil > now) {
          const retryAfterSeconds = Math.ceil(
            (attempt.blockedUntil - now) / 1000,
          );
          res.setHeader("Retry-After", String(retryAfterSeconds));
          throw new HttpError(
            429,
            "LOGIN_RATE_LIMITED",
            "Too many failed login attempts",
            { retryAfterSeconds },
          );
        }
        const user = db
          .prepare("SELECT * FROM users WHERE username = ?")
          .get(username);

        if (!user || !verifyPassword(password, user.password_hash)) {
          const failures =
            attempt && now - attempt.firstFailureAt < loginWindowMs
              ? attempt.count + 1
              : 1;
          const blockedUntil =
            failures >= maxLoginFailures ? now + loginWindowMs : 0;
          loginFailures.set(attemptKey, {
            count: failures,
            firstFailureAt: attempt?.firstFailureAt ?? now,
            blockedUntil,
          });
          if (blockedUntil) {
            res.setHeader("Retry-After", "60");
          }
          throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid username or password");
        }
        loginFailures.delete(attemptKey);

        sendJson(res, 200, {
          token: signToken(user, authSecret),
          user: serializeUser(user),
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/me$/,
      roles: ["USER", "ADMIN"],
      handler({ user, res }) {
        sendJson(res, 200, { user: serializeUser(user) });
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/me$/,
      roles: ["USER", "ADMIN"],
      handler({ user, body, res }) {
        const nickname = requireString(
          body.nickname ?? user.nickname,
          "nickname",
          { min: 2, max: 40 },
        );
        const avatarUrl = optionalString(
          body.avatarUrl ?? user.avatar_url,
          "avatarUrl",
          { max: 2000 },
        );
        db.prepare(
          "UPDATE users SET nickname = ?, avatar_url = ? WHERE id = ?",
        ).run(nickname, avatarUrl, user.id);
        const updated = db
          .prepare("SELECT * FROM users WHERE id = ?")
          .get(user.id);
        sendJson(res, 200, { user: serializeUser(updated) });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/events$/,
      handler({ query, res }) {
        const keyword = (query.get("q") ?? "").trim().toLowerCase();
        const requestedStatus = normalizeEventFilter(query.get("status"));
        const pagination = parsePagination(query);
        let events = db
          .prepare(
            "SELECT * FROM events WHERE published = 1 ORDER BY starts_at ASC",
          )
          .all()
          .map((event) => eventPayload(db, event));

        if (keyword) {
          events = events.filter((event) =>
            [event.title, event.location, event.description]
              .join(" ")
              .toLowerCase()
              .includes(keyword),
          );
        }
        if (requestedStatus !== "ALL") {
          events = events.filter((event) => event.status === requestedStatus);
        }
        const statusOrder = { REGISTERING: 0, UPCOMING: 1, ENDED: 2 };
        events.sort(
          (left, right) =>
            statusOrder[left.status] - statusOrder[right.status] ||
            new Date(left.startsAt) - new Date(right.startsAt),
        );

        sendJson(res, 200, paginate(events, pagination));
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/events\/([^/]+)$/,
      handler({ params, res }) {
        const event = db
          .prepare("SELECT * FROM events WHERE id = ? AND published = 1")
          .get(params[0]);
        if (!event) {
          throw new HttpError(404, "EVENT_NOT_FOUND", "Event not found");
        }
        sendJson(res, 200, { event: eventPayload(db, event) });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/events\/([^/]+)\/reviews$/,
      handler({ params, res }) {
        const event = db
          .prepare("SELECT id FROM events WHERE id = ? AND published = 1")
          .get(params[0]);
        if (!event) {
          throw new HttpError(404, "EVENT_NOT_FOUND", "Event not found");
        }
        const rows = db
          .prepare(
            `SELECT r.*, e.title AS event_title, u.nickname
             FROM reviews r
             JOIN events e ON e.id = r.event_id
             JOIN users u ON u.id = r.user_id
             WHERE r.event_id = ? AND r.status = 'APPROVED'
             ORDER BY r.created_at DESC`,
          )
          .all(params[0]);
        sendJson(res, 200, { items: rows.map((row) => reviewRow(row)) });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/events\/([^/]+)\/registrations$/,
      roles: ["USER", "ADMIN"],
      handler({ params, user, res }) {
        const event = db
          .prepare("SELECT * FROM events WHERE id = ? AND published = 1")
          .get(params[0]);
        if (!event) {
          throw new HttpError(404, "EVENT_NOT_FOUND", "Event not found");
        }
        const availability = registrationAvailability(event);
        if (!availability.open) {
          throw new HttpError(
            409,
            "REGISTRATION_CLOSED",
            availability.reason,
          );
        }

        const existing = db
          .prepare(
            "SELECT id FROM registrations WHERE user_id = ? AND event_id = ?",
          )
          .get(user.id, event.id);
        if (existing) {
          throw new HttpError(
            409,
            "ALREADY_REGISTERED",
            "You already registered for this event",
          );
        }

        const registeredCount = registrationsForEvent(db, event.id);
        if (registeredCount >= event.capacity) {
          throw new HttpError(409, "CAPACITY_REACHED", "Event is full");
        }

        const id = randomUUID();
        const createdAt = nowIso();
        const status = event.fee_cents > 0 ? "WAIT_PAYMENT" : "REGISTERED";
        db.prepare(
          `INSERT INTO registrations
             (id, user_id, event_id, status, created_at, paid_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          user.id,
          event.id,
          status,
          createdAt,
          event.fee_cents > 0 ? null : createdAt,
          createdAt,
        );
        const row = db
          .prepare(
            `SELECT r.*, e.title AS event_title, e.starts_at AS event_starts_at,
                    u.nickname
             FROM registrations r
             JOIN events e ON e.id = r.event_id
             JOIN users u ON u.id = r.user_id
             WHERE r.id = ?`,
          )
          .get(id);
        sendJson(res, 201, { registration: registrationRow(row) });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/registrations\/([^/]+)\/pay$/,
      roles: ["USER", "ADMIN"],
      handler({ params, user, res }) {
        const registration = db
          .prepare("SELECT * FROM registrations WHERE id = ?")
          .get(params[0]);
        if (!registration) {
          throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
        }
        if (registration.user_id !== user.id) {
          throw new HttpError(403, "FORBIDDEN", "You cannot pay for another user");
        }
        if (registration.status !== "WAIT_PAYMENT") {
          throw new HttpError(
            409,
            "INVALID_REGISTRATION_STATE",
            "Only a waiting-payment registration can be paid",
          );
        }

        const paidAt = nowIso();
        db.prepare(
          `UPDATE registrations
           SET status = 'REGISTERED', paid_at = ?, updated_at = ?
           WHERE id = ?`,
        ).run(paidAt, paidAt, registration.id);
        sendJson(res, 200, {
          registration: {
            id: registration.id,
            status: "REGISTERED",
            paidAt,
          },
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/me\/registrations$/,
      roles: ["USER", "ADMIN"],
      handler({ user, res }) {
        const rows = db
          .prepare(
            `SELECT r.*, e.title AS event_title, e.starts_at AS event_starts_at,
                    u.nickname
             FROM registrations r
             JOIN events e ON e.id = r.event_id
             JOIN users u ON u.id = r.user_id
             WHERE r.user_id = ?
             ORDER BY r.created_at DESC`,
          )
          .all(user.id);
        sendJson(res, 200, { items: rows.map(registrationRow) });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/events\/([^/]+)\/reviews$/,
      roles: ["USER", "ADMIN"],
      handler({ params, user, body, res }) {
        const content = requireString(body.content, "content", {
          min: 5,
          max: 1000,
        });
        const event = db
          .prepare("SELECT id FROM events WHERE id = ? AND published = 1")
          .get(params[0]);
        if (!event) {
          throw new HttpError(404, "EVENT_NOT_FOUND", "Event not found");
        }
        const registration = requiredRegistration.get(user.id, event.id);
        if (
          !registration ||
          !["REGISTERED", "COMPLETED"].includes(registration.status)
        ) {
          throw new HttpError(
            403,
            "REVIEW_NOT_ALLOWED",
            "Only registered users can review this event",
          );
        }

        const id = randomUUID();
        const createdAt = nowIso();
        try {
          db.prepare(
            `INSERT INTO reviews
               (id, user_id, event_id, content, status, created_at)
             VALUES (?, ?, ?, ?, 'PENDING', ?)`,
          ).run(id, user.id, event.id, content, createdAt);
        } catch (error) {
          if (isUniqueConstraint(error)) {
            throw new HttpError(
              409,
              "REVIEW_ALREADY_EXISTS",
              "You already reviewed this event",
            );
          }
          throw error;
        }

        sendJson(res, 201, {
          review: {
            id,
            eventId: event.id,
            content,
            status: "PENDING",
            createdAt,
          },
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/me\/reviews$/,
      roles: ["USER", "ADMIN"],
      handler({ user, res }) {
        const rows = db
          .prepare(
            `SELECT r.*, e.title AS event_title, u.nickname
             FROM reviews r
             JOIN events e ON e.id = r.event_id
             JOIN users u ON u.id = r.user_id
             WHERE r.user_id = ?
             ORDER BY r.created_at DESC`,
          )
          .all(user.id);
        sendJson(res, 200, {
          items: rows.map((row) => reviewRow({ ...row, mine: 1 }, { admin: true })),
        });
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/reviews\/([^/]+)$/,
      roles: ["USER", "ADMIN"],
      handler({ params, user, res }) {
        const review = db
          .prepare("SELECT * FROM reviews WHERE id = ?")
          .get(params[0]);
        if (!review) {
          throw new HttpError(404, "REVIEW_NOT_FOUND", "Review not found");
        }
        if (review.user_id !== user.id) {
          throw new HttpError(403, "FORBIDDEN", "You cannot delete another user's review");
        }
        db.prepare("DELETE FROM reviews WHERE id = ?").run(review.id);
        sendJson(res, 200, { deleted: true });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/me\/certificates$/,
      roles: ["USER", "ADMIN"],
      handler({ user, res }) {
        const rows = db
          .prepare(
            `SELECT c.*, e.title AS event_title, e.starts_at AS event_starts_at,
                    e.location AS event_location, e.description AS event_description,
                    u.nickname, r.group_name, r.finish_time_seconds
             FROM certificates c
             JOIN events e ON e.id = c.event_id
             JOIN users u ON u.id = c.user_id
             JOIN results r ON r.event_id = c.event_id AND r.user_id = c.user_id
             WHERE c.user_id = ? AND c.status = 'ISSUED'
             ORDER BY c.issued_at DESC`,
          )
          .all(user.id);
        sendJson(res, 200, { items: rows.map(certificateRow) });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/admin\/dashboard$/,
      roles: ["ADMIN"],
      handler({ res }) {
        const count = (sql) => Number(db.prepare(sql).get().count);
        const recent = db
          .prepare("SELECT * FROM events ORDER BY starts_at DESC LIMIT 5")
          .all()
          .map((event) => eventPayload(db, event));
        sendJson(res, 200, {
          stats: {
            events: count("SELECT COUNT(*) AS count FROM events"),
            registrations: count(
              "SELECT COUNT(*) AS count FROM registrations WHERE status IN ('REGISTERED', 'COMPLETED')",
            ),
            certificates: count(
              "SELECT COUNT(*) AS count FROM certificates WHERE status = 'ISSUED'",
            ),
            schools: count("SELECT COUNT(*) AS count FROM schools"),
          },
          recentEvents: recent,
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/admin\/events$/,
      roles: ["ADMIN"],
      handler({ query, res }) {
        const keyword = (query.get("q") ?? "").trim().toLowerCase();
        const pagination = parsePagination(query);
        let rows = db
          .prepare("SELECT * FROM events ORDER BY starts_at DESC")
          .all();
        if (keyword) {
          rows = rows.filter((event) =>
            `${event.title} ${event.location}`.toLowerCase().includes(keyword),
          );
        }
        sendJson(
          res,
          200,
          paginate(
            rows.map((event) => eventPayload(db, event)),
            pagination,
          ),
        );
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/admin\/events$/,
      roles: ["ADMIN"],
      handler({ body, res }) {
        const event = normalizeEventInput(body);
        const id = randomUUID();
        const createdAt = nowIso();
        db.prepare(
          `INSERT INTO events (
             id, title, description, location, cover_url, starts_at, ends_at,
             registration_opens_at, registration_closes_at, fee_cents,
             capacity, published, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          event.title,
          event.description,
          event.location,
          event.coverUrl,
          event.startsAt,
          event.endsAt,
          event.registrationOpensAt,
          event.registrationClosesAt,
          event.feeCents,
          event.capacity,
          event.published ? 1 : 0,
          createdAt,
          createdAt,
        );
        const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id);
        sendJson(res, 201, { event: eventPayload(db, row) });
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/admin\/events\/([^/]+)$/,
      roles: ["ADMIN"],
      handler({ params, body, res }) {
        const existing = db
          .prepare("SELECT * FROM events WHERE id = ?")
          .get(params[0]);
        if (!existing) {
          throw new HttpError(404, "EVENT_NOT_FOUND", "Event not found");
        }
        const event = normalizeEventInput(body, existing);
        db.prepare(
          `UPDATE events
           SET title = ?, description = ?, location = ?, cover_url = ?,
               starts_at = ?, ends_at = ?, registration_opens_at = ?,
               registration_closes_at = ?, fee_cents = ?, capacity = ?,
               published = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          event.title,
          event.description,
          event.location,
          event.coverUrl,
          event.startsAt,
          event.endsAt,
          event.registrationOpensAt,
          event.registrationClosesAt,
          event.feeCents,
          event.capacity,
          event.published ? 1 : 0,
          nowIso(),
          existing.id,
        );
        const row = db
          .prepare("SELECT * FROM events WHERE id = ?")
          .get(existing.id);
        sendJson(res, 200, { event: eventPayload(db, row) });
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/admin\/events\/([^/]+)$/,
      roles: ["ADMIN"],
      handler({ params, res }) {
        const result = db
          .prepare("DELETE FROM events WHERE id = ?")
          .run(params[0]);
        if (result.changes === 0) {
          throw new HttpError(404, "EVENT_NOT_FOUND", "Event not found");
        }
        sendJson(res, 200, { deleted: true });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/admin\/registrations$/,
      roles: ["ADMIN"],
      handler({ query, res }) {
        const pagination = parsePagination(query);
        const keyword = (query.get("q") ?? "").trim().toLowerCase();
        const status = (query.get("status") ?? "").trim().toUpperCase();
        let rows = db
          .prepare(
            `SELECT r.*, e.title AS event_title, e.starts_at AS event_starts_at,
                    u.nickname
             FROM registrations r
             JOIN events e ON e.id = r.event_id
             JOIN users u ON u.id = r.user_id
             ORDER BY r.created_at DESC`,
          )
          .all();
        if (keyword) {
          rows = rows.filter((row) =>
            `${row.event_title} ${row.nickname}`
              .toLowerCase()
              .includes(keyword),
          );
        }
        if (status) {
          rows = rows.filter((row) => row.status === status);
        }
        sendJson(
          res,
          200,
          paginate(rows.map(registrationRow), pagination),
        );
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/admin\/registrations\/([^/]+)$/,
      roles: ["ADMIN"],
      handler({ params, body, res }) {
        const status = String(body.status ?? "").toUpperCase();
        if (!["WAIT_PAYMENT", "REGISTERED", "CANCELLED"].includes(status)) {
          throw new HttpError(
            400,
            "VALIDATION_ERROR",
            "status must be WAIT_PAYMENT, REGISTERED or CANCELLED",
          );
        }
        const registration = db
          .prepare("SELECT * FROM registrations WHERE id = ?")
          .get(params[0]);
        if (!registration) {
          throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
        }
        const paidAt =
          status === "REGISTERED" ? registration.paid_at ?? nowIso() : null;
        db.prepare(
          "UPDATE registrations SET status = ?, paid_at = ?, updated_at = ? WHERE id = ?",
        ).run(status, paidAt, nowIso(), registration.id);
        sendJson(res, 200, {
          registration: { id: registration.id, status, paidAt },
        });
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/admin\/registrations\/([^/]+)$/,
      roles: ["ADMIN"],
      handler({ params, res }) {
        const result = db
          .prepare("DELETE FROM registrations WHERE id = ?")
          .run(params[0]);
        if (result.changes === 0) {
          throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
        }
        sendJson(res, 200, { deleted: true });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/admin\/reviews$/,
      roles: ["ADMIN"],
      handler({ query, res }) {
        const pagination = parsePagination(query);
        const keyword = (query.get("q") ?? "").trim().toLowerCase();
        const status = (query.get("status") ?? "").trim().toUpperCase();
        let rows = db
          .prepare(
            `SELECT r.*, e.title AS event_title, u.nickname
             FROM reviews r
             JOIN events e ON e.id = r.event_id
             JOIN users u ON u.id = r.user_id
             ORDER BY r.created_at DESC`,
          )
          .all();
        if (keyword) {
          rows = rows.filter((row) =>
            `${row.event_title} ${row.content} ${row.nickname}`
              .toLowerCase()
              .includes(keyword),
          );
        }
        if (status) {
          rows = rows.filter((row) => row.status === status);
        }
        sendJson(
          res,
          200,
          paginate(
            rows.map((row) =>
              reviewRow({ ...row, mine: 1 }, { admin: true }),
            ),
            pagination,
          ),
        );
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/admin\/reviews\/([^/]+)$/,
      roles: ["ADMIN"],
      handler({ params, body, res }) {
        const status = String(body.status ?? "").toUpperCase();
        if (!["APPROVED", "REJECTED"].includes(status)) {
          throw new HttpError(
            400,
            "VALIDATION_ERROR",
            "status must be APPROVED or REJECTED",
          );
        }
        const review = db
          .prepare("SELECT * FROM reviews WHERE id = ?")
          .get(params[0]);
        if (!review) {
          throw new HttpError(404, "REVIEW_NOT_FOUND", "Review not found");
        }
        db.prepare(
          "UPDATE reviews SET status = ?, reviewed_at = ? WHERE id = ?",
        ).run(status, nowIso(), review.id);
        sendJson(res, 200, { review: { id: review.id, status } });
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/admin\/reviews\/([^/]+)$/,
      roles: ["ADMIN"],
      handler({ params, res }) {
        const result = db
          .prepare("DELETE FROM reviews WHERE id = ?")
          .run(params[0]);
        if (result.changes === 0) {
          throw new HttpError(404, "REVIEW_NOT_FOUND", "Review not found");
        }
        sendJson(res, 200, { deleted: true });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/admin\/results$/,
      roles: ["ADMIN"],
      handler({ query, res }) {
        const pagination = parsePagination(query);
        const rows = db
          .prepare(
            `SELECT r.*, e.title AS event_title, u.nickname
             FROM results r
             JOIN events e ON e.id = r.event_id
             JOIN users u ON u.id = r.user_id
             ORDER BY r.created_at DESC`,
          )
          .all();
        sendJson(
          res,
          200,
          paginate(
            rows.map((row) => ({
              id: row.id,
              eventId: row.event_id,
              eventTitle: row.event_title,
              userId: row.user_id,
              nickname: row.nickname,
              finishTimeSeconds: row.finish_time_seconds,
              groupName: row.group_name,
              published: Boolean(row.published),
              createdAt: row.created_at,
            })),
            pagination,
          ),
        );
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/admin\/results$/,
      roles: ["ADMIN"],
      handler({ body, res }) {
        const registration = db
          .prepare(
            "SELECT * FROM registrations WHERE user_id = ? AND event_id = ?",
          )
          .get(body.userId, body.eventId);
        if (
          !registration ||
          !["REGISTERED", "COMPLETED"].includes(registration.status)
        ) {
          throw new HttpError(
            409,
            "PAID_REGISTRATION_REQUIRED",
            "A paid registration is required",
          );
        }
        const finishTimeSeconds = requireInteger(
          body.finishTimeSeconds,
          "finishTimeSeconds",
          { min: 1, max: 86400 },
        );
        const groupName = requireString(body.groupName, "groupName", {
          min: 1,
          max: 80,
        });
        const existing = db
          .prepare("SELECT * FROM results WHERE user_id = ? AND event_id = ?")
          .get(body.userId, body.eventId);
        const createdAt = nowIso();
        const id = existing?.id ?? randomUUID();
        if (existing) {
          db.prepare(
            `UPDATE results
             SET finish_time_seconds = ?, group_name = ?, published = ?, updated_at = ?
             WHERE id = ?`,
          ).run(
            finishTimeSeconds,
            groupName,
            body.published === false ? 0 : 1,
            createdAt,
            id,
          );
        } else {
          db.prepare(
            `INSERT INTO results
               (id, user_id, event_id, finish_time_seconds, group_name,
                published, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            body.userId,
            body.eventId,
            finishTimeSeconds,
            groupName,
            body.published === false ? 0 : 1,
            createdAt,
            createdAt,
          );
        }
        db.prepare(
          `UPDATE registrations
           SET status = 'COMPLETED', updated_at = ?
           WHERE id = ?`,
        ).run(createdAt, registration.id);
        sendJson(res, existing ? 200 : 201, {
          result: {
            id,
            userId: body.userId,
            eventId: body.eventId,
            finishTimeSeconds,
            groupName,
          },
        });
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/admin\/results\/([^/]+)$/,
      roles: ["ADMIN"],
      handler({ params, res }) {
        const result = db
          .prepare("DELETE FROM results WHERE id = ?")
          .run(params[0]);
        if (result.changes === 0) {
          throw new HttpError(404, "RESULT_NOT_FOUND", "Result not found");
        }
        sendJson(res, 200, { deleted: true });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/admin\/certificates$/,
      roles: ["ADMIN"],
      handler({ query, res }) {
        const pagination = parsePagination(query);
        const rows = db
          .prepare(
            `SELECT c.*, e.title AS event_title, e.starts_at AS event_starts_at,
                    e.location AS event_location, e.description AS event_description,
                    u.nickname, r.group_name, r.finish_time_seconds
             FROM certificates c
             JOIN events e ON e.id = c.event_id
             JOIN users u ON u.id = c.user_id
             JOIN results r ON r.event_id = c.event_id AND r.user_id = c.user_id
             ORDER BY c.created_at DESC`,
          )
          .all();
        sendJson(
          res,
          200,
          paginate(rows.map(certificateRow), pagination),
        );
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/admin\/certificates$/,
      roles: ["ADMIN"],
      handler({ body, res }) {
        const registration = db
          .prepare(
            `SELECT r.*, e.title AS event_title
             FROM registrations r
             JOIN events e ON e.id = r.event_id
             WHERE r.user_id = ? AND r.event_id = ? AND r.status = 'COMPLETED'`,
          )
          .get(body.userId, body.eventId);
        if (!registration) {
          throw new HttpError(
            409,
            "RESULT_REQUIRED",
            "A completed registration is required",
          );
        }
        const existing = db
          .prepare(
            "SELECT id FROM certificates WHERE user_id = ? AND event_id = ?",
          )
          .get(body.userId, body.eventId);
        if (existing) {
          throw new HttpError(
            409,
            "CERTIFICATE_ALREADY_EXISTS",
            "Certificate already exists",
          );
        }
        const id = randomUUID();
        const serialNo = `MAR-${new Date().getUTCFullYear()}-${id
          .slice(0, 8)
          .toUpperCase()}`;
        const createdAt = nowIso();
        db.prepare(
          `INSERT INTO certificates
             (id, user_id, event_id, serial_no, status, issued_at, created_at)
           VALUES (?, ?, ?, ?, 'UNISSUED', NULL, ?)`,
        ).run(id, body.userId, body.eventId, serialNo, createdAt);
        sendJson(res, 201, {
          certificate: {
            id,
            serialNo,
            status: "UNISSUED",
            eventTitle: registration.event_title,
          },
        });
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/admin\/certificates\/([^/]+)\/issue$/,
      roles: ["ADMIN"],
      handler({ params, res }) {
        const certificate = db
          .prepare("SELECT * FROM certificates WHERE id = ?")
          .get(params[0]);
        if (!certificate) {
          throw new HttpError(404, "CERTIFICATE_NOT_FOUND", "Certificate not found");
        }
        const issuedAt = nowIso();
        db.prepare(
          "UPDATE certificates SET status = 'ISSUED', issued_at = ? WHERE id = ?",
        ).run(issuedAt, certificate.id);
        sendJson(res, 200, {
          certificate: {
            id: certificate.id,
            serialNo: certificate.serial_no,
            status: "ISSUED",
            issuedAt,
          },
        });
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/admin\/certificates\/([^/]+)$/,
      roles: ["ADMIN"],
      handler({ params, res }) {
        const result = db
          .prepare("DELETE FROM certificates WHERE id = ?")
          .run(params[0]);
        if (result.changes === 0) {
          throw new HttpError(404, "CERTIFICATE_NOT_FOUND", "Certificate not found");
        }
        sendJson(res, 200, { deleted: true });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/admin\/schools$/,
      roles: ["ADMIN"],
      handler({ query, res }) {
        const pagination = parsePagination(query);
        const keyword = (query.get("q") ?? "").trim().toLowerCase();
        let rows = db
          .prepare("SELECT * FROM schools ORDER BY created_at DESC")
          .all();
        if (keyword) {
          rows = rows.filter((school) =>
            `${school.name} ${school.code}`.toLowerCase().includes(keyword),
          );
        }
        sendJson(
          res,
          200,
          paginate(
            rows.map((row) => ({
              id: row.id,
              name: row.name,
              code: row.code,
              contactName: row.contact_name,
              contactPhone: row.contact_phone,
              createdAt: row.created_at,
            })),
            pagination,
          ),
        );
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/admin\/schools$/,
      roles: ["ADMIN"],
      handler({ body, res }) {
        const id = randomUUID();
        try {
          db.prepare(
            `INSERT INTO schools
               (id, name, code, contact_name, contact_phone, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            requireString(body.name, "name", { min: 2, max: 100 }),
            requireString(body.code, "code", { min: 2, max: 40 }),
            requireString(body.contactName, "contactName", {
              min: 2,
              max: 40,
            }),
            requireString(body.contactPhone, "contactPhone", {
              min: 5,
              max: 30,
            }),
            nowIso(),
          );
        } catch (error) {
          if (isUniqueConstraint(error)) {
            throw new HttpError(409, "SCHOOL_CODE_EXISTS", "School code already exists");
          }
          throw error;
        }
        sendJson(res, 201, { school: { id } });
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/admin\/schools\/([^/]+)$/,
      roles: ["ADMIN"],
      handler({ params, res }) {
        const result = db
          .prepare("DELETE FROM schools WHERE id = ?")
          .run(params[0]);
        if (result.changes === 0) {
          throw new HttpError(404, "SCHOOL_NOT_FOUND", "School not found");
        }
        sendJson(res, 200, { deleted: true });
      },
    },
  ];
}

function serveStaticFile(rootDir, prefix, pathname, res) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    throw new HttpError(400, "INVALID_PATH", "Invalid path");
  }
  relativePath = relativePath.replace(/^\/+/, "") || "index.html";
  let filePath = resolve(rootDir, relativePath);
  if (!filePath.startsWith(rootDir)) {
    throw new HttpError(403, "FORBIDDEN", "Invalid path");
  }

  try {
    if (statSync(filePath).isDirectory()) {
      filePath = resolve(filePath, "index.html");
    }
    const body = readFileSync(filePath);
    addCorsHeaders(res);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
      "Content-Length": body.length,
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: https:; connect-src 'self';",
    });
    res.end(body);
  } catch {
    throw new HttpError(404, "NOT_FOUND", "File not found");
  }
}

export function createApplication({
  dbPath,
  authSecret = "development-only-change-me",
} = {}) {
  const db = openDatabase(dbPath);
  const routes = createRoutes(db, authSecret);
  const server = createServer(async (req, res) => {
    addCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname === "/") {
        res.writeHead(302, { Location: "/user/" });
        res.end();
        return;
      }
      if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
        if (req.method !== "GET" && req.method !== "HEAD") {
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        serveStaticFile(ADMIN_DIR, "/admin", url.pathname, res);
        return;
      }
      if (url.pathname === "/user" || url.pathname.startsWith("/user/")) {
        if (req.method !== "GET" && req.method !== "HEAD") {
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        serveStaticFile(USER_WEB_DIR, "/user", url.pathname, res);
        return;
      }
      if (url.pathname === "/api/health") {
        sendJson(res, 200, {
          status: "ok",
          timestamp: nowIso(),
          service: "marathon-platform",
        });
        return;
      }

      let match = null;
      let route = null;
      for (const candidate of routes) {
        if (candidate.method !== req.method) {
          continue;
        }
        const candidateMatch = candidate.pattern.exec(url.pathname);
        if (candidateMatch) {
          route = candidate;
          match = candidateMatch;
          break;
        }
      }
      if (!route) {
        throw new HttpError(404, "NOT_FOUND", "Route not found");
      }

      const user = currentUser(req, db, authSecret);
      if (route.roles) {
        if (!user) {
          throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
        }
        if (!route.roles.includes(user.role)) {
          throw new HttpError(403, "FORBIDDEN", "Insufficient permissions");
        }
      }

      const body =
        req.method === "GET" || req.method === "HEAD"
          ? {}
          : await readJsonBody(req);
      await route.handler({
        req,
        res,
        db,
        user,
        params: match.slice(1),
        query: url.searchParams,
        body,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  return {
    server,
    db,
    close() {
      return new Promise((resolveClose, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          db.close();
          resolveClose();
        });
      });
    },
  };
}
