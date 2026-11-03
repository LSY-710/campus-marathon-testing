const state = {
  token: localStorage.getItem("marathon-web-token"),
  user: JSON.parse(localStorage.getItem("marathon-web-user") ?? "null"),
  events: [],
  eventStatus: "ALL",
  query: "",
  favorites: JSON.parse(localStorage.getItem("marathon-favorites") ?? "[]"),
};

const app = document.querySelector("#app");
const loginDialog = document.querySelector("#login-dialog");
const loginButton = document.querySelector("#login-open");
const toast = document.querySelector("#toast");

const statusLabels = {
  UPCOMING: "未开始",
  REGISTERING: "报名中",
  ENDED: "已结束",
  WAIT_PAYMENT: "待缴费",
  REGISTERED: "已报名",
  COMPLETED: "已完赛",
  CANCELLED: "已取消",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value, options = {}) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: options.year ? "numeric" : undefined,
    month: "2-digit",
    day: "2-digit",
    hour: options.time ? "2-digit" : undefined,
    minute: options.time ? "2-digit" : undefined,
  }).format(new Date(value));
}

function dateParts(value) {
  const date = new Date(value);
  return {
    month: `${date.getMonth() + 1}月`,
    day: String(date.getDate()).padStart(2, "0"),
  };
}

function priceText(event) {
  return event.feeCents === 0 ? "免费" : `¥${event.feeYuan}`;
}

function showToast(message, type = "success") {
  toast.textContent = message;
  toast.classList.toggle("is-error", type === "error");
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(
    () => toast.classList.remove("is-visible"),
    2600,
  );
}

async function api(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers ?? {}),
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(path, {
    ...options,
    headers,
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      clearSession();
    }
    throw new Error(payload.error?.message ?? `请求失败 (${response.status})`);
  }
  return payload;
}

function saveSession(payload) {
  state.token = payload.token;
  state.user = payload.user;
  localStorage.setItem("marathon-web-token", payload.token);
  localStorage.setItem("marathon-web-user", JSON.stringify(payload.user));
  updateHeader();
}

function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("marathon-web-token");
  localStorage.removeItem("marathon-web-user");
  updateHeader();
}

function updateHeader() {
  loginButton.textContent = state.user
    ? `${state.user.nickname} · 退出`
    : "跑者登录";
  loginButton.classList.toggle("is-user", Boolean(state.user));
}

function requireLogin() {
  if (state.token) return true;
  loginDialog.showModal();
  return false;
}

function joinUrl(params) {
  return `/api/events?${new URLSearchParams(params)}`;
}

function eventCard(event, index) {
  const date = dateParts(event.startsAt);
  return `
    <article class="event-card" data-route="#/event/${escapeHtml(event.id)}" data-testid="event-card">
      <div class="event-cover">
        <div class="event-cover-grid"></div>
        <span class="event-status" data-status="${escapeHtml(event.status)}">${escapeHtml(
          event.statusLabel,
        )}</span>
        <div class="event-date"><small>${date.month}</small>${date.day}</div>
        <div class="event-number">${String(index + 1).padStart(2, "0")}</div>
      </div>
      <div class="event-body">
        <h3 class="event-title">${escapeHtml(event.title)}</h3>
        <div class="event-location">${escapeHtml(event.location)}</div>
        <div class="event-foot">
          <span>${formatDate(event.startsAt)}</span>
          <span class="event-price">${escapeHtml(priceText(event))}</span>
        </div>
      </div>
    </article>
  `;
}

async function renderHome() {
  const payload = await api(joinUrl({ pageSize: "20", status: "ALL" }));
  state.events = payload.items;
  const registering = payload.items.filter(
    (event) => event.status === "REGISTERING",
  ).length;
  app.innerHTML = `
    <section class="hero-grid" data-testid="home-hero">
      <div class="hero-main">
        <div class="hero-topline">
          <span>CAMPUS RUN CLUB · 2026</span>
          <span>SEASON 02</span>
        </div>
        <h1 class="hero-title">RUN<br />THE<br />CAMPUS<span>.</span></h1>
        <p class="hero-copy">
          从校园道路出发，把每一步训练变成可以抵达的终点。浏览赛事、完成报名，并在终点线收获你的专属记录。
        </p>
        <div class="hero-meta">
          <span>10 KM · CITY · CAMPUS</span>
          <span>SCROLL TO EXPLORE ↓</span>
        </div>
      </div>
      <aside class="hero-side">
        <div class="hero-stat">
          <span>OPEN REGISTRATIONS</span>
          <strong>${String(registering).padStart(2, "0")}</strong>
          <span>场赛事正在报名</span>
        </div>
        <div class="hero-note">
          <p>找到属于你的下一场比赛。</p>
          <span>RUN WITH PURPOSE</span>
        </div>
      </aside>
    </section>
    <div class="section-head">
      <div>
        <span class="eyebrow">RACE CALENDAR</span>
        <h2>下一场比赛</h2>
      </div>
      <a class="text-link" href="#/events">全部赛事 →</a>
    </div>
    <section class="event-grid" data-testid="home-event-list">
      ${payload.items.slice(0, 6).map(eventCard).join("")}
    </section>
  `;
}

