export class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function requireString(value, field, { min = 1, max = 500 } = {}) {
  if (typeof value !== "string") {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} is required`);
  }

  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${field} must contain ${min}-${max} characters`,
    );
  }
  return trimmed;
}

export function optionalString(value, field, options = {}) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireString(value, field, options);
}

export function requireInteger(value, field, { min = 0, max = 100_000_000 } = {}) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${field} must be an integer between ${min} and ${max}`,
    );
  }
  return parsed;
}

export function requireDate(value, field) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} must be a valid date`);
  }
  return date.toISOString();
}

export function assertDateOrder(fields) {
  const entries = Object.entries(fields);
  for (let index = 1; index < entries.length; index += 1) {
    const [previousName, previousValue] = entries[index - 1];
    const [currentName, currentValue] = entries[index];
    if (new Date(previousValue) >= new Date(currentValue)) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        `${previousName} must be earlier than ${currentName}`,
      );
    }
  }
}

export function parsePagination(query, defaultPageSize = 20) {
  const page = Math.max(1, Number.parseInt(query.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(
      1,
      Number.parseInt(query.get("pageSize") ?? String(defaultPageSize), 10) ||
        defaultPageSize,
    ),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paginate(items, { page, pageSize, offset }) {
  return {
    items: items.slice(offset, offset + pageSize),
    pagination: {
      page,
      pageSize,
      total: items.length,
      totalPages: Math.ceil(items.length / pageSize),
    },
  };
}

export function nowIso() {
  return new Date().toISOString();
}
