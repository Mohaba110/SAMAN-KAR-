import { loadState, saveState } from "./db.js";
import {
  APP_VERSION,
  STATUSES,
  PROJECT_STATUSES,
  PRIORITIES,
  createDefaultState,
  migrateState,
  createId,
  localISO,
  addDaysISO,
  formatFaDate,
  normalizePersian,
  materializeRoutineTasks,
  selectFocusTasks,
  selectTodayTasks,
  selectWaitingTasks,
  selectDueFollowups,
  followupBucket,
  selectWeeklyResults,
  isProjectAtRisk,
  setTaskDailyFocus,
  setProjectWeeklyFocus,
  domainName,
  projectName,
  isTaskOpen,
  priorityOrder
} from "./model.js";

const main = document.querySelector("#app-main");
const screenTitle = document.querySelector("#screen-title");
const todayLabel = document.querySelector("#today-label");
const inboxBadge = document.querySelector("#inbox-badge");
const captureDialog = document.querySelector("#capture-dialog");
const actionDialog = document.querySelector("#action-dialog");
const actionTitle = document.querySelector("#action-title");
const actionKicker = document.querySelector("#action-kicker");
const actionContent = document.querySelector("#action-content");
const actionFooter = document.querySelector("#action-footer");
const toastElement = document.querySelector("#toast");

let state = createDefaultState();
let currentPage = "today";
let projectFilter = "active";
let followupFilter = "due";
let reviewTab = "daily";
let pendingAttachments = [];
let mediaRecorder = null;
let recordingStream = null;
let recordingStartedAt = 0;
let recordingTimer = null;
let discardCurrentRecording = false;
let deferredInstallPrompt = null;
let toastTimer = null;
let dialogObjectUrls = [];

const pageTitles = {
  today: "امروز",
  inbox: "ورودی",
  projects: "پروژه‌ها",
  followups: "پیگیری‌ها",
  review: "مرور و گزارش"
};

const statusLabels = {
  inbox: "ورودی",
  ready: "آماده اقدام",
  doing: "در حال انجام",
  waiting: "منتظر",
  done: "انجام‌شده",
  cancelled: "لغوشده",
  planned: "برنامه‌ریزی‌شده",
  active: "فعال",
  paused: "متوقف"
};

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function faNumber(value) {
  return new Intl.NumberFormat("fa-IR").format(Number(value || 0));
}

function svg(name) {
  return '<svg aria-hidden="true"><use href="#icon-' + name + '"></use></svg>';
}

function nowStamp() {
  return new Date().toISOString();
}

function todayISO() {
  return localISO(new Date());
}

