const state = {
  token: sessionStorage.getItem("marathon-admin-token"),
  user: JSON.parse(sessionStorage.getItem("marathon-admin-user") ?? "null"),
  page: "dashboard",
  cache: {},
  dialogSubmit: null,
};

const pageTitles = {
  dashboard: "工作台",
  events: "赛事管理",
  registrations: "报名管理",
  results: "成绩管理",
  certificates: "证书管理",
  schools: "学校管理",
  reviews: "评价管理",
};

const statusLabels = {
  REGISTERING: "报名中",
  UPCOMING: "未开始",
  ENDED: "已结束",
  WAIT_PAYMENT: "待缴费",
  REGISTERED: "已报名",
  COMPLETED: "已完赛",
  CANCELLED: "已取消",
  PENDING: "待审核",
  APPROVED: "已通过",
  REJECTED: "已驳回",
  UNISSUED: "未颁发",
  ISSUED: "已颁发",
};

const loginView = document.querySelector("#login-view");
const appView = document.querySelector("#app-view");
const pageContent = document.querySelector("#page-content");
const pageTitle = document.querySelector("#page-title");
const dialog = document.querySelector("#resource-dialog");
const dialogTitle = document.querySelector("#dialog-title");
const dialogBody = document.querySelector("#dialog-body");
const resourceForm = document.querySelector("#resource-form");
const toast = document.querySelector("#toast");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDuration(seconds) {
  if (!seconds) return "-";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function badge(status) {
  const key = String(status ?? "").toLowerCase();
  return `<span class="badge badge-${escapeHtml(key)}">${escapeHtml(
    statusLabels[status] ?? status ?? "-",
  )}</span>`;
}

function showToast(message, type = "success") {
  toast.textContent = message;
  toast.classList.toggle("is-error", type === "error");
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2800);
}

async function api(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers ?? {}),
  };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    ...options,
    headers,
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      logout(false);
    }
    const error = new Error(
      payload.error?.message ?? `Request failed with ${response.status}`,
    );
    error.status = response.status;
    error.code = payload.error?.code;
    throw error;
  }
  return payload;
}

function logout(showMessage = true) {
  state.token = null;
  state.user = null;
  sessionStorage.removeItem("marathon-admin-token");
  sessionStorage.removeItem("marathon-admin-user");
  appView.hidden = true;
  loginView.hidden = false;
  if (showMessage) showToast("已退出登录");
}

function startSession(payload) {
  state.token = payload.token;
  state.user = payload.user;
  sessionStorage.setItem("marathon-admin-token", payload.token);
  sessionStorage.setItem(
    "marathon-admin-user",
    JSON.stringify(payload.user),
  );
  loginView.hidden = true;
  appView.hidden = false;
  document.querySelector("#admin-name").textContent = payload.user.nickname;
  renderPage("dashboard");
}

function pageIntro(title, description, action = "") {
  return `
    <div class="page-intro">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
      ${action}
    </div>
  `;
}