function bindEventSearch() {
  const form = document.querySelector("#event-search");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.query = new FormData(form).get("q")?.trim() ?? "";
    renderEvents();
  });
}

async function renderEvents() {
  const params = { pageSize: "100", status: state.eventStatus };
  if (state.query) params.q = state.query;
  const payload = await api(joinUrl(params));
  state.events = payload.items;
  const filters = [
    ["ALL", "全部"],
    ["REGISTERING", "报名中"],
    ["UPCOMING", "未开始"],
    ["ENDED", "已结束"],
  ];
  app.innerHTML = `
    <div class="section-head" data-testid="events-title">
      <div>
        <span class="eyebrow">RACE CALENDAR / 02</span>
        <h1>选择你的下一场奔跑</h1>
      </div>
      <span class="text-link">${payload.pagination.total} RACES</span>
    </div>
    <div class="filters">
      ${filters
        .map(
          ([key, label]) => `
            <button
              class="filter-button ${state.eventStatus === key ? "is-active" : ""}"
              type="button"
              data-filter="${key}"
              data-testid="event-filter-${key.toLowerCase()}"
            >${label}</button>
          `,
        )
        .join("")}
      <form id="event-search" class="search-form">
        <input name="q" value="${escapeHtml(state.query)}" placeholder="搜索赛事或地点" />
        <button type="submit">搜索</button>
      </form>
    </div>
    ${
      payload.items.length
        ? `<section class="event-grid" data-testid="event-grid">${payload.items
            .map(eventCard)
            .join("")}</section>`
        : `<div class="empty-panel">没有找到相关赛事，换个关键词试试。</div>`
    }
  `;
  bindEventSearch();
}

async function renderEventDetail(id) {
  const [{ event }, reviews, registrations] = await Promise.all([
    api(`/api/events/${id}`),
    api(`/api/events/${id}/reviews`),
    state.token
      ? api("/api/me/registrations").catch(() => ({ items: [] }))
      : Promise.resolve({ items: [] }),
  ]);
  const registration = registrations.items.find(
    (item) => item.eventId === event.id,
  );
  const date = dateParts(event.startsAt);
  const favorite = state.favorites.includes(event.id);
  app.innerHTML = `
    <div class="detail-layout" data-testid="event-detail">
      <section class="detail-poster">
        <div class="detail-status-line">
          <span>CAMPUS RACE FILE / ${date.month}</span>
          <span>${escapeHtml(event.statusLabel)}</span>
        </div>
        <h1 class="detail-title">${escapeHtml(event.title)}</h1>
        <p class="detail-subtitle">${escapeHtml(event.description)}</p>
        <div class="detail-date-large"><small>${date.month}</small>${date.day}</div>
      </section>
      <aside class="detail-side">
        <div class="detail-card">
          <span class="eyebrow">EVENT INFORMATION</span>
          <h2>赛事信息</h2>
          <div class="spec-list">
            <div class="spec-row"><span>DATE</span><strong>${formatDate(
              event.startsAt,
              { year: true, time: true },
            )}</strong></div>
            <div class="spec-row"><span>LOCATION</span><strong>${escapeHtml(
              event.location,
            )}</strong></div>
            <div class="spec-row"><span>ENTRY</span><strong>${escapeHtml(
              priceText(event),
            )}</strong></div>
            <div class="spec-row"><span>ENTRIES LEFT</span><strong>${
              event.remainingSlots
            } / ${event.capacity}</strong></div>
          </div>
        </div>
        <div class="detail-card">
          <div class="detail-actions">
            <button class="button button-light" type="button" data-action="favorite">
              ${favorite ? "★ 已收藏" : "☆ 收藏"}
            </button>
            <button class="button button-light" type="button" data-action="share">分享</button>
          </div>
          ${
            registration?.status === "WAIT_PAYMENT"
              ? `<button class="button button-coral button-full" style="margin-top:10px" data-action="pay" data-id="${registration.id}" data-testid="pay-button">立即缴费</button>`
              : registration
                ? `<button class="button button-dark button-full" style="margin-top:10px" disabled data-testid="registered-button">${statusLabels[registration.status] ?? registration.status}</button>`
                : `<button class="button button-dark button-full" style="margin-top:10px" data-action="register" data-id="${event.id}" data-testid="register-button" ${event.registrationOpen ? "" : "disabled"}>${event.registrationOpen ? "立即报名" : escapeHtml(event.registrationClosedReason)}</button>`
          }
          <a class="button button-light button-full" style="display:grid;place-items:center;margin-top:10px" href="#/reviews/${event.id}">查看 ${reviews.items.length} 条评价</a>
        </div>
      </aside>
    </div>
    <section class="detail-story">
      <div class="story-number">01</div>
      <div class="story-copy">
        <span class="eyebrow">RACE STORY</span>
        <h2>关于这场比赛</h2>
        <p>${escapeHtml(event.description)}</p>
      </div>
    </section>
  `;
  state.currentEvent = event;
  state.currentRegistration = registration ?? null;
}