function timestampLabel(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("fa-IR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function fullDateLabel() {
  return new Intl.DateTimeFormat("fa-IR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
}

function statusPill(status) {
  let className = "status-pill";
  if (status === STATUSES.WAITING || status === PROJECT_STATUSES.WAITING) className += " waiting";
  if (status === STATUSES.DONE || status === PROJECT_STATUSES.DONE) className += " done";
  if (status === STATUSES.CANCELLED || status === PROJECT_STATUSES.CANCELLED) className += " danger";
  return '<span class="' + className + '">' + escapeHtml(statusLabels[status] || status) + "</span>";
}

function priorityPill(priority) {
  return '<span class="priority-pill ' + (priority === "P1" ? "p1" : "") + '">' + escapeHtml(priority || "P2") + "</span>";
}

function attachmentCount(item) {
  return Array.isArray(item && item.attachments) ? item.attachments.length : 0;
}

function attachmentButton(item, itemType) {
  const count = attachmentCount(item);
  if (!count) return "";
  return '<button class="ghost-button compact-button" type="button" data-action="attachments" data-kind="' + escapeHtml(itemType) + '" data-id="' + escapeHtml(item.id) + '">' + svg("clip") + faNumber(count) + " پیوست</button>";
}

function dueText(isoDate) {
  if (!isoDate) return "بدون مهلت";
  const today = todayISO();
  if (isoDate < today) return "عقب‌افتاده: " + formatFaDate(isoDate);
  if (isoDate === today) return "مهلت: امروز";
  if (isoDate === addDaysISO(today, 1)) return "مهلت: فردا";
  return "مهلت: " + formatFaDate(isoDate);
}

function emptyCard(title, description, buttonLabel, action) {
  let button = "";
  if (buttonLabel && action) {
    button = '<button class="primary-button" type="button" data-action="' + action + '">' + svg("plus") + escapeHtml(buttonLabel) + "</button>";
  }
  return '<div class="empty-card"><div class="empty-icon">' + svg("check") + "</div><h3>" + escapeHtml(title) + "</h3><p>" + escapeHtml(description) + "</p>" + button + "</div>";
}

async function persist(renderAfter) {
  state.updatedAt = nowStamp();
  try {
    await saveState(state);
  } catch (error) {
    console.error(error);
    showToast("ذخیره روی دستگاه انجام نشد؛ یک نسخه پشتیبان بگیرید.");
  }
  if (renderAfter !== false) render();
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.add("is-visible");
  toastTimer = window.setTimeout(function () {
    toastElement.classList.remove("is-visible");
  }, 3200);
}

function updateChrome() {
  screenTitle.textContent = pageTitles[currentPage] || "سامان‌کار";
  todayLabel.textContent = fullDateLabel();
  const count = state.inbox.length;
  inboxBadge.textContent = faNumber(count);
  inboxBadge.classList.toggle("is-hidden", count === 0);
  document.querySelectorAll(".nav-button").forEach(function (button) {
    button.classList.toggle("is-active", button.dataset.page === currentPage);
  });
}

function navigate(page) {
  currentPage = page;
  updateChrome();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function render() {
  updateChrome();
  if (currentPage === "inbox") main.innerHTML = renderInbox();
  else if (currentPage === "projects") main.innerHTML = renderProjects();
  else if (currentPage === "followups") main.innerHTML = renderFollowups();
  else if (currentPage === "review") main.innerHTML = renderReview();
  else main.innerHTML = renderToday();
}

function taskMeta(task) {
  const parts = [];
  if (task.domainId) parts.push(domainName(state, task.domainId));
  if (task.projectId) parts.push(projectName(state, task.projectId));
  if (task.owner) parts.push("مسئول: " + task.owner);
  if (task.deadline) parts.push(dueText(task.deadline));
  else if (task.actionDate) parts.push("اقدام: " + formatFaDate(task.actionDate));
  return parts.map(function (part) { return '<span class="meta-item">' + escapeHtml(part) + "</span>"; }).join("");
}

function taskCard(task, options) {
  const opts = options || {};
  const isDone = task.status === STATUSES.DONE;
  const isWaiting = task.status === STATUSES.WAITING;
  const isDoing = task.status === STATUSES.DOING;
  let index = "";
  if (opts.focusIndex) index = '<span class="focus-index">' + faNumber(opts.focusIndex) + "</span>";
  let note = "";
  if (isWaiting && task.waiting) {
    note = '<p class="card-note"><strong>منتظر از: </strong>' + escapeHtml(task.waiting.person || "نامشخص") + " — " + escapeHtml(task.waiting.expectedOutput || "خروجی مشخص نشده") + "</p>";
  } else if (isDone && task.result && task.result.outcome) {
    note = '<p class="card-note"><strong>نتیجه: </strong>' + escapeHtml(task.result.outcome) + "</p>";
  } else if (task.details) {
    note = '<p class="card-note">' + escapeHtml(task.details) + "</p>";
  }
  let actions = "";
  if (isDone) {
    actions = '<button class="ghost-button compact-button" type="button" data-action="task-details" data-id="' + escapeHtml(task.id) + '">مشاهده</button>';
  } else if (isWaiting) {
    actions = '<button class="primary-button compact-button" type="button" data-action="followup-update" data-id="' + escapeHtml(task.id) + '">ثبت پاسخ</button>' +
      '<button class="secondary-button compact-button" type="button" data-action="verify-delivery" data-id="' + escapeHtml(task.id) + '">تحویل رسید</button>';
  } else {
    actions = '<button class="primary-button compact-button" type="button" data-action="start-task" data-id="' + escapeHtml(task.id) + '">' + svg(isDoing ? "pause" : "play") + (isDoing ? "در حال انجام" : "شروع") + "</button>" +
      '<button class="secondary-button compact-button" type="button" data-action="wait-task" data-id="' + escapeHtml(task.id) + '">منتظر</button>' +
      '<button class="secondary-button compact-button" type="button" data-action="complete-task" data-id="' + escapeHtml(task.id) + '">انجام شد</button>';
  }
  if (!isDone && !isWaiting && !task.sourceRoutineId) {
    actions += '<button class="ghost-button compact-button" type="button" data-action="toggle-focus" data-id="' + escapeHtml(task.id) + '">' + (task.dailyFocus ? "خروج از سه تمرکز" : "افزودن به سه تمرکز") + "</button>";
  }
  actions += attachmentButton(task, "task");
  const classes = "card" + (opts.focusIndex ? " focus-card" : "") + (isDoing ? " is-doing" : "");
  return '<article class="' + classes + '"><div class="card-top">' + index + '<div class="card-title"><button class="title-button" type="button" data-action="task-details" data-id="' + escapeHtml(task.id) + '"><h3>' + escapeHtml(task.title) + "</h3></button><p>" + escapeHtml(task.domainChild || (task.sourceRoutineId ? "کار تکراری سیستم" : "")) + "</p></div><div>" + priorityPill(task.priority) + " " + statusPill(task.status) + '</div></div><div class="card-meta">' + taskMeta(task) + "</div>" + note + '<div class="card-actions">' + actions + "</div></article>";
}

function renderToday() {
  const today = todayISO();
  const groups = selectTodayTasks(state, today);
  const dueFollowups = selectDueFollowups(state, today);
  const completedFocus = groups.focus.filter(function (task) { return task.status === STATUSES.DONE; }).length;
  let focusHtml = groups.focus.map(function (task, index) { return taskCard(task, { focusIndex: index + 1 }); }).join("");
  for (let index = groups.focus.length; index < 3; index += 1) {
    focusHtml += '<button class="empty-slot" type="button" data-action="choose-focus">' + svg("plus") + "انتخاب خروجی شماره " + faNumber(index + 1) + "</button>";
  }
  let inboxNotice = "";
  if (state.inbox.length) {
    inboxNotice = '<button class="notice warning full-button" type="button" data-action="open-inbox">' + svg("inbox") + '<p><strong>' + faNumber(state.inbox.length) + " مورد در ورودی</strong>قبل از گم‌شدن، آن‌ها را تعیین تکلیف کن.</p></button>";
  }
  let dueNotice = "";
  if (dueFollowups.length) {
    dueNotice = '<button class="notice danger full-button" type="button" data-action="open-followups">' + svg("warning") + '<p><strong>' + faNumber(dueFollowups.length) + " پیگیری نیازمند اقدام</strong>پیگیری عقب‌افتاده یا سررسید امروز داری.</p></button>";
  }
  const progressDots = [0, 1, 2].map(function (index) {
    return '<span class="progress-dot ' + (index < completedFocus ? "is-filled" : "") + '"></span>';
  }).join("");
  let commitments = "";
  if (groups.commitments.length) {
    commitments = '<details class="accordion"><summary><span>تعهدهای دیگر امروز</span><span class="accordion-count">' + faNumber(groups.commitments.length) + '</span></summary><div class="accordion-body">' + groups.commitments.map(function (task) { return taskCard(task); }).join("") + "</div></details>";
  }
  let recurring = "";
  if (groups.recurring.length) {
    recurring = '<details class="accordion"><summary><span>کارهای تکراری امروز</span><span class="accordion-count">' + faNumber(groups.recurring.length) + '</span></summary><div class="accordion-body">' + groups.recurring.map(function (task) { return taskCard(task); }).join("") + "</div></details>";
  }
  let quick = "";
  if (groups.quick.length) {
    quick = '<details class="accordion"><summary><span>کارهای سریع زیر ۱۵ دقیقه</span><span class="accordion-count">' + faNumber(groups.quick.length) + '</span></summary><div class="accordion-body">' + groups.quick.map(function (task) { return taskCard(task); }).join("") + "</div></details>";
  }
  const userTaskCount = state.tasks.filter(function (task) { return !task.sourceRoutineId; }).length;
  const welcome = userTaskCount === 0 && state.inbox.length === 0 && state.projects.length === 0
    ? '<div class="notice"><span>' + svg("star") + '</span><p><strong>سامان‌کار آماده است</strong>هر چیزی وارد ذهنت شد با دکمه بزرگ «+» ثبت کن. لازم نیست همان لحظه دسته‌بندی‌اش کنی.</p></div>'
    : "";
  return '<div class="page-stack">' + welcome + inboxNotice + dueNotice +
    '<section class="hero-card"><div class="hero-row"><div><p class="eyebrow">قاعده امروز</p><h2>سه خروجی مهم؛ نه سه کار کل روز</h2></div><div class="progress-dots" aria-label="پیشرفت تمرکزها">' + progressDots + '</div></div><p>تعهدها و کارهای سریع می‌توانند بیشتر باشند؛ تمرکز اصلی فقط سه مورد است.</p><button class="ghost-button compact-button" type="button" data-action="choose-focus">مدیریت سه تمرکز</button></section>' +
    '<section class="section"><div class="section-heading"><div class="section-heading-copy"><div class="section-title"><h2>سه خروجی امروز</h2><span class="number">' + faNumber(groups.focus.length) + '/۳</span></div><p>چیزی که امروز باید واقعاً جلو برود.</p></div></div><div class="focus-grid">' + focusHtml + "</div></section>" +
    commitments + recurring + quick +
    '<section class="card"><div class="card-top"><div class="card-title"><p class="eyebrow">پایان روز</p><h3>نتیجه‌ها را ثبت کن و کارهای باز را تعیین تکلیف کن</h3></div>' + svg("review") + '</div><div class="card-actions"><button class="primary-button full-button" type="button" data-action="end-day">بستن روز</button></div></section>' +
    "</div>";
}

function renderInbox() {
  if (!state.inbox.length) {
    return '<div class="page-stack">' + emptyCard("ورودی خالی است", "هر چیزی را سریع ثبت کن؛ بعداً در همین‌جا نوع، حوزه و اقدامش را مشخص می‌کنی.", "ثبت سریع", "open-capture") + "</div>";
  }
  const cards = state.inbox.slice().sort(function (a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt));
  }).map(function (item) {
    const note = item.details ? '<p class="card-note">' + escapeHtml(item.details) + "</p>" : "";
    return '<article class="card"><div class="card-top"><div class="card-title"><h3>' + escapeHtml(item.title) + '</h3><p>ثبت‌شده: ' + escapeHtml(timestampLabel(item.createdAt)) + "</p></div>" + statusPill("inbox") + '</div>' + note + '<div class="card-meta"><span class="meta-item">' + faNumber(attachmentCount(item)) + ' پیوست</span></div><div class="card-actions"><button class="primary-button" type="button" data-action="process-inbox" data-id="' + escapeHtml(item.id) + '">تعیین تکلیف</button>' + attachmentButton(item, "inbox") + '<button class="danger-button compact-button" type="button" data-action="delete-inbox" data-id="' + escapeHtml(item.id) + '">' + svg("trash") + "حذف</button></div></article>";
  }).join("");
  return '<div class="page-stack"><div class="notice"><span>' + svg("inbox") + '</span><p><strong>قاعده ورودی</strong>این‌جا محل نگهداری نیست؛ هر مورد را به کار، پروژه، کار تکراری یا یادداشت تبدیل کن.</p></div><section class="section"><div class="section-heading"><div class="section-heading-copy"><h2>' + faNumber(state.inbox.length) + " مورد تعیین‌تکلیف‌نشده</h2><p>از قدیمی‌ترها شروع کن، یا مورد مهم را اول بردار.</p></div></div>" + cards + "</section></div>";
}

function getProjectNextTask(project) {
  if (!project.nextActionTaskId) return null;
  return state.tasks.find(function (task) {
    return task.id === project.nextActionTaskId && isTaskOpen(task) && task.status !== STATUSES.WAITING;
  }) || null;
}

function projectCard(project) {
  const nextTask = getProjectNextTask(project);
  const risk = isProjectAtRisk(project);
  let nextHtml = "";
  if (project.status === PROJECT_STATUSES.ACTIVE && nextTask) {
    nextHtml = '<div class="card-note"><span class="eyebrow">اقدام بعدی واحد</span><button class="title-button" type="button" data-action="task-details" data-id="' + escapeHtml(nextTask.id) + '"><strong>' + escapeHtml(nextTask.title) + '</strong></button><div class="card-meta">' + taskMeta(nextTask) + "</div></div>";
  } else if (project.status === PROJECT_STATUSES.ACTIVE) {
    nextHtml = '<div class="notice warning"><span>' + svg("warning") + '</span><p><strong>اقدام بعدی ندارد</strong>برای اینکه پروژه متوقف نشود، همین حالا یک اقدام روشن تعریف کن.</p></div>';
  }
  let riskHtml = "";
  if (risk) riskHtml = '<div class="notice danger"><span>' + svg("warning") + '</span><p><strong>هفت روز بدون حرکت</strong>آخرین فعالیت این پروژه بیش از هفت روز قبل بوده است.</p></div>';
  const blockerCount = Array.isArray(project.blockers) ? project.blockers.filter(Boolean).length : 0;
  const meta = [domainName(state, project.domainId), dueText(project.deadline), blockerCount ? faNumber(blockerCount) + " مانع" : "بدون مانع ثبت‌شده"];
  return '<article class="card"><div class="card-top"><div class="card-title"><button class="title-button" type="button" data-action="project-details" data-id="' + escapeHtml(project.id) + '"><h3>' + escapeHtml(project.title) + '</h3></button><p>' + escapeHtml(project.outcome || "خروجی نهایی تعریف نشده") + "</p></div><div>" + (project.weeklyFocus ? '<span class="status-pill done">تمرکز هفته</span> ' : "") + statusPill(project.status) + '</div></div><div class="card-meta">' + meta.map(function (item) { return '<span class="meta-item">' + escapeHtml(item) + "</span>"; }).join("") + "</div>" + riskHtml + nextHtml + '<div class="card-actions"><button class="primary-button compact-button" type="button" data-action="project-action" data-id="' + escapeHtml(project.id) + '">' + svg("plus") + 'اقدام بعدی</button><button class="secondary-button compact-button" type="button" data-action="project-details" data-id="' + escapeHtml(project.id) + '">جزئیات</button><button class="ghost-button compact-button" type="button" data-action="toggle-project-focus" data-id="' + escapeHtml(project.id) + '">' + (project.weeklyFocus ? "خروج از تمرکز هفته" : "تمرکز این هفته") + "</button>" + attachmentButton(project, "project") + "</div></article>";
}

function renderProjects() {
  const focusCount = state.projects.filter(function (project) { return project.weeklyFocus && project.status !== PROJECT_STATUSES.DONE && project.status !== PROJECT_STATUSES.CANCELLED; }).length;
  let projects = state.projects.slice();
  if (projectFilter === "focus") projects = projects.filter(function (project) { return project.weeklyFocus && project.status !== PROJECT_STATUSES.DONE && project.status !== PROJECT_STATUSES.CANCELLED; });
  else if (projectFilter === "active") projects = projects.filter(function (project) { return project.status === PROJECT_STATUSES.ACTIVE || project.status === PROJECT_STATUSES.PLANNED; });
  else if (projectFilter === "waiting") projects = projects.filter(function (project) { return project.status === PROJECT_STATUSES.WAITING || project.status === PROJECT_STATUSES.PAUSED; });
  else if (projectFilter === "done") projects = projects.filter(function (project) { return project.status === PROJECT_STATUSES.DONE || project.status === PROJECT_STATUSES.CANCELLED; });
  projects.sort(function (a, b) {
    if (a.weeklyFocus !== b.weeklyFocus) return a.weeklyFocus ? -1 : 1;
    return String(a.deadline || "9999-99-99").localeCompare(String(b.deadline || "9999-99-99"));
  });
  const segments = [
    ["active", "فعال"],
    ["focus", "تمرکز هفته " + faNumber(focusCount) + "/۳"],
    ["waiting", "منتظر"],
    ["done", "بایگانی"]
  ].map(function (item) {
    return '<button class="segment ' + (projectFilter === item[0] ? "is-active" : "") + '" type="button" data-action="project-filter" data-filter="' + item[0] + '">' + item[1] + "</button>";
  }).join("");
  const content = projects.length ? projects.map(projectCard).join("") : emptyCard("پروژه‌ای در این بخش نیست", projectFilter === "active" ? "پروژه، کاری است که چند اقدام دارد و به یک خروجی نهایی مشخص می‌رسد." : "فیلتر دیگری را انتخاب کن یا پروژه تازه‌ای بساز.", "پروژه جدید", "new-project");
  return '<div class="page-stack"><section class="hero-card"><div class="hero-row"><div><p class="eyebrow">تمرکز هفتگی</p><h2>حداکثر سه پروژه فعال در کانون توجه</h2></div><div class="progress-dots">' + [0, 1, 2].map(function (index) { return '<span class="progress-dot ' + (index < focusCount ? "is-filled" : "") + '"></span>'; }).join("") + '</div></div><p>هر پروژه فعال باید دقیقاً یک «اقدام بعدی» روشن داشته باشد؛ درصد پیشرفت لازم نیست.</p><button class="primary-button compact-button" type="button" data-action="new-project">' + svg("plus") + 'پروژه جدید</button></section><div class="segmented">' + segments + '</div><section class="section">' + content + "</section></div>";
}

function followupCard(task) {
  const waiting = task.waiting || {};
  const bucket = followupBucket(task, todayISO());
  const bucketLabel = bucket === "overdue" ? "عقب‌افتاده" : bucket === "today" ? "پیگیری امروز" : "آینده";
  const bucketClass = bucket === "overdue" ? "danger" : bucket === "today" ? "waiting" : "";
  const dates = [];
  if (waiting.expectedDue) dates.push("موعد توافقی: " + formatFaDate(waiting.expectedDue));
  if (waiting.nextFollowup) dates.push("پیگیری بعدی: " + formatFaDate(waiting.nextFollowup));
  return '<article class="card"><div class="card-top"><div class="card-title"><button class="title-button" type="button" data-action="task-details" data-id="' + escapeHtml(task.id) + '"><h3>' + escapeHtml(task.title) + '</h3></button><p>' + escapeHtml(domainName(state, task.domainId)) + '</p></div><span class="status-pill ' + bucketClass + '">' + bucketLabel + '</span></div><p class="card-note"><strong>منتظر از: </strong>' + escapeHtml(waiting.person || "مشخص نشده") + '<br><strong>خروجی دقیق: </strong>' + escapeHtml(waiting.expectedOutput || "مشخص نشده") + '</p>' + (waiting.latestResponse ? '<p class="card-note"><strong>آخرین پاسخ: </strong>' + escapeHtml(waiting.latestResponse) + "</p>" : "") + '<div class="card-meta">' + dates.map(function (item) { return '<span class="meta-item">' + escapeHtml(item) + "</span>"; }).join("") + '</div><div class="card-actions"><button class="primary-button" type="button" data-action="followup-update" data-id="' + escapeHtml(task.id) + '">ثبت پاسخ</button><button class="secondary-button" type="button" data-action="verify-delivery" data-id="' + escapeHtml(task.id) + '">تحویل رسید؛ بررسی</button>' + attachmentButton(task, "task") + "</div></article>";
}

function renderFollowups() {
  const waiting = selectWaitingTasks(state);
  const counts = { overdue: 0, today: 0, future: 0 };
  waiting.forEach(function (task) { counts[followupBucket(task, todayISO())] += 1; });
  let filtered = waiting.filter(function (task) {
    const bucket = followupBucket(task, todayISO());
    if (followupFilter === "due") return bucket === "overdue" || bucket === "today";
    return bucket === followupFilter;
  });
  filtered.sort(function (a, b) {
    const order = { overdue: 1, today: 2, future: 3 };
    const difference = order[followupBucket(a, todayISO())] - order[followupBucket(b, todayISO())];
    if (difference) return difference;
    return String(a.waiting.nextFollowup || "9999-99-99").localeCompare(String(b.waiting.nextFollowup || "9999-99-99"));
  });
  const segments = [
    ["due", "نیازمند اقدام " + faNumber(counts.overdue + counts.today)],
    ["overdue", "عقب‌افتاده " + faNumber(counts.overdue)],
    ["today", "امروز " + faNumber(counts.today)],
    ["future", "آینده " + faNumber(counts.future)]
  ].map(function (item) {
    return '<button class="segment ' + (followupFilter === item[0] ? "is-active" : "") + '" type="button" data-action="followup-filter" data-filter="' + item[0] + '">' + item[1] + "</button>";
  }).join("");
  const content = filtered.length ? filtered.map(followupCard).join("") : emptyCard("پیگیری‌ای در این بخش نیست", "هر کار را که به دیگری واگذار شد با نام فرد، خروجی دقیق و تاریخ پیگیری روی حالت «منتظر» بگذار.", null, null);
  return '<div class="page-stack"><div class="notice"><span>' + svg("clock") + '</span><p><strong>تحویل، مساوی انجام‌شدن نیست</strong>بعد از دریافت خروجی، آن را بررسی کن؛ فقط پس از تأیید نتیجه، کار بسته می‌شود.</p></div><div class="segmented">' + segments + '</div><section class="section">' + content + "</section></div>";
}

function resultListItem(task) {
  const selectedCount = selectWeeklyResults(state, todayISO()).filter(function (item) { return item.result.includeInReport; }).length;
  const selected = Boolean(task.result && task.result.includeInReport);
  return '<div class="list-row"><div class="list-row-copy"><strong>' + escapeHtml(task.result.outcome) + '</strong><span>' + escapeHtml(projectName(state, task.projectId)) + " · " + escapeHtml(timestampLabel(task.completedAt)) + '</span></div><button class="' + (selected ? "primary-button" : "ghost-button") + ' compact-button" type="button" data-action="toggle-report-result" data-id="' + escapeHtml(task.id) + '" aria-pressed="' + String(selected) + '">' + (selected ? svg("check") + "در گزارش" : svg("plus") + (selectedCount >= 5 ? "سقف ۵" : "افزودن")) + "</button></div>";
}

function renderDailyReview() {
  const today = todayISO();
  const completed = state.tasks.filter(function (task) { return task.status === STATUSES.DONE && task.completedAt && localISO(new Date(task.completedAt)) === today; });
  const openFocus = selectFocusTasks(state, today).filter(isTaskOpen);
  const resultCount = completed.filter(function (task) { return task.result && task.result.outcome; }).length;
  return '<div class="metric-grid"><div class="metric-card"><p class="metric-label">کارهای بسته‌شده</p><p class="metric-value">' + faNumber(completed.length) + '</p></div><div class="metric-card"><p class="metric-label">نتیجه‌های ثبت‌شده</p><p class="metric-value">' + faNumber(resultCount) + '</p></div><div class="metric-card"><p class="metric-label">تمرکز باز</p><p class="metric-value">' + faNumber(openFocus.length) + '</p></div><div class="metric-card"><p class="metric-label">ورودی تعیین‌تکلیف‌نشده</p><p class="metric-value">' + faNumber(state.inbox.length) + '</p></div></div><section class="card"><div class="card-top"><div class="card-title"><h3>پایان روز</h3><p>نتیجه‌ها و تکلیف کارهای ناتمام را ببند.</p></div>' + svg("review") + '</div><div class="card-actions"><button class="primary-button full-button" type="button" data-action="end-day">شروع مرور پایان روز</button></div></section>';
}

function renderWeeklyReview() {
  const results = selectWeeklyResults(state, todayISO());
  const doneTasks = state.tasks.filter(function (task) {
    if (task.status !== STATUSES.DONE || !task.completedAt) return false;
    const date = localISO(new Date(task.completedAt));
    return date >= addDaysISO(todayISO(), -6) && date <= todayISO();
  });
  const atRisk = state.projects.filter(function (project) { return isProjectAtRisk(project); });
  const focusProjects = state.projects.filter(function (project) { return project.weeklyFocus; });
  const resultHtml = results.length ? '<div class="list-stack">' + results.map(resultListItem).join("") + "</div>" : emptyCard("هنوز نتیجه‌ای ثبت نشده", "هنگام بستن کار، نتیجه قابل مشاهده را بنویس تا گزارش هفتگی خودکار ساخته شود.", null, null);
  return '<div class="metric-grid"><div class="metric-card"><p class="metric-label">کارهای انجام‌شده</p><p class="metric-value">' + faNumber(doneTasks.length) + '</p></div><div class="metric-card"><p class="metric-label">نتیجه‌های قابل گزارش</p><p class="metric-value">' + faNumber(results.length) + '</p></div><div class="metric-card"><p class="metric-label">پروژه‌های تمرکز</p><p class="metric-value">' + faNumber(focusProjects.length) + '/۳</p></div><div class="metric-card"><p class="metric-label">پروژه‌های در خطر توقف</p><p class="metric-value">' + faNumber(atRisk.length) + '</p></div></div><section class="section"><div class="section-heading"><div class="section-heading-copy"><h2>نتیجه‌های هفت روز اخیر</h2><p>حداکثر پنج مورد را برای گزارش مدیرعامل انتخاب کن.</p></div></div>' + resultHtml + "</section>";
}

function renderReport() {
  const results = selectWeeklyResults(state, todayISO()).filter(function (task) { return task.result.includeInReport; }).slice(0, 5);
  const focusProjects = state.projects.filter(function (project) { return project.weeklyFocus && project.status !== PROJECT_STATUSES.DONE && project.status !== PROJECT_STATUSES.CANCELLED; }).slice(0, 3);
  const blockers = state.projects.reduce(function (all, project) {
    if (!Array.isArray(project.blockers)) return all;
    project.blockers.filter(Boolean).forEach(function (blocker) { all.push(project.title + ": " + blocker); });
    return all;
  }, []).slice(0, 5);
  const resultItems = results.length ? results.map(function (task) { return "<li>" + escapeHtml(task.result.outcome) + (task.result.impact ? " — " + escapeHtml(task.result.impact) : "") + "</li>"; }).join("") : '<li class="report-empty">هنوز نتیجه‌ای برای گزارش انتخاب نشده است.</li>';
  const projectItems = focusProjects.length ? focusProjects.map(function (project) { const next = getProjectNextTask(project); return "<li><strong>" + escapeHtml(project.title) + ":</strong> " + escapeHtml(next ? next.title : "نیازمند تعیین اقدام بعدی") + "</li>"; }).join("") : '<li class="report-empty">پروژه تمرکز هفتگی انتخاب نشده است.</li>';
  const blockerItems = blockers.length ? blockers.map(function (blocker) { return "<li>" + escapeHtml(blocker) + "</li>"; }).join("") : '<li class="report-empty">مانع یا تصمیم موردنیازی ثبت نشده است.</li>';
  return '<section class="report-paper" id="weekly-report"><div class="report-head"><div><p class="eyebrow">گزارش یک‌صفحه‌ای</p><h2>خلاصه هفتگی عملکرد</h2></div><span class="tag">' + escapeHtml(formatFaDate(todayISO(), { year: "numeric", month: "long", day: "numeric" })) + '</span></div><div class="report-section"><h3>۱. نتایج مهم هفته</h3><ol class="report-list">' + resultItems + '</ol></div><div class="report-section"><h3>۲. تمرکز و اقدام بعدی هفته پیش‌رو</h3><ol class="report-list">' + projectItems + '</ol></div><div class="report-section"><h3>۳. موانع و تصمیم‌های موردنیاز</h3><ol class="report-list">' + blockerItems + '</ol></div></section><div class="button-row"><button class="primary-button" type="button" data-action="copy-report">کپی متن گزارش</button><button class="secondary-button" type="button" data-action="print-report">چاپ یا PDF</button></div>';
}

function renderReview() {
  const segments = [["daily", "مرور روزانه"], ["weekly", "مرور هفتگی"], ["report", "گزارش مدیرعامل"]].map(function (item) {
    return '<button class="segment ' + (reviewTab === item[0] ? "is-active" : "") + '" type="button" data-action="review-tab" data-filter="' + item[0] + '">' + item[1] + "</button>";
  }).join("");
  let content = renderDailyReview();
  if (reviewTab === "weekly") content = renderWeeklyReview();
  if (reviewTab === "report") content = renderReport();
  return '<div class="page-stack"><div class="segmented">' + segments + "</div>" + content + "</div>";
}

function openActionSheet(kicker, title, content) {
  dialogObjectUrls.forEach(function (url) { URL.revokeObjectURL(url); });
  dialogObjectUrls = [];
  actionKicker.textContent = kicker || "";
  actionTitle.textContent = title || "";
  actionContent.innerHTML = content || "";
  actionFooter.innerHTML = "";
  actionFooter.classList.add("is-hidden");
  if (!actionDialog.open) actionDialog.showModal();
  window.setTimeout(function () {
    const focusable = actionContent.querySelector("[autofocus], input, textarea, select, button");
    if (focusable) focusable.focus({ preventScroll: true });
  }, 60);
}

function closeActionSheet() {
  dialogObjectUrls.forEach(function (url) { URL.revokeObjectURL(url); });
  dialogObjectUrls = [];
  if (actionDialog.open) actionDialog.close();
  actionContent.innerHTML = "";
}

function domainOptions(selectedId) {
  let result = '<option value="">بدون حوزه</option>';
  state.domains.forEach(function (domain) {
    result += '<option value="' + escapeHtml(domain.id) + '" ' + (domain.id === selectedId ? "selected" : "") + '>' + escapeHtml(domain.name) + "</option>";
  });
  return result;
}

function childOptions(domainId, selectedChild) {
  const domain = state.domains.find(function (item) { return item.id === domainId; });
  let result = '<option value="">بدون زیرشاخه</option>';
  if (domain && Array.isArray(domain.children)) {
    domain.children.forEach(function (child) {
      result += '<option value="' + escapeHtml(child) + '" ' + (child === selectedChild ? "selected" : "") + '>' + escapeHtml(child) + "</option>";
    });
  }
  return result;
}

function projectOptions(selectedId, includeEmpty) {
  let result = includeEmpty === false ? "" : '<option value="">بدون پروژه</option>';
  state.projects.filter(function (project) {
    return project.status !== PROJECT_STATUSES.DONE && project.status !== PROJECT_STATUSES.CANCELLED;
  }).forEach(function (project) {
    result += '<option value="' + escapeHtml(project.id) + '" ' + (project.id === selectedId ? "selected" : "") + '>' + escapeHtml(project.title) + "</option>";
  });
  return result;
}

function statusOptions(selectedStatus) {
  return [STATUSES.READY, STATUSES.DOING, STATUSES.CANCELLED].map(function (status) {
    return '<option value="' + status + '" ' + (status === selectedStatus ? "selected" : "") + '>' + escapeHtml(statusLabels[status]) + "</option>";
  }).join("");
}

function projectStatusOptions(selectedStatus) {
  return [PROJECT_STATUSES.PLANNED, PROJECT_STATUSES.ACTIVE, PROJECT_STATUSES.WAITING, PROJECT_STATUSES.PAUSED, PROJECT_STATUSES.DONE, PROJECT_STATUSES.CANCELLED].map(function (status) {
    return '<option value="' + status + '" ' + (status === selectedStatus ? "selected" : "") + '>' + escapeHtml(statusLabels[status]) + "</option>";
  }).join("");
}

function refreshChildSelect(domainSelect, childSelect, selectedChild) {
  if (!domainSelect || !childSelect) return;
  childSelect.innerHTML = childOptions(domainSelect.value, selectedChild || "");
}

function makeAttachment(file, customName) {
  return {
    id: createId("attachment"),
    name: customName || file.name || "پیوست",
    type: file.type || "application/octet-stream",
    size: file.size || 0,
    createdAt: nowStamp(),
    blob: file
  };
}

function renderCaptureAttachments() {
  const container = document.querySelector("#capture-attachments");
  if (!container) return;
  container.innerHTML = pendingAttachments.map(function (attachment) {
    return '<span class="attachment-chip">' + svg(attachment.type.indexOf("audio/") === 0 ? "mic" : attachment.type.indexOf("image/") === 0 ? "camera" : "clip") + '<span>' + escapeHtml(attachment.name) + '</span><button type="button" aria-label="حذف پیوست" data-remove-attachment="' + escapeHtml(attachment.id) + '">' + svg("close") + "</button></span>";
  }).join("");
}

function resetCaptureForm() {
  document.querySelector("#capture-title").value = "";
  document.querySelector("#capture-details").value = "";
  document.querySelector("#photo-input").value = "";
  document.querySelector("#file-input").value = "";
  pendingAttachments = [];
  renderCaptureAttachments();
  stopRecording(true);
}

function openCapture() {
  resetCaptureForm();
  captureDialog.showModal();
  window.setTimeout(function () { document.querySelector("#capture-title").focus(); }, 80);
}

async function addCaptureFiles(fileList) {
  Array.from(fileList || []).forEach(function (file) {
    pendingAttachments.push(makeAttachment(file));
  });
  renderCaptureAttachments();
}

async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    stopRecording(false);
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
    showToast("ضبط مستقیم در این مرورگر در دسترس نیست؛ از گزینه فایل استفاده کن.");
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    discardCurrentRecording = false;
    const chunks = [];
    mediaRecorder = new MediaRecorder(recordingStream);
    mediaRecorder.addEventListener("dataavailable", function (event) {
      if (event.data && event.data.size) chunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", function () {
      if (chunks.length && !discardCurrentRecording) {
        const type = mediaRecorder.mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: type });
        const name = "صدای ثبت‌شده " + new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" }).format(new Date()) + ".webm";
        pendingAttachments.push(makeAttachment(blob, name));
        renderCaptureAttachments();
      }
      if (recordingStream) recordingStream.getTracks().forEach(function (track) { track.stop(); });
      recordingStream = null;
      mediaRecorder = null;
    });
    mediaRecorder.start();
    recordingStartedAt = Date.now();
    const voiceButton = document.querySelector("#voice-button");
    const status = document.querySelector("#recording-status");
    voiceButton.classList.add("is-recording");
    voiceButton.querySelector("span").textContent = "توقف ضبط";
    status.classList.remove("is-hidden");
    recordingTimer = window.setInterval(function () {
      const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
      status.textContent = "در حال ضبط… " + faNumber(Math.floor(seconds / 60)) + ":" + faNumber(String(seconds % 60).padStart(2, "0"));
    }, 500);
  } catch (error) {
    console.error(error);
    showToast("اجازه میکروفن داده نشد. می‌توانی فایل صوتی پیوست کنی.");
  }
}

