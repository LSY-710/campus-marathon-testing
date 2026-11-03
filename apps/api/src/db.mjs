import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./auth.mjs";
import { nowIso } from "./validation.mjs";

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('USER', 'ADMIN')),
    nickname TEXT NOT NULL,
    avatar_url TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    location TEXT NOT NULL,
    cover_url TEXT,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    registration_opens_at TEXT NOT NULL,
    registration_closes_at TEXT NOT NULL,
    fee_cents INTEGER NOT NULL CHECK (fee_cents >= 0),
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (
      status IN ('WAIT_PAYMENT', 'REGISTERED', 'COMPLETED', 'CANCELLED')
    ),
    created_at TEXT NOT NULL,
    paid_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, event_id)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    UNIQUE (user_id, event_id)
  );

  CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    finish_time_seconds INTEGER NOT NULL CHECK (finish_time_seconds > 0),
    group_name TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, event_id)
  );

  CREATE TABLE IF NOT EXISTS certificates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    serial_no TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('UNISSUED', 'ISSUED')),
    issued_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, event_id)
  );

  CREATE TABLE IF NOT EXISTS schools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    contact_name TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_dates
    ON events(registration_opens_at, registration_closes_at, starts_at);
  CREATE INDEX IF NOT EXISTS idx_registrations_event
    ON registrations(event_id, status);
  CREATE INDEX IF NOT EXISTS idx_reviews_event_status
    ON reviews(event_id, status);
`;

function hoursFrom(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function daysFrom(date, days) {
  return hoursFrom(date, days * 24);
}

function createSeedEvents(now) {
  return [
    {
      id: randomUUID(),
      title: "2026 秋季校园马拉松",
      description: "校园环线 10 公里，感受秋日校园与奔跑的城市节奏。",
      location: "大学城中心广场",
      startsAt: daysFrom(now, 14),
      endsAt: daysFrom(now, 14.4),
      registrationOpensAt: daysFrom(now, -7),
      registrationClosesAt: daysFrom(now, 7),
      feeCents: 7000,
      capacity: 800,
    },
    {
      id: randomUUID(),
      title: "2026 冬季越野跑",
      description: "5 公里校园越野体验组，适合首次参加路跑活动的同学。",
      location: "北区生态跑道",
      startsAt: daysFrom(now, 60),
      endsAt: daysFrom(now, 60.3),
      registrationOpensAt: daysFrom(now, -2),
      registrationClosesAt: daysFrom(now, 40),
      feeCents: 4000,
      capacity: 300,
    },
    {
      id: randomUUID(),
      title: "2027 新年校园马拉松",
      description: "新年第一跑，设置半程马拉松和 5 公里欢乐跑两个项目。",
      location: "大学城体育中心",
      startsAt: daysFrom(now, 75),
      endsAt: daysFrom(now, 75.5),
      registrationOpensAt: daysFrom(now, 30),
      registrationClosesAt: daysFrom(now, 60),
      feeCents: 9000,
      capacity: 1200,
    },
    {
      id: randomUUID(),
      title: "2025 校园马拉松",
      description: "年度校园马拉松，全程 10 公里。",
      location: "学校",
      startsAt: daysFrom(now, -300),
      endsAt: daysFrom(now, -300 + 0.4),
      registrationOpensAt: daysFrom(now, -330),
      registrationClosesAt: daysFrom(now, -315),
      feeCents: 5000,
      capacity: 600,
    },
    {
      id: randomUUID(),
      title: "毕业季公益欢乐跑",
      description: "免费公益跑活动，完赛可领取电子纪念证书。",
      location: "南门至镜湖环线",
      startsAt: daysFrom(now, 25),
      endsAt: daysFrom(now, 25.2),
      registrationOpensAt: daysFrom(now, -1),
      registrationClosesAt: daysFrom(now, 20),
      feeCents: 0,
      capacity: 500,
    },
  ];
}

function seedDatabase(db) {
  const createdAt = nowIso();
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users
      (id, username, password_hash, role, nickname, avatar_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run(
    "user-demo",
    "user",
    hashPassword("user1234"),
    "USER",
    "奔跑的同学",
    null,
    createdAt,
  );
  insertUser.run(
    "admin-demo",
    "admin",
    hashPassword("admin123"),
    "ADMIN",
    "赛事管理员",
    null,
    createdAt,
  );
  insertUser.run(
    "runner-demo-2",
    "runner2",
    hashPassword("runner123"),
    "USER",
    "夜跑社成员",
    null,
    createdAt,
  );

  const eventCount = Number(
    db.prepare("SELECT COUNT(*) AS count FROM events").get().count,
  );
  if (eventCount === 0) {
    const insertEvent = db.prepare(`
      INSERT INTO events (
        id, title, description, location, cover_url, starts_at, ends_at,
        registration_opens_at, registration_closes_at, fee_cents, capacity,
        published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    for (const event of createSeedEvents(new Date())) {
      insertEvent.run(
        event.id,
        event.title,
        event.description,
        event.location,
        null,
        event.startsAt,
        event.endsAt,
        event.registrationOpensAt,
        event.registrationClosesAt,
        event.feeCents,
        event.capacity,
        createdAt,
        createdAt,
      );
    }
  }

  const schoolCount = Number(
    db.prepare("SELECT COUNT(*) AS count FROM schools").get().count,
  );
  if (schoolCount === 0) {
    db.prepare(`
      INSERT INTO schools (id, name, code, contact_name, contact_phone, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "school-demo",
      "大学城体育联盟",
      "UCA-001",
      "张老师",
      "020-88886666",
      createdAt,
    );
  }
}

export function openDatabase(dbPath = ":memory:") {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  seedDatabase(db);
  return db;
}