function tableMarkup(headers, rows, emptyText = "暂无数据") {
  if (!rows.length) {
    return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  }
  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  `;
}

async function renderPage(page) {
  state.page = page;
  pageTitle.textContent = pageTitles[page];
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.page === page);
  });
  pageContent.innerHTML = `<div class="empty-state">正在载入...</div>`;
  try {
    if (page === "dashboard") await renderDashboard();
    if (page === "events") await renderEvents();
    if (page === "registrations") await renderRegistrations();
    if (page === "results") await renderResults();
    if (page === "certificates") await renderCertificates();
    if (page === "schools") await renderSchools();
    if (page === "reviews") await renderReviews();
    pageContent.focus({ preventScroll: true });
  } catch (error) {
    pageContent.innerHTML = `<div class="empty-state">${escapeHtml(
      error.message,
    )}</div>`;
    showToast(error.message, "error");
  }
}

async function renderDashboard() {
  const payload = await api("/api/admin/dashboard");
  const statItems = [
    ["总赛事数", payload.stats.events, "赛"],
    ["正式报名人数", payload.stats.registrations, "人"],
    ["已颁发证书", payload.stats.certificates, "证"],
    ["合作学校", payload.stats.schools, "校"],
  ];
  const rows = payload.recentEvents.map(
    (event) => `
      <tr>
        <td><strong>${escapeHtml(event.title)}</strong><span class="subline">${escapeHtml(
          event.location,
        )}</span></td>
        <td>${badge(event.status)}</td>
        <td>${formatDate(event.startsAt)}</td>
        <td>${event.registeredCount} / ${event.capacity}</td>
      </tr>`,
  );
  pageContent.innerHTML = `
    ${pageIntro(
      "欢迎回来",
      "管理赛事、报名、成绩与证书，并跟踪近期活动的报名进度。",
      '<button class="button button-primary" data-action="new-event">新建赛事</button>',
    )}
    <section class="stats-grid">
      ${statItems
        .map(
          ([label, value, mark]) => `
            <article class="stat-card">
              <div class="stat-mark">${mark}</div>
              <p>${label}</p>
              <strong>${value}</strong>
            </article>`,
        )
        .join("")}
    </section>
    <section class="panel">
      <header class="panel-header">
        <h2>近期赛事</h2>
        <button class="button button-ghost button-small" data-page-link="events">查看全部</button>
      </header>
      ${tableMarkup(["赛事", "状态", "比赛时间", "报名 / 名额"], rows)}
    </section>
  `;
}

async function loadEvents(keyword = "") {
  const query = new URLSearchParams({ pageSize: "100" });
  if (keyword) query.set("q", keyword);
  const payload = await api(`/api/admin/events?${query}`);
  state.cache.events = payload;
  return payload;
}

async function renderEvents(keyword = "") {
  const payload = await loadEvents(keyword);
  const rows = payload.items.map(
    (event) => `
      <tr>
        <td><strong>${escapeHtml(event.title)}</strong><span class="subline">${escapeHtml(
          event.location,
        )}</span></td>
        <td>${badge(event.status)}</td>
        <td>${formatDate(event.startsAt)}<span class="subline">报名截止 ${formatDate(
          event.registrationClosesAt,
        )}</span></td>
        <td>¥${escapeHtml(event.feeYuan)}</td>
        <td>${event.registeredCount} / ${event.capacity}</td>
        <td>
          <div class="table-actions">
            <button class="button button-ghost button-small" data-action="edit-event" data-id="${event.id}">编辑</button>
            <button class="button button-danger button-small" data-action="delete-event" data-id="${event.id}">删除</button>
          </div>
        </td>
      </tr>`,
  );
  pageContent.innerHTML = `
    ${pageIntro(
      "赛事管理",
      "创建活动并维护报名时间、比赛时间、费用和名额。",
      '<button class="button button-primary" data-action="new-event">新建赛事</button>',
    )}
    <section class="panel">
      <header class="panel-header">
        <h2>全部赛事</h2>
        <form class="toolbar" data-search-form="events">
          <input name="q" placeholder="搜索赛事名称或地点" value="${escapeHtml(
            keyword,
          )}" />
          <button class="button button-ghost button-small" type="submit">搜索</button>
        </form>
      </header>
      ${tableMarkup(["赛事", "状态", "比赛时间", "费用", "报名 / 名额", "操作"], rows)}
    </section>
  `;
}

async function renderRegistrations(keyword = "", status = "") {
  const query = new URLSearchParams({ pageSize: "100" });
  if (keyword) query.set("q", keyword);
  if (status) query.set("status", status);
  const payload = await api(`/api/admin/registrations?${query}`);
  const rows = payload.items.map(
    (item) => `
      <tr>
        <td><strong>${escapeHtml(item.nickname)}</strong><span class="subline">${escapeHtml(
          item.userId,
        )}</span></td>
        <td>${escapeHtml(item.eventTitle)}</td>
        <td>${badge(item.status)}</td>
        <td>${formatDate(item.createdAt)}</td>
        <td>${formatDate(item.paidAt)}</td>
        <td>
          <div class="table-actions">
            ${
              item.status === "WAIT_PAYMENT"
                ? `<button class="button button-success button-small" data-action="registration-status" data-id="${item.id}" data-status="REGISTERED">确认缴费</button>`
                : ""
            }
            ${
              item.status !== "CANCELLED"
                ? `<button class="button button-danger button-small" data-action="registration-status" data-id="${item.id}" data-status="CANCELLED">取消</button>`
                : ""
            }
          </div>
        </td>
      </tr>`,
  );
  pageContent.innerHTML = `
    ${pageIntro(
      "报名管理",
      "查看用户报名状态；缴费完成才计入正式报名。",
    )}
    <section class="panel">
      <header class="panel-header">
        <h2>报名记录</h2>
        <form class="toolbar" data-search-form="registrations">
          <input name="q" placeholder="赛事或选手信息" value="${escapeHtml(keyword)}" />
          <select name="status">
            <option value="">全部状态</option>
            ${["WAIT_PAYMENT", "REGISTERED", "COMPLETED", "CANCELLED"]
              .map(
                (value) =>
                  `<option value="${value}" ${status === value ? "selected" : ""}>${statusLabels[value]}</option>`,
              )
              .join("")}
          </select>
          <button class="button button-ghost button-small" type="submit">筛选</button>
        </form>
      </header>
      ${tableMarkup(["选手", "赛事", "状态", "报名时间", "缴费时间", "操作"], rows)}
    </section>
  `;
}

async function renderReviews(keyword = "", status = "") {
  const query = new URLSearchParams({ pageSize: "100" });
  if (keyword) query.set("q", keyword);
  if (status) query.set("status", status);
  const payload = await api(`/api/admin/reviews?${query}`);
  const rows = payload.items.map(
    (item) => `
      <tr>
        <td><strong>${escapeHtml(item.eventTitle)}</strong><span class="subline">${escapeHtml(
          item.nickname,
        )}</span></td>
        <td><div class="review-copy">${escapeHtml(item.content)}</div></td>
        <td>${badge(item.status)}</td>
        <td>${formatDate(item.createdAt)}</td>
        <td>
          <div class="table-actions">
            ${
              item.status === "PENDING"
                ? `
                  <button class="button button-success button-small" data-action="review-status" data-id="${item.id}" data-status="APPROVED">通过</button>
                  <button class="button button-danger button-small" data-action="review-status" data-id="${item.id}" data-status="REJECTED">驳回</button>
                `
                : ""
            }
            <button class="button button-ghost button-small" data-action="delete-review" data-id="${item.id}">删除</button>
          </div>
        </td>
      </tr>`,
  );
  pageContent.innerHTML = `
    ${pageIntro(
      "评价管理",
      "审核用户评价。待审核内容不会出现在用户端公开列表。",
    )}
    <section class="panel">
      <header class="panel-header">
        <h2>评价记录</h2>
        <form class="toolbar" data-search-form="reviews">
          <input name="q" placeholder="赛事或评价内容" value="${escapeHtml(keyword)}" />
          <select name="status">
            <option value="">全部状态</option>
            ${["PENDING", "APPROVED", "REJECTED"]
              .map(
                (value) =>
                  `<option value="${value}" ${status === value ? "selected" : ""}>${statusLabels[value]}</option>`,
              )
              .join("")}
          </select>
          <button class="button button-ghost button-small" type="submit">筛选</button>
        </form>
      </header>
      ${tableMarkup(["赛事 / 用户", "评价内容", "状态", "提交时间", "操作"], rows)}
    </section>
  `;
}

async function renderResults() {
  const payload = await api("/api/admin/results?pageSize=100");
  const rows = payload.items.map(
    (item) => `
      <tr>
        <td><strong>${escapeHtml(item.nickname)}</strong><span class="subline">${escapeHtml(
          item.userId,
        )}</span></td>
        <td>${escapeHtml(item.eventTitle)}</td>
        <td>${escapeHtml(item.groupName)}</td>
        <td>${formatDuration(item.finishTimeSeconds)}</td>
        <td>${item.published ? badge("APPROVED") : badge("PENDING")}</td>
        <td><button class="button button-danger button-small" data-action="delete-result" data-id="${item.id}">删除</button></td>
      </tr>`,
  );
  pageContent.innerHTML = `
    ${pageIntro(
      "成绩管理",
      "录入选手成绩后，报名状态会自动流转为“已完赛”。",
      '<button class="button button-primary" data-action="new-result">录入成绩</button>',
    )}
    <section class="panel">
      <header class="panel-header"><h2>成绩记录</h2></header>
      ${tableMarkup(["选手", "赛事", "分组", "完赛时间", "状态", "操作"], rows)}
    </section>
  `;
}

async function renderCertificates() {
  const payload = await api("/api/admin/certificates?pageSize=100");
  const rows = payload.items.map(
    (item) => `
      <tr>
        <td><strong>${escapeHtml(item.eventTitle)}</strong><span class="subline">${escapeHtml(
          item.nickname,
        )}</span></td>
        <td>${escapeHtml(item.serialNo)}</td>
        <td>${escapeHtml(item.groupName)}</td>
        <td>${formatDuration(item.finishTimeSeconds)}</td>
        <td>${badge(item.status)}</td>
        <td>
          <div class="table-actions">
            ${
              item.status === "UNISSUED"
                ? `<button class="button button-success button-small" data-action="issue-certificate" data-id="${item.id}">颁发</button>`
                : ""
            }
            <button class="button button-danger button-small" data-action="delete-certificate" data-id="${item.id}">删除</button>
          </div>
        </td>
      </tr>`,
  );
  pageContent.innerHTML = `
    ${pageIntro(
      "证书管理",
      "为已完赛选手生成证书，只有颁发后的证书会出现在用户端。",
      '<button class="button button-primary" data-action="new-certificate">生成证书</button>',
    )}
    <section class="panel">
      <header class="panel-header"><h2>证书记录</h2></header>
      ${tableMarkup(["赛事 / 选手", "证书编号", "分组", "完赛时间", "状态", "操作"], rows)}
    </section>
  `;
}

async function renderSchools(keyword = "") {
  const query = new URLSearchParams({ pageSize: "100" });
  if (keyword) query.set("q", keyword);
  const payload = await api(`/api/admin/schools?${query}`);
  const rows = payload.items.map(
    (item) => `
      <tr>
        <td><strong>${escapeHtml(item.name)}</strong><span class="subline">${escapeHtml(
          item.code,
        )}</span></td>
        <td>${escapeHtml(item.contactName)}</td>
        <td>${escapeHtml(item.contactPhone)}</td>
        <td>${formatDate(item.createdAt)}</td>
        <td><button class="button button-danger button-small" data-action="delete-school" data-id="${item.id}">删除</button></td>
      </tr>`,
  );
  pageContent.innerHTML = `
    ${pageIntro(
      "学校管理",
      "维护合作院校及联系人信息。",
      '<button class="button button-primary" data-action="new-school">新增学校</button>',
    )}
    <section class="panel">
      <header class="panel-header">
        <h2>合作学校</h2>
        <form class="toolbar" data-search-form="schools">
          <input name="q" placeholder="学校名称或代码" value="${escapeHtml(keyword)}" />
          <button class="button button-ghost button-small" type="submit">搜索</button>
        </form>
      </header>
      ${tableMarkup(["学校", "联系人", "联系电话", "创建时间", "操作"], rows)}
    </section>
  `;
}

function openDialog(title, body, submit) {
  dialogTitle.textContent = title;
  dialogBody.innerHTML = body;
  state.dialogSubmit = submit;
  dialog.showModal();
}

function closeDialog() {
  dialog.close();
  state.dialogSubmit = null;
  resourceForm.reset();
}

function eventFormFields(event = {}) {
  const starts = event.startsAt
    ? toDateInput(event.startsAt)
    : toDateInput(new Date(Date.now() + 14 * 86400000));
  const ends = event.endsAt
    ? toDateInput(event.endsAt)
    : toDateInput(new Date(Date.now() + 14 * 86400000 + 4 * 3600000));
  const opens = event.registrationOpensAt
    ? toDateInput(event.registrationOpensAt)
    : toDateInput(new Date());
  const closes = event.registrationClosesAt
    ? toDateInput(event.registrationClosesAt)
    : toDateInput(new Date(Date.now() + 7 * 86400000));
  return `
    <div class="form-grid">
      <label class="span-2">赛事名称<input name="title" value="${escapeHtml(
        event.title ?? "",
      )}" required /></label>
      <label>举办地点<input name="location" value="${escapeHtml(
        event.location ?? "",
      )}" required /></label>
      <label>报名费用（元）<input name="feeYuan" type="number" min="0" step="0.01" value="${escapeHtml(
        event.feeYuan ?? "70.00",
      )}" required /></label>
      <label>报名开始<input name="registrationOpensAt" type="datetime-local" value="${opens}" required /></label>
      <label>报名截止<input name="registrationClosesAt" type="datetime-local" value="${closes}" required /></label>
      <label>比赛开始<input name="startsAt" type="datetime-local" value="${starts}" required /></label>
      <label>比赛结束<input name="endsAt" type="datetime-local" value="${ends}" required /></label>
      <label>参赛名额<input name="capacity" type="number" min="1" value="${escapeHtml(
        event.capacity ?? 500,
      )}" required /></label>
      <label>发布状态
        <select name="published">
          <option value="true" ${event.published !== false ? "selected" : ""}>已发布</option>
          <option value="false" ${event.published === false ? "selected" : ""}>未发布</option>
        </select>
      </label>
      <label class="span-2">活动介绍<textarea name="description" required>${escapeHtml(
        event.description ?? "",
      )}</textarea></label>
    </div>
  `;
}

function openEventForm(event = null) {
  openDialog(
    event ? "编辑赛事" : "新建赛事",
    eventFormFields(event ?? {}),
    async (form) => {
      const data = Object.fromEntries(new FormData(form));
      const body = {
        title: data.title,
        location: data.location,
        feeCents: Math.round(Number(data.feeYuan) * 100),
        capacity: Number(data.capacity),
        registrationOpensAt: new Date(data.registrationOpensAt).toISOString(),
        registrationClosesAt: new Date(
          data.registrationClosesAt,
        ).toISOString(),
        startsAt: new Date(data.startsAt).toISOString(),
        endsAt: new Date(data.endsAt).toISOString(),
        published: data.published === "true",
        description: data.description,
      };
      await api(
        event ? `/api/admin/events/${event.id}` : "/api/admin/events",
        { method: event ? "PATCH" : "POST", body },
      );
      closeDialog();
      showToast(event ? "赛事已更新" : "赛事已创建");
      await renderPage("events");
    },
  );
}

async function openResultForm() {
  const payload = await api("/api/admin/registrations?pageSize=100");
  const options = payload.items
    .filter((item) => item.status !== "CANCELLED")
    .map(
      (item) =>
        `<option value="${item.id}" data-user-id="${item.userId}" data-event-id="${item.eventId}">${escapeHtml(
          item.nickname,
        )} · ${escapeHtml(item.eventTitle)}</option>`,
    );
  openDialog(
    "录入成绩",
    `
      <div class="form-grid">
        <label class="span-2">报名记录
          <select name="registrationId" required>
            <option value="">请选择</option>
            ${options.join("")}
          </select>
        </label>
        <label>成绩分组<input name="groupName" value="10 公里大众组" required /></label>
        <label>完赛时间（秒）<input name="finishTimeSeconds" type="number" min="1" value="3600" required /></label>
      </div>
    `,
    async (form) => {
      const select = form.elements.registrationId;
      const option = select.selectedOptions[0];
      if (!option?.dataset.userId) throw new Error("请选择报名记录");
      await api("/api/admin/results", {
        method: "POST",
        body: {
          userId: option.dataset.userId,
          eventId: option.dataset.eventId,
          groupName: form.elements.groupName.value,
          finishTimeSeconds: Number(form.elements.finishTimeSeconds.value),
        },
      });
      closeDialog();
      showToast("成绩已保存");
      await renderPage("results");
    },
  );
}

async function openCertificateForm() {
  const payload = await api("/api/admin/registrations?pageSize=100");
  const options = payload.items
    .filter((item) => item.status === "COMPLETED")
    .map(
      (item) =>
        `<option value="${item.id}" data-user-id="${item.userId}" data-event-id="${item.eventId}">${escapeHtml(
          item.nickname,
        )} · ${escapeHtml(item.eventTitle)}</option>`,
    );
  openDialog(
    "生成证书",
    `
      <label>已完赛报名记录
        <select name="registrationId" required>
          <option value="">请选择</option>
          ${options.join("")}
        </select>
      </label>
    `,
    async (form) => {
      const option = form.elements.registrationId.selectedOptions[0];
      if (!option?.dataset.userId) throw new Error("请选择已完赛报名记录");
      await api("/api/admin/certificates", {
        method: "POST",
        body: {
          userId: option.dataset.userId,
          eventId: option.dataset.eventId,
        },
      });
      closeDialog();
      showToast("证书已生成");
      await renderPage("certificates");
    },
  );
}

function openSchoolForm() {
  openDialog(
    "新增学校",
    `
      <div class="form-grid">
        <label>学校名称<input name="name" required /></label>
        <label>学校代码<input name="code" required /></label>
        <label>联系人<input name="contactName" required /></label>
        <label>联系电话<input name="contactPhone" required /></label>
      </div>
    `,
    async (form) => {
      const data = Object.fromEntries(new FormData(form));
      await api("/api/admin/schools", { method: "POST", body: data });
      closeDialog();
      showToast("学校已创建");
      await renderPage("schools");
    },
  );
}

async function handleAction(action, id, element) {
  if (action === "new-event") return openEventForm();
  if (action === "edit-event") {
    const event = state.cache.events?.items.find((item) => item.id === id);
    return openEventForm(event);
  }
  if (action === "delete-event") {
    if (!window.confirm("删除赛事会同时删除关联报名、成绩和证书，确认继续？")) return;
    await api(`/api/admin/events/${id}`, { method: "DELETE" });
    showToast("赛事已删除");
    return renderPage("events");
  }
  if (action === "registration-status") {
    await api(`/api/admin/registrations/${id}`, {
      method: "PATCH",
      body: { status: element.dataset.status },
    });
    showToast("报名状态已更新");
    return renderPage("registrations");
  }
  if (action === "review-status") {
    await api(`/api/admin/reviews/${id}`, {
      method: "PATCH",
      body: { status: element.dataset.status },
    });
    showToast("评价审核完成");
    return renderPage("reviews");
  }
  if (action === "delete-review") {
    if (!window.confirm("确认删除这条评价？")) return;
    await api(`/api/admin/reviews/${id}`, { method: "DELETE" });
    showToast("评价已删除");
    return renderPage("reviews");
  }
  if (action === "new-result") return openResultForm();
  if (action === "delete-result") {
    if (!window.confirm("确认删除这条成绩？")) return;
    await api(`/api/admin/results/${id}`, { method: "DELETE" });
    showToast("成绩已删除");
    return renderPage("results");
  }
  if (action === "new-certificate") return openCertificateForm();
  if (action === "issue-certificate") {
    await api(`/api/admin/certificates/${id}/issue`, { method: "PATCH" });
    showToast("证书已颁发");
    return renderPage("certificates");
  }
  if (action === "delete-certificate") {
    if (!window.confirm("确认删除证书？")) return;
    await api(`/api/admin/certificates/${id}`, { method: "DELETE" });
    showToast("证书已删除");
    return renderPage("certificates");
  }
  if (action === "new-school") return openSchoolForm();
  if (action === "delete-school") {
    if (!window.confirm("确认删除这所学校？")) return;
    await api(`/api/admin/schools/${id}`, { method: "DELETE" });
    showToast("学校已删除");
    return renderPage("schools");
  }
  if (action === "close-dialog") {
    closeDialog();
  }
}

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
    if (payload.user.role !== "ADMIN") {
      throw new Error("当前账号不是管理员");
    }
    startSession(payload);
  } catch (error) {
    errorNode.textContent = error.message;
  }
});

document.querySelector("#main-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (button) renderPage(button.dataset.page);
});

document.querySelector("#logout-button").addEventListener("click", () => logout());

pageContent.addEventListener("click", async (event) => {
  const pageLink = event.target.closest("[data-page-link]");
  if (pageLink) {
    await renderPage(pageLink.dataset.pageLink);
    return;
  }
  const button = event.target.closest("[data-action]");
  if (button) {
    try {
      await handleAction(button.dataset.action, button.dataset.id, button);
    } catch (error) {
      showToast(error.message, "error");
    }
  }
});

pageContent.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-search-form]");
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.dataset.searchForm === "events") {
      await renderEvents(data.q);
    }
    if (form.dataset.searchForm === "registrations") {
      await renderRegistrations(data.q, data.status);
    }
    if (form.dataset.searchForm === "reviews") {
      await renderReviews(data.q, data.status);
    }
    if (form.dataset.searchForm === "schools") {
      await renderSchools(data.q);
    }
  } catch (error) {
    showToast(error.message, "error");
  }
});

resourceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.dialogSubmit) return;
  try {
    await state.dialogSubmit(event.currentTarget);
  } catch (error) {
    showToast(error.message, "error");
  }
});

document.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="close-dialog"]');
  if (button) {
    closeDialog();
  }
});

dialog.addEventListener("close", () => {
  state.dialogSubmit = null;
});

if (state.token && state.user?.role === "ADMIN") {
  loginView.hidden = true;
  appView.hidden = false;
  document.querySelector("#admin-name").textContent = state.user.nickname;
  renderPage("dashboard");
} else {
  logout(false);
}