function stopRecording(discard) {
  window.clearInterval(recordingTimer);
  recordingTimer = null;
  const voiceButton = document.querySelector("#voice-button");
  const status = document.querySelector("#recording-status");
  if (voiceButton) {
    voiceButton.classList.remove("is-recording");
    const label = voiceButton.querySelector("span");
    if (label) label.textContent = "ضبط صدا";
  }
  if (status) status.classList.add("is-hidden");
  if (mediaRecorder && mediaRecorder.state === "recording") {
    discardCurrentRecording = Boolean(discard);
    mediaRecorder.stop();
  } else if (recordingStream) {
    recordingStream.getTracks().forEach(function (track) { track.stop(); });
    recordingStream = null;
  }
}

async function saveCapture() {
  const title = document.querySelector("#capture-title").value.trim();
  if (!title) {
    document.querySelector("#capture-title").focus();
    showToast("فقط یک عنوان کوتاه لازم است.");
    return;
  }
  if (mediaRecorder && mediaRecorder.state === "recording") {
    showToast("اول ضبط صدا را متوقف کن.");
    return;
  }
  state.inbox.push({
    id: createId("inbox"),
    title: title,
    details: document.querySelector("#capture-details").value.trim(),
    createdAt: nowStamp(),
    attachments: pendingAttachments.slice()
  });
  pendingAttachments = [];
  captureDialog.close();
  await persist();
  showToast("ثبت شد؛ فعلاً ذهنت آزاد باشد.");
}

