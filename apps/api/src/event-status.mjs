export const EVENT_STATUS = Object.freeze({
  UPCOMING: "UPCOMING",
  REGISTERING: "REGISTERING",
  ENDED: "ENDED",
});

export const EVENT_STATUS_LABELS = Object.freeze({
  UPCOMING: "未开始",
  REGISTERING: "报名中",
  ENDED: "已结束",
});

export function deriveEventStatus(event, now = new Date()) {
  const current = new Date(now).getTime();
  if (current > new Date(event.ends_at).getTime()) {
    return EVENT_STATUS.ENDED;
  }
  if (
    current >= new Date(event.registration_opens_at).getTime() &&
    current <= new Date(event.registration_closes_at).getTime()
  ) {
    return EVENT_STATUS.REGISTERING;
  }
  return EVENT_STATUS.UPCOMING;
}

export function registrationAvailability(event, now = new Date()) {
  const current = new Date(now).getTime();
  const opensAt = new Date(event.registration_opens_at).getTime();
  const closesAt = new Date(event.registration_closes_at).getTime();
  const endsAt = new Date(event.ends_at).getTime();

  if (!event.published) {
    return { open: false, reason: "赛事未发布" };
  }
  if (current < opensAt) {
    return { open: false, reason: "报名尚未开始" };
  }
  if (current > closesAt || current > endsAt) {
    return { open: false, reason: "报名已截止" };
  }
  return { open: true, reason: null };
}

export function serializeEvent(event, { now = new Date(), registeredCount = 0 } = {}) {
  const status = deriveEventStatus(event, now);
  const registration = registrationAvailability(event, now);
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    coverUrl: event.cover_url,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    registrationOpensAt: event.registration_opens_at,
    registrationClosesAt: event.registration_closes_at,
    feeCents: event.fee_cents,
    feeYuan: (event.fee_cents / 100).toFixed(2),
    capacity: event.capacity,
    registeredCount,
    remainingSlots: Math.max(0, event.capacity - registeredCount),
    published: Boolean(event.published),
    status,
    statusLabel: EVENT_STATUS_LABELS[status],
    registrationOpen: registration.open,
    registrationClosedReason: registration.reason,
  };
}