async function registerCurrentEvent() {
  if (!requireLogin()) return;
  try {
    const payload = await api(
      `/api/events/${state.currentEvent.id}/registrations`,
      { method: "POST" },
    );
    showToast(
      payload.registration.status === "WAIT_PAYMENT"
        ? "报名已创建，请完成缴费"
        : "报名成功",
    );
    await renderEventDetail(state.currentEvent.id);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function payCurrentRegistration(registrationId) {
  try {
    await api(`/api/registrations/${registrationId}/pay`, { method: "POST" });
    showToast("缴费成功，报名已完成");
    await renderEventDetail(state.currentEvent.id);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function renderProfile() {
  if (!state.user) {
    app.innerHTML = `
      <section class="auth-panel" data-testid="profile-login-panel">
        <span class="eyebrow">RUNNER ACCESS</span>
        <h1>登录你的<br />跑者档案</h1>
        <p>查看报名进度、赛事评价和完赛证书。</p>
        <button class="button button-dark" type="button" data-action="open-login" data-testid="profile-login-button">立即登录</button>
      </section>
    `;
    return;
  }

  const [me, registrations, certificates] = await Promise.all([
    api("/api/me"),
    api("/api/me/registrations"),
    api("/api/me/certificates"),
  ]);
  state.user = me.user;
  saveSession({ token: state.token, user: me.user });
  const activeCount = registrations.items.filter((item) =>
    ["REGISTERED", "COMPLETED"].includes(item.status),
  ).length;
  const completed = registrations.items.filter(
    (item) => item.status === "COMPLETED",
  ).length;

  app.innerHTML = `
    <div class="profile-layout" data-testid="profile-dashboard">
      <section class="runner-pass">
        <div class="pass-topline"><span>RUNNER PASS</span><span>NO. 001</span></div>
        <div class="pass-avatar">${escapeHtml(me.user.nickname.slice(0, 1))}</div>
        <h1 class="pass-name">${escapeHtml(me.user.nickname)}</h1>
        <div class="pass-handle">@${escapeHtml(me.user.username)}</div>
        <div class="pass-stats">
          <div class="pass-stat"><strong>${activeCount}</strong><span>ACTIVE RACES</span></div>
          <div class="pass-stat"><strong>${completed}</strong><span>FINISHED</span></div>
          <div class="pass-stat"><strong>${certificates.items.length}</strong><span>CERTIFICATES</span></div>
        </div>
      </section>
      <section class="profile-content">
        <div class="profile-section">
          <span class="eyebrow">MY RACE BOARD</span>
          <h2>我的赛事</h2>
          ${
            registrations.items.length
              ? registrations.items
                  .map(
                    (item) => `
                      <a class="registration-row" href="#/event/${item.eventId}">
                        <div class="registration-copy">
                          <strong>${escapeHtml(item.eventTitle)}</strong>
                          <small>${formatDate(item.eventStartsAt, { year: true })}</small>
                        </div>
                        <span class="status-chip" data-status="${item.status}">${statusLabels[item.status] ?? item.status}</span>
                        <span>→</span>
                      </a>
                    `,
                  )
                  .join("")
              : `<div class="empty-panel">还没有报名记录</div>`
          }
        </div>
        <div class="profile-section">
          <span class="eyebrow">RUNNER SERVICES</span>
          <h2>跑者服务</h2>
          <div class="quick-links">
            <a class="quick-link" href="#/certificates">
              <strong>我的荣誉</strong>
              <span>${certificates.items.length} 张已颁发证书</span>
            </a>
            <a class="quick-link" href="#/favorites">
              <strong>我的收藏</strong>
              <span>${state.favorites.length} 场收藏赛事</span>
            </a>
            <a class="quick-link" href="#/my-reviews">
              <strong>我的评价</strong>
              <span>查看审核状态</span>
            </a>
            <button class="quick-link" type="button" data-action="logout">
              <strong>退出登录</strong>
              <span>结束当前会话</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  `;
}

async function renderReviews(eventId) {
  const [{ event }, payload] = await Promise.all([
    api(`/api/events/${eventId}`),
    api(`/api/events/${eventId}/reviews`),
  ]);
  app.innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow">RUNNER NOTES / ${escapeHtml(event.title)}</span>
        <h1>跑者与这场比赛</h1>
      </div>
      <a class="text-link" href="#/event/${eventId}">返回赛事 →</a>
    </div>
    <div class="review-layout" data-testid="reviews-page">
      <section class="review-form-panel">
        <span class="eyebrow">WRITE A NOTE</span>
        <h2>发表评价</h2>
        <textarea id="review-content" placeholder="分享路线、组织、补给或志愿者体验..." maxlength="1000"></textarea>
        <button class="button button-dark" type="button" data-action="submit-review" data-testid="review-submit">提交评价</button>
        <div class="review-note">评价提交后需要管理员审核，通过后才会公开显示。</div>
      </section>
      <section class="review-list">
        ${
          payload.items.length
            ? payload.items
                .map(
                  (review) => `
                    <article class="review-card">
                      <div class="review-head">
                        <strong>${escapeHtml(review.nickname)}</strong>
                        <span>${formatDate(review.createdAt, { year: true, time: true })}</span>
                      </div>
                      <p>${escapeHtml(review.content)}</p>
                    </article>
                  `,
                )
                .join("")
            : `<div class="empty-panel">还没有公开评价</div>`
        }
      </section>
    </div>
  `;
  state.currentEventId = eventId;
}

async function submitReview() {
  if (!requireLogin()) return;
  const content = document.querySelector("#review-content")?.value.trim();
  if (!content || content.length < 5) {
    showToast("评价至少需要 5 个字", "error");
    return;
  }
  try {
    await api(`/api/events/${state.currentEventId}/reviews`, {
      method: "POST",
      body: { content },
    });
    showToast("评价已提交，等待管理员审核");
    document.querySelector("#review-content").value = "";
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function renderCertificates() {
  if (!requireLogin()) {
    location.hash = "#/profile";
    return;
  }
  const payload = await api("/api/me/certificates");
  app.innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow">FINISH LINE ARCHIVE</span>
        <h1>你的每一步都有凭证</h1>
      </div>
      <a class="text-link" href="#/profile">返回个人中心 →</a>
    </div>
    ${
      payload.items.length
        ? `<section class="certificate-grid" data-testid="certificate-grid">${payload.items
            .map(
              (item) => `
                <article class="certificate">
                  <div class="certificate-top"><span>CAMPUS RUN CLUB / FINISHER</span><span>已颁发</span></div>
                  <div class="certificate-seal">R</div>
                  <h2>${escapeHtml(item.eventTitle)}</h2>
                  <span class="eyebrow">THIS CERTIFIES THAT</span>
                  <div class="certificate-name">${escapeHtml(item.nickname)}</div>
                  <div class="certificate-meta">
                    <div><span>比赛日期</span><strong>${formatDate(item.eventStartsAt)}</strong></div>
                    <div><span>完赛时间</span><strong>${formatDuration(item.finishTimeSeconds)}</strong></div>
                    <div><span>成绩分组</span><strong>${escapeHtml(item.groupName)}</strong></div>
                  </div>
                  <div class="certificate-serial">${escapeHtml(item.serialNo)}</div>
                </article>
              `,
            )
            .join("")}</section>`
        : `<div class="empty-panel">暂无已颁发的完赛证书</div>`
    }
  `;
}

async function renderFavorites() {
  const payload = await api(joinUrl({ pageSize: "100" }));
  const items = payload.items.filter((event) =>
    state.favorites.includes(event.id),
  );
  app.innerHTML = `
    <div class="section-head">
      <div><span class="eyebrow">SAVED RACES</span><h1>我的收藏</h1></div>
      <a class="text-link" href="#/profile">返回个人中心 →</a>
    </div>
    ${
      items.length
        ? `<section class="event-grid">${items.map(eventCard).join("")}</section>`
        : `<div class="empty-panel">还没有收藏赛事</div>`
    }
  `;
}

async function renderMyReviews() {
  if (!requireLogin()) {
    location.hash = "#/profile";
    return;
  }
  const payload = await api("/api/me/reviews");
  app.innerHTML = `
    <div class="section-head">
      <div><span class="eyebrow">MY RUNNER NOTES</span><h1>我的评价</h1></div>
      <a class="text-link" href="#/profile">返回个人中心 →</a>
    </div>
    ${
      payload.items.length
        ? `<section class="review-list">${payload.items
            .map(
              (item) => `
                <article class="review-card">
                  <div class="review-head">
                    <a href="#/event/${item.eventId}"><strong>${escapeHtml(item.eventTitle)}</strong></a>
                    <span class="status-chip" data-status="${item.status}">${statusLabels[item.status] ?? item.status}</span>
                  </div>
                  <p>${escapeHtml(item.content)}</p>
                </article>
              `,
            )
            .join("")}</section>`
        : `<div class="empty-panel">还没有发表评价</div>`
    }
  `;
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function updateNav(route) {
  const active =
    route === "event" || route === "reviews"
      ? "events"
      : route === "certificates" ||
          route === "favorites" ||
          route === "my-reviews"
        ? "profile"
        : route;
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.nav === active);
  });
}

async function route() {
  const hash = location.hash || "#/home";
  const [, path, parameter] = hash.match(/^#\/([^/]+)(?:\/(.+))?$/) ?? [];
  updateNav(path ?? "home");
  app.innerHTML = `<div class="loading-panel">正在加载...</div>`;
  window.scrollTo({ top: 0, behavior: "instant" });
  try {
    if (!path || path === "home") await renderHome();
    else if (path === "events") await renderEvents();
    else if (path === "event") await renderEventDetail(parameter);
    else if (path === "profile") await renderProfile();
    else if (path === "reviews") await renderReviews(parameter);
    else if (path === "certificates") await renderCertificates();
    else if (path === "favorites") await renderFavorites();
    else if (path === "my-reviews") await renderMyReviews();
    else {
      app.innerHTML = `<div class="empty-panel">页面不存在</div>`;
    }
  } catch (error) {
    app.innerHTML = `<div class="empty-panel" data-testid="page-error">${escapeHtml(
      error.message,
    )}</div>`;
    showToast(error.message, "error");
  }
}

loginButton.addEventListener("click", () => {
  if (state.user) {
    clearSession();
    showToast("已退出登录");
    if (location.hash === "#/profile") route();
    return;
  }
  loginDialog.showModal();
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorNode = document.querySelector("#login-error");
  errorNode.textContent = "";
  try {
    const payload = await api("/api/auth/login", {
      method: "POST",
      body: {
        username: form.elements.username.value,
        password: form.elements.password.value,
      },
    });
    if (payload.user.role !== "USER" && payload.user.role !== "ADMIN") {
      throw new Error("当前账号不可用");
    }
    saveSession(payload);
    loginDialog.close();
    showToast("登录成功");
    route();
  } catch (error) {
    errorNode.textContent = error.message;
  }
});

document.addEventListener("click", async (event) => {
  const routeTarget = event.target.closest("[data-route]");
  if (routeTarget) {
    location.hash = routeTarget.dataset.route;
    return;
  }
  const filter = event.target.closest("[data-filter]");
  if (filter) {
    state.eventStatus = filter.dataset.filter;
    await renderEvents();
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "close-login") loginDialog.close();
  if (action === "open-login") loginDialog.showModal();
  if (action === "logout") {
    clearSession();
    showToast("已退出登录");
    route();
  }
  if (action === "favorite" && state.currentEvent) {
    if (state.favorites.includes(state.currentEvent.id)) {
      state.favorites = state.favorites.filter(
        (id) => id !== state.currentEvent.id,
      );
      showToast("已取消收藏");
    } else {
      state.favorites.push(state.currentEvent.id);
      showToast("收藏成功");
    }
    localStorage.setItem("marathon-favorites", JSON.stringify(state.favorites));
    await renderEventDetail(state.currentEvent.id);
  }
  if (action === "share") {
    if (navigator.share) {
      await navigator.share({
        title: state.currentEvent.title,
        url: location.href,
      });
    } else {
      await navigator.clipboard.writeText(location.href);
      showToast("赛事链接已复制");
    }
  }
  if (action === "register") await registerCurrentEvent();
  if (action === "pay") await payCurrentRegistration(event.target.closest("[data-id]").dataset.id);
  if (action === "submit-review") await submitReview();
});

window.addEventListener("hashchange", route);
updateHeader();
route();