function updateProcessFormVisibility() {
  const typeSelect = document.querySelector("#process-type");
  if (!typeSelect) return;
  const type = typeSelect.value;
  const taskFields = document.querySelector("#process-task-fields");
  const projectFields = document.querySelector("#process-project-fields");
  const routineFields = document.querySelector("#process-routine-fields");
  const projectChoice = document.querySelector("#process-project-choice");
  taskFields.classList.toggle("is-hidden", type !== "standalone_task" && type !== "project_action");
  projectFields.classList.toggle("is-hidden", type !== "new_project");
  routineFields.classList.toggle("is-hidden", type !== "recurring_task");
  projectChoice.classList.toggle("is-hidden", type !== "project_action");
}

function openProcessInbox(itemId) {
  const item = state.inbox.find(function (entry) { return entry.id === itemId; });
  if (!item) return;
  const content = '<form class="form-grid" id="process-form"><input type="hidden" name="itemId" value="' + escapeHtml(item.id) + '"><label class="field"><span>عنوان <b>ضروری</b></span><textarea name="title" rows="2" maxlength="240" required autofocus>' + escapeHtml(item.title) + '</textarea></label><label class="field"><span>توضیح <small>اختیاری</small></span><textarea name="details" rows="2" maxlength="1000">' + escapeHtml(item.details || "") + '</textarea></label><label class="field"><span>این مورد چیست؟ <b>ضروری</b></span><select name="type" id="process-type"><option value="standalone_task">کار مستقل</option><option value="project_action">اقدام یک پروژه</option><option value="new_project">پروژه جدید</option><option value="recurring_task">کار تکراری</option><option value="note">یادداشت یا مرجع</option><option value="delete">حذف؛ اقدامی ندارد</option></select></label>' +
    '<div class="conditional-group" id="process-task-fields"><label class="field is-hidden" id="process-project-choice"><span>پروژه <b>ضروری</b></span><select name="projectId">' + projectOptions("", false) + '</select></label><div class="form-grid two"><label class="field"><span>حوزه</span><select name="domainId" id="process-domain">' + domainOptions("") + '</select></label><label class="field"><span>زیرشاخه</span><select name="domainChild" id="process-child">' + childOptions("", "") + '</select></label></div><label class="field"><span>مسئول اقدام</span><input name="owner" value="من" maxlength="80"></label><div class="form-grid two"><label class="field"><span>تاریخ اقدام</span><input name="actionDate" type="date" value="' + todayISO() + '"></label><label class="field"><span>مهلت نهایی</span><input name="deadline" type="date"></label></div><div class="form-grid two"><label class="field"><span>اولویت</span><select name="priority" id="process-priority"><option value="P2">P2 — مهم</option><option value="P1">P1 — بحرانی</option><option value="P3">P3 — قابل تعویق</option></select></label><label class="field"><span>زمان تقریبی؛ دقیقه</span><input name="estimateMinutes" type="number" min="0" max="1440" value="30"></label></div><label class="field is-hidden" id="process-p1-reason"><span>دلیل P1 <b>ضروری</b></span><input name="p1Reason" maxlength="200" placeholder="توقف تولید، ایمنی، الزام قانونی یا مهلت قطعی"></label><label class="check-field"><input name="dailyFocus" type="checkbox"><span>افزودن به سه تمرکز امروز</span></label></div>' +
    '<div class="conditional-group is-hidden" id="process-project-fields"><label class="field"><span>حوزه</span><select name="projectDomainId">' + domainOptions("") + '</select></label><label class="field"><span>خروجی نهایی پروژه <b>ضروری</b></span><textarea name="outcome" rows="2" placeholder="در پایان چه چیز قابل تحویلی وجود دارد؟"></textarea></label><label class="field"><span>تعریف انجام‌شدن</span><textarea name="doneDefinition" rows="2" placeholder="از کجا می‌فهمیم پروژه واقعاً تمام شده؟"></textarea></label><label class="field"><span>مهلت پروژه</span><input name="projectDeadline" type="date"></label></div>' +
    '<div class="conditional-group is-hidden" id="process-routine-fields"><label class="field"><span>حوزه</span><select name="routineDomainId">' + domainOptions("") + '</select></label><div class="form-grid two"><label class="field"><span>تکرار</span><select name="cadence" id="process-cadence"><option value="daily">هر روز</option><option value="weekly">هر هفته</option></select></label><label class="field is-hidden" id="process-weekday-field"><span>روز هفته</span><select name="weekday"><option value="6">شنبه</option><option value="0">یکشنبه</option><option value="1">دوشنبه</option><option value="2">سه‌شنبه</option><option value="3">چهارشنبه</option><option value="4">پنجشنبه</option><option value="5">جمعه</option></select></label></div><label class="field"><span>زمان تقریبی؛ دقیقه</span><input name="routineEstimate" type="number" min="1" value="15"></label></div>' +
    (attachmentCount(item) ? '<p class="form-hint">' + faNumber(attachmentCount(item)) + ' پیوست همراه این مورد منتقل می‌شود.</p>' : "") + '<button class="primary-button full-button" type="submit">ثبت و خروج از ورودی</button></form>';
  openActionSheet("تعیین تکلیف ورودی", "این مورد به کجا برود؟", content);
  updateProcessFormVisibility();
  const domainSelect = document.querySelector("#process-domain");
  const childSelect = document.querySelector("#process-child");
  domainSelect.addEventListener("change", function () { refreshChildSelect(domainSelect, childSelect, ""); });
  document.querySelector("#process-type").addEventListener("change", updateProcessFormVisibility);
  document.querySelector("#process-priority").addEventListener("change", function (event) {
    document.querySelector("#process-p1-reason").classList.toggle("is-hidden", event.target.value !== "P1");
  });
  document.querySelector("#process-cadence").addEventListener("change", function (event) {
    document.querySelector("#process-weekday-field").classList.toggle("is-hidden", event.target.value !== "weekly");
  });
  document.querySelector("#process-form").addEventListener("submit", handleProcessInbox);
}

async function handleProcessInbox(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const item = state.inbox.find(function (entry) { return entry.id === data.get("itemId"); });
  if (!item) return;
  const type = data.get("type");
  const title = String(data.get("title") || "").trim();
  if (!title) return;
  try {
    if (type === "delete") {
      if (!window.confirm("این مورد از ورودی حذف شود؟")) return;
    } else if (type === "new_project") {
      const outcome = String(data.get("outcome") || "").trim();
      if (!outcome) throw new Error("خروجی نهایی پروژه را مشخص کن.");
      state.projects.push({
        id: createId("project"), title: title, description: String(data.get("details") || "").trim(),
        domainId: data.get("projectDomainId") || null, outcome: outcome,
        doneDefinition: String(data.get("doneDefinition") || "").trim(), deadline: data.get("projectDeadline") || null,
        status: PROJECT_STATUSES.ACTIVE, weeklyFocus: false, stages: [], blockers: [], nextActionTaskId: null,
        createdAt: nowStamp(), updatedAt: nowStamp(), lastActivityAt: nowStamp(), attachments: item.attachments || []
      });
    } else if (type === "recurring_task") {
      const routine = {
        id: createId("routine"), title: title, details: String(data.get("details") || "").trim(),
        cadence: data.get("cadence"), weekday: data.get("cadence") === "weekly" ? Number(data.get("weekday")) : null,
        estimateMinutes: Number(data.get("routineEstimate") || 15), priority: PRIORITIES.P2,
        domainId: data.get("routineDomainId") || null, active: true, attachments: item.attachments || []
      };
      state.routines.push(routine);
      materializeRoutineTasks(state, todayISO());
    } else if (type === "note") {
      state.notes.push({ id: createId("note"), title: title, content: String(data.get("details") || "").trim(), createdAt: nowStamp(), updatedAt: nowStamp(), attachments: item.attachments || [] });
    } else {
      const projectId = type === "project_action" ? data.get("projectId") : (data.get("projectId") || null);
      if (type === "project_action" && !projectId) throw new Error("پروژه این اقدام را انتخاب کن.");
      const priority = data.get("priority") || PRIORITIES.P2;
      const p1Reason = String(data.get("p1Reason") || "").trim();
      if (priority === PRIORITIES.P1 && !p1Reason) throw new Error("برای P1 دلیل روشن ثبت کن.");
      const task = {
        id: createId("task"), title: title, details: String(data.get("details") || "").trim(), type: type,
        domainId: data.get("domainId") || null, domainChild: data.get("domainChild") || "", projectId: projectId || null,
        owner: String(data.get("owner") || "من").trim() || "من", status: STATUSES.READY, priority: priority,
        p1Reason: p1Reason, estimateMinutes: Number(data.get("estimateMinutes") || 0), actionDate: data.get("actionDate") || todayISO(),
        deadline: data.get("deadline") || null, dailyFocus: false, focusDate: null, createdAt: nowStamp(), updatedAt: nowStamp(),
        completedAt: null, waiting: null, result: null, attachments: item.attachments || []
      };
      state.tasks.push(task);
      if (data.get("dailyFocus") === "on") setTaskDailyFocus(state, task.id, true, todayISO());
      if (projectId) {
        const project = state.projects.find(function (entry) { return entry.id === projectId; });
        if (project) {
          project.nextActionTaskId = task.id;
          project.lastActivityAt = nowStamp();
          project.updatedAt = nowStamp();
        }
      }
    }
    state.inbox = state.inbox.filter(function (entry) { return entry.id !== item.id; });
    closeActionSheet();
    await persist();
    showToast("تعیین تکلیف شد و از ورودی خارج شد.");
  } catch (error) {
    showToast(error.message || "ثبت انجام نشد.");
  }
}

function openNewProject(projectId) {
  const project = projectId ? state.projects.find(function (item) { return item.id === projectId; }) : null;
  const isEdit = Boolean(project);
  const content = '<form class="form-grid" id="project-form"><input type="hidden" name="projectId" value="' + escapeHtml(project ? project.id : "") + '"><label class="field"><span>نام پروژه <b>ضروری</b></span><input name="title" maxlength="200" required autofocus value="' + escapeHtml(project ? project.title : "") + '" placeholder="مثلاً: راه‌اندازی خط بسته‌بندی باشگاهی"></label><label class="field"><span>حوزه</span><select name="domainId">' + domainOptions(project ? project.domainId : "") + '</select></label><label class="field"><span>خروجی نهایی <b>ضروری</b></span><textarea name="outcome" rows="2" required placeholder="در پایان چه چیز قابل تحویلی وجود دارد؟">' + escapeHtml(project ? project.outcome : "") + '</textarea></label><label class="field"><span>تعریف انجام‌شدن</span><textarea name="doneDefinition" rows="2" placeholder="چه شواهدی ثابت می‌کند تمام شده؟">' + escapeHtml(project ? project.doneDefinition : "") + '</textarea></label><div class="form-grid two"><label class="field"><span>مهلت</span><input name="deadline" type="date" value="' + escapeHtml(project ? project.deadline || "" : "") + '"></label><label class="field"><span>وضعیت</span><select name="status">' + projectStatusOptions(project ? project.status : PROJECT_STATUSES.ACTIVE) + '</select></label></div><label class="field"><span>مراحل <small>هر مرحله در یک خط</small></span><textarea name="stages" rows="4" placeholder="طراحی فرایند&#10;انتخاب ماشین&#10;نصب و راه‌اندازی">' + escapeHtml(project && Array.isArray(project.stages) ? project.stages.join("\n") : "") + '</textarea></label><label class="field"><span>موانع یا تصمیم‌های موردنیاز <small>هر مورد در یک خط</small></span><textarea name="blockers" rows="3">' + escapeHtml(project && Array.isArray(project.blockers) ? project.blockers.join("\n") : "") + '</textarea></label><label class="field"><span>توضیحات</span><textarea name="description" rows="3">' + escapeHtml(project ? project.description || "" : "") + '</textarea></label>' + (project && attachmentCount(project) ? '<button class="ghost-button" type="button" data-action="attachments" data-kind="project" data-id="' + escapeHtml(project.id) + '">' + svg("clip") + faNumber(attachmentCount(project)) + " پیوست پروژه</button>" : "") + '<button class="primary-button full-button" type="submit">' + (isEdit ? "ذخیره تغییرات" : "ساخت پروژه") + "</button></form>";
  openActionSheet(isEdit ? "ویرایش پروژه" : "پروژه تازه", isEdit ? project.title : "تعریف پروژه", content);
  document.querySelector("#project-form").addEventListener("submit", saveProjectForm);
}

async function saveProjectForm(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const projectId = data.get("projectId");
  let project = projectId ? state.projects.find(function (item) { return item.id === projectId; }) : null;
  const wasNew = !project;
  if (!project) {
    project = { id: createId("project"), createdAt: nowStamp(), nextActionTaskId: null, weeklyFocus: false, attachments: [] };
    state.projects.push(project);
  }
  project.title = String(data.get("title") || "").trim();
  project.domainId = data.get("domainId") || null;
  project.outcome = String(data.get("outcome") || "").trim();
  project.doneDefinition = String(data.get("doneDefinition") || "").trim();
  project.deadline = data.get("deadline") || null;
  project.status = data.get("status") || PROJECT_STATUSES.ACTIVE;
  project.stages = String(data.get("stages") || "").split(/\r?\n/).map(function (item) { return item.trim(); }).filter(Boolean);
  project.blockers = String(data.get("blockers") || "").split(/\r?\n/).map(function (item) { return item.trim(); }).filter(Boolean);
  project.description = String(data.get("description") || "").trim();
  project.updatedAt = nowStamp();
  project.lastActivityAt = project.lastActivityAt || nowStamp();
  if (project.status === PROJECT_STATUSES.DONE || project.status === PROJECT_STATUSES.CANCELLED) project.weeklyFocus = false;
  closeActionSheet();
  await persist();
  showToast(wasNew ? "پروژه ساخته شد؛ حالا اقدام بعدی آن را تعیین کن." : "پروژه به‌روزرسانی شد.");
  if (wasNew) openProjectAction(project.id);
}

function openProjectAction(projectId) {
  const project = state.projects.find(function (item) { return item.id === projectId; });
  if (!project) return;
  const currentNext = getProjectNextTask(project);
  const currentNotice = currentNext ? '<div class="notice warning"><span>' + svg("warning") + '</span><p><strong>اقدام بعدی فعلی</strong>' + escapeHtml(currentNext.title) + '؛ اقدام تازه جای نشانگر «اقدام بعدی» را می‌گیرد، اما کار قبلی حذف نمی‌شود.</p></div>' : "";
  const content = '<form class="form-grid" id="project-action-form"><input type="hidden" name="projectId" value="' + escapeHtml(project.id) + '">' + currentNotice + '<label class="field"><span>اقدام بعدی روشن <b>ضروری</b></span><textarea name="title" rows="2" maxlength="240" required autofocus placeholder="فعل + خروجی؛ مثلاً دریافت پیش‌فاکتور نهایی میکسر"></textarea></label><label class="field"><span>توضیح</span><textarea name="details" rows="2"></textarea></label><div class="form-grid two"><label class="field"><span>مسئول</span><input name="owner" value="من" maxlength="80"></label><label class="field"><span>اولویت</span><select name="priority" id="action-priority"><option value="P2">P2 — مهم</option><option value="P1">P1 — بحرانی</option><option value="P3">P3 — قابل تعویق</option></select></label></div><label class="field is-hidden" id="action-p1-reason"><span>دلیل P1 <b>ضروری</b></span><input name="p1Reason" maxlength="200"></label><div class="form-grid two"><label class="field"><span>تاریخ اقدام</span><input name="actionDate" type="date" value="' + todayISO() + '"></label><label class="field"><span>مهلت</span><input name="deadline" type="date"></label></div><label class="field"><span>زمان تقریبی؛ دقیقه</span><input name="estimateMinutes" type="number" min="0" value="30"></label><label class="check-field"><input name="dailyFocus" type="checkbox"><span>افزودن به سه تمرکز امروز</span></label><button class="primary-button full-button" type="submit">ثبت به‌عنوان اقدام بعدی</button></form>';
  openActionSheet("پروژه: " + project.title, "تعریف اقدام بعدی", content);
  document.querySelector("#action-priority").addEventListener("change", function (event) {
    document.querySelector("#action-p1-reason").classList.toggle("is-hidden", event.target.value !== "P1");
  });
  document.querySelector("#project-action-form").addEventListener("submit", saveProjectAction);
}

async function saveProjectAction(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const project = state.projects.find(function (item) { return item.id === data.get("projectId"); });
  if (!project) return;
  const priority = data.get("priority") || PRIORITIES.P2;
  const p1Reason = String(data.get("p1Reason") || "").trim();
  if (priority === PRIORITIES.P1 && !p1Reason) {
    showToast("برای P1 دلیل روشن ثبت کن.");
    return;
  }
  const task = {
    id: createId("task"), title: String(data.get("title") || "").trim(), details: String(data.get("details") || "").trim(),
    type: "project_action", domainId: project.domainId || null, domainChild: "", projectId: project.id,
    owner: String(data.get("owner") || "من").trim() || "من", status: STATUSES.READY, priority: priority, p1Reason: p1Reason,
    estimateMinutes: Number(data.get("estimateMinutes") || 0), actionDate: data.get("actionDate") || todayISO(), deadline: data.get("deadline") || null,
    dailyFocus: false, focusDate: null, createdAt: nowStamp(), updatedAt: nowStamp(), completedAt: null,
    waiting: null, result: null, attachments: []
  };
  state.tasks.push(task);
  try {
    if (data.get("dailyFocus") === "on") setTaskDailyFocus(state, task.id, true, todayISO());
  } catch (error) {
    state.tasks = state.tasks.filter(function (item) { return item.id !== task.id; });
    showToast(error.message);
    return;
  }
  project.nextActionTaskId = task.id;
  project.lastActivityAt = nowStamp();
  project.updatedAt = nowStamp();
  closeActionSheet();
  await persist();
  showToast("اقدام بعدی پروژه ثبت شد.");
}

function openTaskDetails(taskId) {
  const task = state.tasks.find(function (item) { return item.id === taskId; });
  if (!task) return;
  let waiting = "";
  if (task.waiting) {
    waiting = '<div class="conditional-group"><p class="eyebrow">اطلاعات پیگیری</p><p><strong>منتظر از:</strong> ' + escapeHtml(task.waiting.person || "—") + '<br><strong>خروجی:</strong> ' + escapeHtml(task.waiting.expectedOutput || "—") + '<br><strong>موعد توافقی:</strong> ' + escapeHtml(task.waiting.expectedDue ? formatFaDate(task.waiting.expectedDue) : "ثبت نشده") + '<br><strong>پیگیری بعدی:</strong> ' + escapeHtml(task.waiting.nextFollowup ? formatFaDate(task.waiting.nextFollowup) : "ثبت نشده") + "</p></div>";
  }
  let result = "";
  if (task.result) {
    result = '<div class="conditional-group"><p class="eyebrow">نتیجه ثبت‌شده</p><p><strong>خروجی:</strong> ' + escapeHtml(task.result.outcome || "—") + (task.result.impact ? '<br><strong>اثر:</strong> ' + escapeHtml(task.result.impact) : "") + (task.result.evidence ? '<br><strong>شاهد:</strong> ' + escapeHtml(task.result.evidence) : "") + "</p></div>";
  }
  const details = task.details ? '<p class="card-note">' + escapeHtml(task.details) + "</p>" : "";
  let buttons = "";
  if (task.status === STATUSES.WAITING) {
    buttons = '<button class="primary-button" type="button" data-action="followup-update" data-id="' + escapeHtml(task.id) + '">ثبت پاسخ</button><button class="secondary-button" type="button" data-action="verify-delivery" data-id="' + escapeHtml(task.id) + '">بررسی تحویل</button>';
  } else if (task.status !== STATUSES.DONE && task.status !== STATUSES.CANCELLED) {
    buttons = '<button class="primary-button" type="button" data-action="complete-task" data-id="' + escapeHtml(task.id) + '">انجام شد</button><button class="secondary-button" type="button" data-action="edit-task" data-id="' + escapeHtml(task.id) + '">ویرایش</button>';
  }
  buttons += attachmentButton(task, "task");
  const content = '<div class="form-grid"><div><div class="button-row">' + priorityPill(task.priority) + statusPill(task.status) + '</div><div class="card-meta">' + taskMeta(task) + "</div>" + details + '</div>' + waiting + result + '<div class="button-row">' + buttons + "</div></div>";
  openActionSheet(task.projectId ? projectName(state, task.projectId) : domainName(state, task.domainId), task.title, content);
}

function openTaskEdit(taskId) {
  const task = state.tasks.find(function (item) { return item.id === taskId; });
  if (!task) return;
  const content = '<form class="form-grid" id="task-edit-form"><input type="hidden" name="taskId" value="' + escapeHtml(task.id) + '"><label class="field"><span>عنوان <b>ضروری</b></span><textarea name="title" rows="2" required autofocus>' + escapeHtml(task.title) + '</textarea></label><label class="field"><span>توضیح</span><textarea name="details" rows="2">' + escapeHtml(task.details || "") + '</textarea></label><div class="form-grid two"><label class="field"><span>حوزه</span><select name="domainId" id="edit-task-domain">' + domainOptions(task.domainId) + '</select></label><label class="field"><span>زیرشاخه</span><select name="domainChild" id="edit-task-child">' + childOptions(task.domainId, task.domainChild) + '</select></label></div><label class="field"><span>پروژه</span><select name="projectId">' + projectOptions(task.projectId, true) + '</select></label><div class="form-grid two"><label class="field"><span>مسئول</span><input name="owner" value="' + escapeHtml(task.owner || "من") + '"></label><label class="field"><span>وضعیت</span><select name="status">' + statusOptions(task.status) + '</select></label></div><div class="form-grid two"><label class="field"><span>تاریخ اقدام</span><input name="actionDate" type="date" value="' + escapeHtml(task.actionDate || "") + '"></label><label class="field"><span>مهلت</span><input name="deadline" type="date" value="' + escapeHtml(task.deadline || "") + '"></label></div><div class="form-grid two"><label class="field"><span>اولویت</span><select name="priority"><option value="P1" ' + (task.priority === "P1" ? "selected" : "") + '>P1</option><option value="P2" ' + (task.priority === "P2" ? "selected" : "") + '>P2</option><option value="P3" ' + (task.priority === "P3" ? "selected" : "") + '>P3</option></select></label><label class="field"><span>زمان؛ دقیقه</span><input name="estimateMinutes" type="number" min="0" value="' + escapeHtml(task.estimateMinutes || 0) + '"></label></div><label class="field"><span>دلیل P1 <small>برای اولویت بحرانی ضروری است</small></span><input name="p1Reason" maxlength="200" value="' + escapeHtml(task.p1Reason || "") + '" placeholder="توقف تولید، ایمنی، الزام قانونی یا مهلت قطعی"></label><button class="primary-button full-button" type="submit">ذخیره تغییرات</button></form>';
  openActionSheet("ویرایش کار", task.title, content);
  const domainSelect = document.querySelector("#edit-task-domain");
  const childSelect = document.querySelector("#edit-task-child");
  domainSelect.addEventListener("change", function () { refreshChildSelect(domainSelect, childSelect, ""); });
  document.querySelector("#task-edit-form").addEventListener("submit", saveTaskEdit);
}

async function saveTaskEdit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const task = state.tasks.find(function (item) { return item.id === data.get("taskId"); });
  if (!task) return;
  const nextPriority = data.get("priority") || PRIORITIES.P2;
  const nextP1Reason = String(data.get("p1Reason") || "").trim();
  if (nextPriority === PRIORITIES.P1 && !nextP1Reason) {
    showToast("برای P1 دلیل روشن ثبت کن.");
    return;
  }
  const oldProjectId = task.projectId;
  task.title = String(data.get("title") || "").trim();
  task.details = String(data.get("details") || "").trim();
  task.domainId = data.get("domainId") || null;
  task.domainChild = data.get("domainChild") || "";
  task.projectId = data.get("projectId") || null;
  task.owner = String(data.get("owner") || "من").trim() || "من";
  task.status = data.get("status") || STATUSES.READY;
  task.actionDate = data.get("actionDate") || null;
  task.deadline = data.get("deadline") || null;
  task.priority = nextPriority;
  task.p1Reason = nextP1Reason;
  task.estimateMinutes = Number(data.get("estimateMinutes") || 0);
  task.updatedAt = nowStamp();
  if (task.status === STATUSES.CANCELLED) {
    task.dailyFocus = false;
    [oldProjectId, task.projectId].filter(Boolean).forEach(function (projectId) {
      const project = state.projects.find(function (item) { return item.id === projectId; });
      if (project && project.nextActionTaskId === task.id) project.nextActionTaskId = null;
    });
  }
  closeActionSheet();
  await persist();
  showToast("تغییرات کار ذخیره شد.");
}

function openProjectDetails(projectId) {
  const project = state.projects.find(function (item) { return item.id === projectId; });
  if (!project) return;
  const tasks = state.tasks.filter(function (task) { return task.projectId === project.id; }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  const stages = Array.isArray(project.stages) && project.stages.length ? '<ol class="report-list">' + project.stages.map(function (stage) { return "<li>" + escapeHtml(stage) + "</li>"; }).join("") + "</ol>" : '<p class="report-empty">مرحله‌ای ثبت نشده است.</p>';
  const blockers = Array.isArray(project.blockers) && project.blockers.length ? '<ul class="report-list">' + project.blockers.map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("") + "</ul>" : '<p class="report-empty">مانعی ثبت نشده است.</p>';
  const taskList = tasks.length ? '<div class="list-stack">' + tasks.map(function (task) { return '<button class="list-row title-button" type="button" data-action="task-details" data-id="' + escapeHtml(task.id) + '"><span class="list-row-copy"><strong>' + escapeHtml(task.title) + '</strong><span>' + escapeHtml(statusLabels[task.status]) + " · " + escapeHtml(dueText(task.deadline || task.actionDate)) + '</span></span><span>' + svg("chevron") + "</span></button>"; }).join("") + "</div>" : '<p class="report-empty">هنوز اقدامی برای این پروژه ثبت نشده است.</p>';
  const content = '<div class="form-grid"><div class="button-row">' + statusPill(project.status) + (project.weeklyFocus ? '<span class="status-pill done">تمرکز هفته</span>' : "") + '</div><div class="conditional-group"><p class="eyebrow">خروجی نهایی</p><p>' + escapeHtml(project.outcome || "تعریف نشده") + '</p><p class="eyebrow">تعریف انجام‌شدن</p><p>' + escapeHtml(project.doneDefinition || "تعریف نشده") + '</p></div><div><h3>مراحل</h3>' + stages + '</div><div><h3>موانع</h3>' + blockers + '</div><div><h3>اقدام‌ها</h3>' + taskList + '</div><div class="button-row"><button class="primary-button" type="button" data-action="project-action" data-id="' + escapeHtml(project.id) + '">اقدام بعدی</button><button class="secondary-button" type="button" data-action="edit-project" data-id="' + escapeHtml(project.id) + '">ویرایش پروژه</button>' + attachmentButton(project, "project") + "</div></div>";
  openActionSheet(domainName(state, project.domainId), project.title, content);
}

function openWaitingForm(taskId) {
  const task = state.tasks.find(function (item) { return item.id === taskId; });
  if (!task) return;
  const waiting = task.waiting || {};
  const content = '<form class="form-grid" id="waiting-form"><input type="hidden" name="taskId" value="' + escapeHtml(task.id) + '"><div class="notice"><span>' + svg("clock") + '</span><p><strong>انتظار مبهم ممنوع</strong>نام فرد، خروجی دقیق و تاریخ پیگیری بعدی را ثبت کن.</p></div><label class="field"><span>منتظر از چه کسی یا سازمانی؟ <b>ضروری</b></span><input name="person" required autofocus maxlength="120" value="' + escapeHtml(waiting.person || "") + '" placeholder="نام فرد، واحد یا تأمین‌کننده"></label><label class="field"><span>دقیقاً منتظر چه خروجی هستی؟ <b>ضروری</b></span><textarea name="expectedOutput" rows="2" required maxlength="500" placeholder="مثلاً: پیش‌فاکتور نهایی با زمان تحویل">' + escapeHtml(waiting.expectedOutput || "") + '</textarea></label><div class="form-grid two"><label class="field"><span>موعد توافقی <small>اگر دارد</small></span><input name="expectedDue" type="date" value="' + escapeHtml(waiting.expectedDue || "") + '"></label><label class="field"><span>پیگیری بعدی <b>ضروری</b></span><input name="nextFollowup" type="date" required value="' + escapeHtml(waiting.nextFollowup || addDaysISO(todayISO(), 1)) + '"></label></div><label class="field"><span>آخرین پاسخ یا وضعیت</span><textarea name="latestResponse" rows="2">' + escapeHtml(waiting.latestResponse || "") + '</textarea></label><button class="primary-button full-button" type="submit">انتقال به پیگیری‌ها</button></form>';
  openActionSheet("تبدیل کار به پیگیری", task.title, content);
  document.querySelector("#waiting-form").addEventListener("submit", saveWaitingForm);
}

async function saveWaitingForm(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const task = state.tasks.find(function (item) { return item.id === data.get("taskId"); });
  if (!task) return;
  const oldHistory = task.waiting && Array.isArray(task.waiting.history) ? task.waiting.history : [];
  const latestResponse = String(data.get("latestResponse") || "").trim();
  task.waiting = {
    person: String(data.get("person") || "").trim(),
    expectedOutput: String(data.get("expectedOutput") || "").trim(),
    expectedDue: data.get("expectedDue") || null,
    nextFollowup: data.get("nextFollowup") || todayISO(),
    latestResponse: latestResponse,
    updatedAt: nowStamp(),
    history: oldHistory.concat(latestResponse ? [{ at: nowStamp(), text: latestResponse }] : [])
  };
  task.status = STATUSES.WAITING;
  task.updatedAt = nowStamp();
  if (task.projectId) {
    const project = state.projects.find(function (item) { return item.id === task.projectId; });
    if (project) {
      if (project.nextActionTaskId === task.id) project.nextActionTaskId = null;
      project.lastActivityAt = nowStamp();
      project.updatedAt = nowStamp();
    }
  }
  closeActionSheet();
  await persist();
  showToast("به پیگیری‌ها رفت؛ اگر پروژه دارد، اقدام بعدی تازه تعریف کن.");
}

function openCompleteForm(taskId) {
  const task = state.tasks.find(function (item) { return item.id === taskId; });
  if (!task) return;
  const selectedCount = selectWeeklyResults(state, todayISO()).filter(function (item) { return item.result.includeInReport; }).length;
  const content = '<form class="form-grid" id="complete-form"><input type="hidden" name="taskId" value="' + escapeHtml(task.id) + '"><div class="notice"><span>' + svg("check") + '</span><p><strong>کار را با نتیجه ببند</strong>به‌جای «انجام شد»، بنویس چه خروجی قابل مشاهده‌ای ایجاد شد.</p></div><label class="field"><span>نتیجه یا خروجی واقعی <b>ضروری</b></span><textarea name="outcome" rows="3" required autofocus maxlength="700" placeholder="مثلاً: پیش‌فاکتور سه تأمین‌کننده دریافت و مقایسه شد"></textarea></label><label class="field"><span>اثر این نتیجه <small>اختیاری</small></span><textarea name="impact" rows="2" maxlength="500" placeholder="مثلاً: انتخاب دستگاه یک هفته جلو افتاد"></textarea></label><label class="field"><span>شاهد یا مدرک <small>اختیاری</small></span><input name="evidence" maxlength="300" placeholder="نام فایل، شماره نامه، لینک یا محل نگهداری"></label><label class="check-field"><input name="includeInReport" type="checkbox" ' + (selectedCount >= 5 ? "disabled" : "") + '><span>افزودن به گزارش هفتگی مدیرعامل ' + (selectedCount >= 5 ? "— سقف پنج نتیجه پر است" : "") + '</span></label><button class="primary-button full-button" type="submit">ثبت نتیجه و بستن کار</button></form>';
  openActionSheet("ثبت نتیجه", task.title, content);
  document.querySelector("#complete-form").addEventListener("submit", saveCompleteForm);
}

async function saveCompleteForm(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const task = state.tasks.find(function (item) { return item.id === data.get("taskId"); });
  if (!task) return;
  task.status = STATUSES.DONE;
  task.completedAt = nowStamp();
  task.updatedAt = nowStamp();
  task.result = {
    outcome: String(data.get("outcome") || "").trim(),
    impact: String(data.get("impact") || "").trim(),
    evidence: String(data.get("evidence") || "").trim(),
    includeInReport: data.get("includeInReport") === "on",
    verifiedDelivery: Boolean(task.waiting),
    createdAt: nowStamp()
  };
  if (task.projectId) {
    const project = state.projects.find(function (item) { return item.id === task.projectId; });
    if (project) {
      if (project.nextActionTaskId === task.id) project.nextActionTaskId = null;
      project.lastActivityAt = nowStamp();
      project.updatedAt = nowStamp();
    }
  }
  closeActionSheet();
  await persist();
  showToast(task.projectId ? "نتیجه ثبت شد؛ اقدام بعدی پروژه را فراموش نکن." : "نتیجه ثبت شد و کار بسته شد.");
}

function openFollowupUpdate(taskId) {
  const task = state.tasks.find(function (item) { return item.id === taskId; });
  if (!task || !task.waiting) return;
  const waiting = task.waiting;
  const content = '<form class="form-grid" id="followup-update-form"><input type="hidden" name="taskId" value="' + escapeHtml(task.id) + '"><div class="conditional-group"><p><strong>منتظر از:</strong> ' + escapeHtml(waiting.person) + '<br><strong>خروجی:</strong> ' + escapeHtml(waiting.expectedOutput) + '</p></div><label class="field"><span>پاسخ یا وضعیت تازه <b>ضروری</b></span><textarea name="latestResponse" rows="3" required autofocus maxlength="700"></textarea></label><div class="form-grid two"><label class="field"><span>موعد توافقی جدید</span><input name="expectedDue" type="date" value="' + escapeHtml(waiting.expectedDue || "") + '"></label><label class="field"><span>پیگیری بعدی <b>ضروری</b></span><input name="nextFollowup" type="date" required value="' + escapeHtml(waiting.nextFollowup || addDaysISO(todayISO(), 1)) + '"></label></div><label class="check-field"><input name="backToAction" type="checkbox"><span>پاسخ رسید و حالا اقدام با خود من است</span></label><button class="primary-button full-button" type="submit">ثبت به‌روزرسانی</button></form>';
  openActionSheet("به‌روزرسانی پیگیری", task.title, content);
  document.querySelector("#followup-update-form").addEventListener("submit", saveFollowupUpdate);
}

async function saveFollowupUpdate(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const task = state.tasks.find(function (item) { return item.id === data.get("taskId"); });
  if (!task || !task.waiting) return;
  const response = String(data.get("latestResponse") || "").trim();
  task.waiting.latestResponse = response;
  task.waiting.expectedDue = data.get("expectedDue") || null;
  task.waiting.nextFollowup = data.get("nextFollowup") || addDaysISO(todayISO(), 1);
  task.waiting.updatedAt = nowStamp();
  task.waiting.history = Array.isArray(task.waiting.history) ? task.waiting.history : [];
  task.waiting.history.push({ at: nowStamp(), text: response });
  if (data.get("backToAction") === "on") {
    task.status = STATUSES.READY;
    task.actionDate = todayISO();
  }
  task.updatedAt = nowStamp();
  closeActionSheet();
  await persist();
  showToast(data.get("backToAction") === "on" ? "کار به فهرست اقدام برگشت." : "پیگیری به‌روزرسانی شد.");
}

function openVerifyDelivery(taskId) {
  const task = state.tasks.find(function (item) { return item.id === taskId; });
  if (!task || !task.waiting) return;
  const content = '<form class="form-grid" id="verify-form"><input type="hidden" name="taskId" value="' + escapeHtml(task.id) + '"><div class="notice warning"><span>' + svg("warning") + '</span><p><strong>اول بررسی، بعد بستن</strong>آیا خروجی تحویلی دقیق، کامل و قابل استفاده است؟</p></div><label class="field"><span>نتیجه بررسی <b>ضروری</b></span><select name="accepted" id="verify-accepted"><option value="yes" selected>تأیید شد؛ کار بسته شود</option><option value="no">ناقص است؛ پیگیری ادامه دارد</option></select></label><label class="field"><span>یادداشت بررسی <b>ضروری</b></span><textarea name="verificationNote" rows="2" required autofocus></textarea></label><div id="verify-success-fields" class="conditional-group"><label class="field"><span>نتیجه نهایی قابل گزارش <b>ضروری</b></span><textarea name="outcome" rows="2" placeholder="چه خروجی نهایی تأیید شد؟"></textarea></label><label class="field"><span>اثر نتیجه</span><textarea name="impact" rows="2"></textarea></label></div><div id="verify-reject-fields" class="conditional-group is-hidden"><label class="field"><span>پیگیری بعدی</span><input name="nextFollowup" type="date" value="' + addDaysISO(todayISO(), 1) + '"></label><label class="field"><span>خروجی اصلاحی مورد انتظار</span><textarea name="expectedOutput" rows="2">' + escapeHtml(task.waiting.expectedOutput || "") + '</textarea></label></div><button class="primary-button full-button" type="submit">ثبت بررسی</button></form>';
  openActionSheet("بررسی تحویل", task.title, content);
  document.querySelector("#verify-accepted").addEventListener("change", function (event) {
    const accepted = event.target.value === "yes";
    document.querySelector("#verify-success-fields").classList.toggle("is-hidden", !accepted);
    document.querySelector("#verify-reject-fields").classList.toggle("is-hidden", accepted);
  });
  document.querySelector("#verify-form").addEventListener("submit", saveDeliveryVerification);
}

async function saveDeliveryVerification(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const task = state.tasks.find(function (item) { return item.id === data.get("taskId"); });
  if (!task || !task.waiting) return;
  const accepted = data.get("accepted") === "yes";
  const note = String(data.get("verificationNote") || "").trim();
  task.waiting.history = Array.isArray(task.waiting.history) ? task.waiting.history : [];
  task.waiting.history.push({ at: nowStamp(), text: "بررسی تحویل: " + note });
  if (accepted) {
    const outcome = String(data.get("outcome") || "").trim();
    if (!outcome) {
      showToast("نتیجه نهایی تأییدشده را بنویس.");
      return;
    }
    task.status = STATUSES.DONE;
    task.completedAt = nowStamp();
    task.result = { outcome: outcome, impact: String(data.get("impact") || "").trim(), evidence: note, includeInReport: false, verifiedDelivery: true, createdAt: nowStamp() };
  } else {
    task.status = STATUSES.WAITING;
    task.waiting.latestResponse = note;
    task.waiting.nextFollowup = data.get("nextFollowup") || addDaysISO(todayISO(), 1);
    task.waiting.expectedOutput = String(data.get("expectedOutput") || task.waiting.expectedOutput).trim();
    task.waiting.updatedAt = nowStamp();
  }
  task.updatedAt = nowStamp();
  if (task.projectId) {
    const project = state.projects.find(function (item) { return item.id === task.projectId; });
    if (project) {
      if (project.nextActionTaskId === task.id) project.nextActionTaskId = null;
      project.lastActivityAt = nowStamp();
    }
  }
  closeActionSheet();
  await persist();
  showToast(accepted ? "تحویل تأیید و نتیجه ثبت شد." : "نقص ثبت شد؛ پیگیری ادامه دارد.");
}

function openFocusChooser() {
  const today = todayISO();
  const focus = selectFocusTasks(state, today);
  const candidates = state.tasks.filter(function (task) {
    return isTaskOpen(task) && task.status !== STATUSES.WAITING && !focus.some(function (item) { return item.id === task.id; });
  }).sort(function (a, b) { return priorityOrder(a.priority) - priorityOrder(b.priority); });
  let current = focus.length ? '<div class="list-stack">' + focus.map(function (task, index) {
    return '<div class="list-row"><div class="list-row-copy"><strong>' + faNumber(index + 1) + ". " + escapeHtml(task.title) + '</strong><span>' + escapeHtml(statusLabels[task.status]) + '</span></div><button class="danger-button compact-button" type="button" data-action="toggle-focus" data-id="' + escapeHtml(task.id) + '">خارج کردن</button></div>';
  }).join("") + "</div>" : '<p class="report-empty">هنوز خروجی‌ای انتخاب نشده است.</p>';
  let candidateHtml = candidates.length ? '<div class="list-stack">' + candidates.map(function (task) {
    return '<div class="list-row"><div class="list-row-copy"><strong>' + escapeHtml(task.title) + '</strong><span>' + escapeHtml(domainName(state, task.domainId)) + " · " + escapeHtml(dueText(task.deadline || task.actionDate)) + '</span></div><button class="ghost-button compact-button" type="button" data-action="toggle-focus" data-id="' + escapeHtml(task.id) + '" ' + (focus.length >= 3 ? "disabled" : "") + '>افزودن</button></div>';
  }).join("") + "</div>" : '<p class="report-empty">کار آماده دیگری وجود ندارد؛ ابتدا از ورودی یک کار بساز.</p>';
  openActionSheet("تمرکز روزانه", "انتخاب سه خروجی امروز", '<div class="form-grid"><div><p class="eyebrow">انتخاب‌شده‌ها ' + faNumber(focus.length) + '/۳</p>' + current + '</div><div class="form-divider"></div><div><p class="eyebrow">کارهای آماده</p>' + candidateHtml + "</div></div>");
}

function openEndDay() {
  const focus = selectFocusTasks(state, todayISO());
  const open = focus.filter(isTaskOpen);
  const done = focus.filter(function (task) { return task.status === STATUSES.DONE; });
  let openHtml = "";
  if (open.length) {
    openHtml = '<div class="conditional-group"><p class="eyebrow">تکلیف تمرکزهای ناتمام</p>' + open.map(function (task) {
      if (task.status === STATUSES.WAITING) {
        return '<div class="list-row"><div class="list-row-copy"><strong>' + escapeHtml(task.title) + '</strong><span>در پیگیری‌ها می‌ماند و از تمرکز فردا خارج می‌شود.</span></div><input type="hidden" name="choice-' + escapeHtml(task.id) + '" value="remove"></div>';
      }
      return '<label class="field"><span>' + escapeHtml(task.title) + '</span><select name="choice-' + escapeHtml(task.id) + '"><option value="tomorrow">ادامه در سه تمرکز فردا</option><option value="remove">خارج از سه تمرکز؛ در فهرست کارها بماند</option><option value="keep">امروز باز بماند</option></select></label>';
    }).join("") + "</div>";
  } else {
    openHtml = '<div class="notice"><span>' + svg("check") + '</span><p><strong>تمرکز بازی نمانده</strong>می‌توانی روز را با خیال راحت ببندی.</p></div>';
  }
  const doneHtml = done.length ? '<div><p class="eyebrow">نتیجه‌های امروز</p><ul class="report-list">' + done.map(function (task) { return "<li>" + escapeHtml(task.result ? task.result.outcome : task.title) + "</li>"; }).join("") + "</ul></div>" : "";
  const content = '<form class="form-grid" id="end-day-form">' + doneHtml + openHtml + '<label class="field"><span>یادداشت کوتاه روز <small>اختیاری</small></span><textarea name="dayNote" rows="2" placeholder="چه چیزی یاد گرفتم یا فردا باید یادم باشد؟"></textarea></label><button class="primary-button full-button" type="submit">بستن روز</button></form>';
  openActionSheet("مرور پایان روز", "نتیجه و تعیین تکلیف", content);
  document.querySelector("#end-day-form").addEventListener("submit", saveEndDay);
}

async function saveEndDay(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  selectFocusTasks(state, todayISO()).filter(isTaskOpen).forEach(function (task) {
    const choice = data.get("choice-" + task.id);
    if (choice === "tomorrow") {
      task.dailyFocus = true;
      task.focusDate = addDaysISO(todayISO(), 1);
      task.actionDate = addDaysISO(todayISO(), 1);
    } else if (choice === "remove") {
      task.dailyFocus = false;
      task.focusDate = null;
      task.focusOrder = null;
    }
    task.updatedAt = nowStamp();
  });
  state.settings.lastClosedDate = todayISO();
  const note = String(data.get("dayNote") || "").trim();
  if (note) {
    state.notes.push({ id: createId("note"), title: "یادداشت پایان روز " + formatFaDate(todayISO()), content: note, createdAt: nowStamp(), updatedAt: nowStamp(), attachments: [], dailyReview: true });
  }
  closeActionSheet();
  await persist();
  reviewTab = "daily";
  navigate("review");
  showToast("روز بسته شد؛ فردا از سه تمرکز شروع می‌کنی.");
}

function findItem(kind, itemId) {
  const collections = { inbox: state.inbox, task: state.tasks, project: state.projects, note: state.notes };
  const collection = collections[kind] || [];
  return collection.find(function (item) { return item.id === itemId; }) || null;
}

function openAttachments(kind, itemId) {
  const item = findItem(kind, itemId);
  if (!item || !attachmentCount(item)) {
    showToast("پیوستی برای نمایش وجود ندارد.");
    return;
  }
  openActionSheet("پیوست‌ها", item.title || "فایل‌های ثبت‌شده", "");
  let content = '<div class="form-grid">';
  item.attachments.forEach(function (attachment) {
    if (!(attachment.blob instanceof Blob)) return;
    const url = URL.createObjectURL(attachment.blob);
    dialogObjectUrls.push(url);
    let preview = "";
    if (String(attachment.type).indexOf("image/") === 0) preview = '<img class="attachment-preview" src="' + url + '" alt="' + escapeHtml(attachment.name) + '">';
    else if (String(attachment.type).indexOf("audio/") === 0) preview = '<audio class="attachment-audio" src="' + url + '" controls preload="metadata"></audio>';
    content += '<article class="card">' + preview + '<div class="card-top"><div class="card-title"><h3>' + escapeHtml(attachment.name) + '</h3><p>' + escapeHtml(attachment.type || "فایل") + " · " + faNumber(Math.ceil(Number(attachment.size || 0) / 1024)) + ' کیلوبایت</p></div></div><div class="card-actions"><a class="primary-button compact-button" href="' + url + '" download="' + escapeHtml(attachment.name) + '">' + svg("download") + "ذخیره فایل</a></div></article>";
  });
  content += "</div>";
  actionContent.innerHTML = content;
}

function searchAll(query) {
  const normalized = normalizePersian(query);
  if (!normalized) return [];
  const results = [];
  state.inbox.forEach(function (item) {
    if (normalizePersian(item.title + " " + (item.details || "")).includes(normalized)) results.push({ kind: "inbox", id: item.id, title: item.title, meta: "ورودی" });
  });
  state.tasks.forEach(function (item) {
    const text = item.title + " " + (item.details || "") + " " + domainName(state, item.domainId) + " " + projectName(state, item.projectId);
    if (normalizePersian(text).includes(normalized)) results.push({ kind: "task", id: item.id, title: item.title, meta: "کار · " + (statusLabels[item.status] || item.status) });
  });
  state.projects.forEach(function (item) {
    const text = item.title + " " + (item.outcome || "") + " " + (item.description || "") + " " + domainName(state, item.domainId);
    if (normalizePersian(text).includes(normalized)) results.push({ kind: "project", id: item.id, title: item.title, meta: "پروژه · " + (statusLabels[item.status] || item.status) });
  });
  state.notes.forEach(function (item) {
    if (normalizePersian(item.title + " " + (item.content || "")).includes(normalized)) results.push({ kind: "note", id: item.id, title: item.title, meta: "یادداشت" });
  });
  return results.slice(0, 60);
}

function searchResultHtml(results) {
  if (!results.length) return '<p class="report-empty">نتیجه‌ای پیدا نشد.</p>';
  return '<div class="list-stack">' + results.map(function (result) {
    const action = result.kind === "inbox" ? "process-inbox" : result.kind === "task" ? "task-details" : result.kind === "project" ? "project-details" : "note-details";
    return '<button class="list-row title-button" type="button" data-action="' + action + '" data-id="' + escapeHtml(result.id) + '"><span class="list-row-copy"><strong>' + escapeHtml(result.title) + '</strong><span>' + escapeHtml(result.meta) + '</span></span><span>' + svg("chevron") + "</span></button>";
  }).join("") + "</div>";
}

function openSearch() {
  const content = '<div class="form-grid"><label class="field"><span>جست‌وجو در کارها، پروژه‌ها، ورودی و بایگانی</span><input class="search-input" id="global-search-input" type="search" autofocus autocomplete="off" placeholder="چند کلمه از عنوان یا حوزه"></label><div class="search-results" id="global-search-results"><p class="report-empty">عبارت جست‌وجو را بنویس.</p></div></div>';
  openActionSheet("جست‌وجوی یکپارچه", "هر چیزی را پیدا کن", content);
  const input = document.querySelector("#global-search-input");
  input.addEventListener("input", function () {
    const query = input.value.trim();
    document.querySelector("#global-search-results").innerHTML = query ? searchResultHtml(searchAll(query)) : '<p class="report-empty">عبارت جست‌وجو را بنویس.</p>';
  });
}

function openNoteDetails(noteId) {
  const note = state.notes.find(function (item) { return item.id === noteId; });
  if (!note) return;
  const content = '<div class="form-grid"><p class="card-note">' + escapeHtml(note.content || "بدون متن") + '</p><p class="form-hint">ثبت‌شده: ' + escapeHtml(timestampLabel(note.createdAt)) + '</p>' + attachmentButton(note, "note") + "</div>";
  openActionSheet("یادداشت و مرجع", note.title, content);
}

function fileToDataUrl(blob) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.addEventListener("load", function () { resolve(reader.result); });
    reader.addEventListener("error", function () { reject(reader.error); });
    reader.readAsDataURL(blob);
  });
}

async function encodeAttachments(attachments) {
  return Promise.all((attachments || []).map(async function (attachment) {
    const copy = Object.assign({}, attachment);
    if (copy.blob instanceof Blob) copy.blobData = await fileToDataUrl(copy.blob);
    delete copy.blob;
    return copy;
  }));
}

async function makeBackup() {
  const copyCollection = async function (collection) {
    return Promise.all(collection.map(async function (item) {
      const copy = Object.assign({}, item);
      copy.attachments = await encodeAttachments(item.attachments || []);
      return copy;
    }));
  };
  return {
    app: "saman-kar",
    backupVersion: APP_VERSION,
    exportedAt: nowStamp(),
    state: {
      version: state.version,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      settings: Object.assign({}, state.settings),
      domains: state.domains,
      routines: await copyCollection(state.routines),
      inbox: await copyCollection(state.inbox),
      tasks: await copyCollection(state.tasks),
      projects: await copyCollection(state.projects),
      notes: await copyCollection(state.notes)
    }
  };
}

async function exportBackup() {
  try {
    showToast("در حال ساخت نسخه پشتیبان…");
    const backup = await makeBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "saman-kar-backup-" + todayISO() + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast("نسخه پشتیبان ساخته شد.");
  } catch (error) {
    console.error(error);
    showToast("ساخت نسخه پشتیبان انجام نشد.");
  }
}

async function dataUrlToBlob(value) {
  const response = await fetch(value);
  return response.blob();
}

async function decodeCollection(collection) {
  return Promise.all((collection || []).map(async function (item) {
    const copy = Object.assign({}, item);
    copy.attachments = await Promise.all((item.attachments || []).map(async function (attachment) {
      const decoded = Object.assign({}, attachment);
      if (decoded.blobData) decoded.blob = await dataUrlToBlob(decoded.blobData);
      delete decoded.blobData;
      return decoded;
    }));
    return copy;
  }));
}

async function importBackupFile(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || parsed.app !== "saman-kar" || !parsed.state) throw new Error("این فایل پشتیبان سامان‌کار نیست.");
    if (!window.confirm("اطلاعات فعلی با محتوای این نسخه پشتیبان جایگزین شود؟")) return;
    const imported = Object.assign({}, parsed.state);
    imported.routines = await decodeCollection(parsed.state.routines);
    imported.inbox = await decodeCollection(parsed.state.inbox);
    imported.tasks = await decodeCollection(parsed.state.tasks);
    imported.projects = await decodeCollection(parsed.state.projects);
    imported.notes = await decodeCollection(parsed.state.notes);
    state = migrateState(imported);
    materializeRoutineTasks(state, todayISO());
    closeActionSheet();
    await persist();
    showToast("نسخه پشتیبان با موفقیت بازیابی شد.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "بازیابی نسخه پشتیبان انجام نشد.");
  }
}

function applyTheme(theme) {
  const selected = theme || state.settings.theme || "auto";
  const dark = selected === "dark" || (selected === "auto" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function openSettings() {
  const notificationSupport = "Notification" in window;
  const notificationText = !notificationSupport ? "این مرورگر اعلان را پشتیبانی نمی‌کند" : Notification.permission === "granted" ? "اجازه اعلان داده شده" : Notification.permission === "denied" ? "اعلان در تنظیمات مرورگر مسدود است" : "اجازه اعلان هنوز داده نشده";
  const installButton = deferredInstallPrompt ? '<button class="primary-button full-button" type="button" data-action="install-app">نصب سامان‌کار روی گوشی</button>' : '<div class="notice"><span>' + svg("download") + '</span><p><strong>نصب روی صفحه اصلی</strong>در آیفون: Share سپس Add to Home Screen. در اندروید: منوی مرورگر سپس Install app.</p></div>';
  const content = '<form class="form-grid" id="settings-form"><label class="field"><span>ظاهر</span><select name="theme"><option value="auto" ' + (state.settings.theme === "auto" ? "selected" : "") + '>هماهنگ با گوشی</option><option value="light" ' + (state.settings.theme === "light" ? "selected" : "") + '>روشن</option><option value="dark" ' + (state.settings.theme === "dark" ? "selected" : "") + '>تیره</option></select></label><button class="primary-button full-button" type="submit">ذخیره تنظیمات</button></form><div class="form-divider"></div><div class="form-grid"><h3>نصب و یادآوری</h3>' + installButton + '<p class="form-hint">' + escapeHtml(notificationText) + '</p><button class="secondary-button full-button" type="button" data-action="enable-notifications" ' + (!notificationSupport || Notification.permission === "denied" ? "disabled" : "") + '>فعال‌کردن یادآوری‌ها</button><div class="notice warning"><span>' + svg("warning") + '</span><p>در نسخه وب، یادآوری مطمئن هنگام بسته‌بودن کامل برنامه به محدودیت گوشی و مرورگر وابسته است. داخل برنامه و هنگام اجرای آن، سررسیدها بررسی می‌شوند.</p></div></div><div class="form-divider"></div><div class="form-grid"><h3>پشتیبان‌گیری</h3><p class="form-hint">اطلاعات روی همین دستگاه است؛ به‌صورت منظم فایل پشتیبان بگیر.</p><div class="button-row"><button class="secondary-button" type="button" data-action="export-backup">' + svg("download") + 'خروجی پشتیبان</button><label class="secondary-button" for="import-backup-input">' + svg("upload") + 'بازیابی پشتیبان</label><input class="visually-hidden" id="import-backup-input" type="file" accept="application/json,.json"></div></div><div class="form-divider"></div><p class="form-hint">سامان‌کار نسخه ' + APP_VERSION + " · داده‌ها بدون حساب کاربری روی دستگاه ذخیره می‌شوند.</p>";
  openActionSheet("تنظیمات شخصی", "سامان‌کار", content);
  document.querySelector("#settings-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.settings.theme = data.get("theme") || "auto";
    applyTheme(state.settings.theme);
    await persist(false);
    showToast("تنظیمات ذخیره شد.");
  });
  document.querySelector("#import-backup-input").addEventListener("change", function (event) { importBackupFile(event.target.files[0]); });
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    showToast("اعلان در این مرورگر پشتیبانی نمی‌شود.");
    return;
  }
  const permission = await Notification.requestPermission();
  state.settings.notificationsEnabled = permission === "granted";
  await persist(false);
  showToast(permission === "granted" ? "یادآوری‌ها فعال شد." : "اجازه اعلان داده نشد.");
  openSettings();
}

async function installApp() {
  if (!deferredInstallPrompt) {
    showToast("از گزینه افزودن به صفحه اصلی در مرورگر استفاده کن.");
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  closeActionSheet();
}

async function handleAction(action, element) {
  const itemId = element.dataset.id;
  if (action === "open-capture") openCapture();
  else if (action === "open-inbox") navigate("inbox");
  else if (action === "open-followups") navigate("followups");
  else if (action === "process-inbox") openProcessInbox(itemId);
  else if (action === "delete-inbox") {
    const item = state.inbox.find(function (entry) { return entry.id === itemId; });
    if (item && window.confirm("«" + item.title + "» از ورودی حذف شود؟")) {
      state.inbox = state.inbox.filter(function (entry) { return entry.id !== itemId; });
      await persist();
      showToast("از ورودی حذف شد.");
    }
  } else if (action === "choose-focus") openFocusChooser();
  else if (action === "toggle-focus") {
    const task = state.tasks.find(function (item) { return item.id === itemId; });
    if (!task) return;
    try {
      setTaskDailyFocus(state, itemId, !task.dailyFocus || task.focusDate !== todayISO(), todayISO());
      await persist(false);
      render();
      if (actionDialog.open && actionTitle.textContent === "انتخاب سه خروجی امروز") openFocusChooser();
      showToast(task.dailyFocus ? "در سه تمرکز امروز قرار گرفت." : "از سه تمرکز خارج شد.");
    } catch (error) {
      showToast(error.message);
    }
  } else if (action === "start-task") {
    const task = state.tasks.find(function (item) { return item.id === itemId; });
    if (!task) return;
    task.status = task.status === STATUSES.DOING ? STATUSES.READY : STATUSES.DOING;
    task.updatedAt = nowStamp();
    await persist();
  } else if (action === "wait-task") openWaitingForm(itemId);
  else if (action === "complete-task") openCompleteForm(itemId);
  else if (action === "task-details") openTaskDetails(itemId);
  else if (action === "edit-task") openTaskEdit(itemId);
  else if (action === "new-project") openNewProject();
  else if (action === "project-details") openProjectDetails(itemId);
  else if (action === "edit-project") openNewProject(itemId);
  else if (action === "project-action") openProjectAction(itemId);
  else if (action === "toggle-project-focus") {
    const project = state.projects.find(function (item) { return item.id === itemId; });
    if (!project) return;
    try {
      setProjectWeeklyFocus(state, itemId, !project.weeklyFocus);
      await persist();
      showToast(project.weeklyFocus ? "پروژه در تمرکز این هفته قرار گرفت." : "از تمرکز هفته خارج شد.");
    } catch (error) {
      showToast(error.message);
    }
  } else if (action === "project-filter") {
    projectFilter = element.dataset.filter;
    render();
  } else if (action === "followup-filter") {
    followupFilter = element.dataset.filter;
    render();
  } else if (action === "followup-update") openFollowupUpdate(itemId);
  else if (action === "verify-delivery") openVerifyDelivery(itemId);
  else if (action === "review-tab") {
    reviewTab = element.dataset.filter;
    render();
  } else if (action === "toggle-report-result") {
    const task = state.tasks.find(function (item) { return item.id === itemId; });
    if (!task || !task.result) return;
    const selectedCount = selectWeeklyResults(state, todayISO()).filter(function (item) { return item.result.includeInReport; }).length;
    if (!task.result.includeInReport && selectedCount >= 5) {
      showToast("گزارش مدیرعامل حداکثر پنج نتیجه دارد.");
      return;
    }
    task.result.includeInReport = !task.result.includeInReport;
    await persist();
  } else if (action === "copy-report") {
    const report = document.querySelector("#weekly-report");
    if (!report) return;
    const textValue = report.innerText;
    try {
      await navigator.clipboard.writeText(textValue);
    } catch (error) {
      const textarea = document.createElement("textarea");
      textarea.value = textValue;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showToast("متن گزارش کپی شد.");
  } else if (action === "print-report") window.print();
  else if (action === "end-day") openEndDay();
  else if (action === "attachments") openAttachments(element.dataset.kind, itemId);
  else if (action === "note-details") openNoteDetails(itemId);
  else if (action === "export-backup") exportBackup();
  else if (action === "enable-notifications") enableNotifications();
  else if (action === "install-app") installApp();
}

document.addEventListener("click", function (event) {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    navigate(pageButton.dataset.page);
    return;
  }
  const actionElement = event.target.closest("[data-action]");
  if (actionElement) {
    event.preventDefault();
    handleAction(actionElement.dataset.action, actionElement);
  }
});

document.querySelector("#capture-button").addEventListener("click", openCapture);
document.querySelector("#inbox-button").addEventListener("click", function () { navigate("inbox"); });
document.querySelector("#search-button").addEventListener("click", openSearch);
document.querySelector("#settings-button").addEventListener("click", openSettings);
document.querySelector("#close-action-dialog").addEventListener("click", closeActionSheet);
document.querySelector("#save-capture-button").addEventListener("click", saveCapture);
document.querySelector("#voice-button").addEventListener("click", toggleRecording);
document.querySelector("#photo-input").addEventListener("change", function (event) { addCaptureFiles(event.target.files); });
document.querySelector("#file-input").addEventListener("change", function (event) { addCaptureFiles(event.target.files); });
document.querySelector("#capture-attachments").addEventListener("click", function (event) {
  const button = event.target.closest("[data-remove-attachment]");
  if (!button) return;
  pendingAttachments = pendingAttachments.filter(function (attachment) { return attachment.id !== button.dataset.removeAttachment; });
  renderCaptureAttachments();
});
captureDialog.addEventListener("close", function () { stopRecording(true); });
captureDialog.addEventListener("click", function (event) {
  if (event.target === captureDialog) captureDialog.close();
});
actionDialog.addEventListener("click", function (event) {
  if (event.target === actionDialog) closeActionSheet();
});

window.addEventListener("beforeinstallprompt", function (event) {
  event.preventDefault();
  deferredInstallPrompt = event;
});
window.addEventListener("appinstalled", function () {
  deferredInstallPrompt = null;
  showToast("سامان‌کار نصب شد.");
});

async function checkReminders() {
  if (!("Notification" in window) || Notification.permission !== "granted" || !state.settings.notificationsEnabled) return;
  const date = todayISO();
  const reminders = [];
  selectDueFollowups(state, date).forEach(function (task) {
    reminders.push({ key: date + "-followup-" + task.id, title: "پیگیری: " + task.title, body: "منتظر از " + (task.waiting.person || "—") + "؛ امروز پیگیری کن." });
  });
  state.tasks.filter(function (task) {
    return isTaskOpen(task) && task.status !== STATUSES.WAITING && task.deadline === date;
  }).forEach(function (task) {
    reminders.push({ key: date + "-deadline-" + task.id, title: "مهلت امروز: " + task.title, body: "این کار امروز مهلت دارد." });
  });
  const seen = new Set(state.settings.lastReminderKeys || []);
  const fresh = reminders.filter(function (reminder) { return !seen.has(reminder.key); });
  for (const reminder of fresh) {
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(reminder.title, { body: reminder.body, icon: "icon-192.png", badge: "icon-192.png", tag: reminder.key });
      } else {
        new Notification(reminder.title, { body: reminder.body, icon: "icon-192.png", tag: reminder.key });
      }
    } catch (error) {
      console.error(error);
    }
    seen.add(reminder.key);
  }
  if (fresh.length) {
    state.settings.lastReminderKeys = Array.from(seen).slice(-100);
    await persist(false);
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch (error) {
    console.error("Service worker registration failed", error);
  }
}

async function initialize() {
  try {
    const stored = await loadState();
    state = migrateState(stored || createDefaultState());
  } catch (error) {
    console.error(error);
    state = createDefaultState();
    showToast("حافظه دستگاه در دسترس نبود؛ برنامه موقت اجرا شد.");
  }
  const createdRoutines = materializeRoutineTasks(state, todayISO());
  applyTheme(state.settings.theme);
  render();
  if (createdRoutines.length) await persist(false);
  registerServiceWorker();
  checkReminders();
  window.setInterval(checkReminders, 60000);
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function () {});
  }
}

if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
    if (state.settings.theme === "auto") applyTheme("auto");
  });
}

initialize();
