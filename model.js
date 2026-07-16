export const APP_VERSION = 1;

export const STATUSES = Object.freeze({
  INBOX: "inbox",
  READY: "ready",
  DOING: "doing",
  WAITING: "waiting",
  DONE: "done",
  CANCELLED: "cancelled"
});

export const PROJECT_STATUSES = Object.freeze({
  PLANNED: "planned",
  ACTIVE: "active",
  WAITING: "waiting",
  PAUSED: "paused",
  DONE: "done",
  CANCELLED: "cancelled"
});

export const PRIORITIES = Object.freeze({ P1: "P1", P2: "P2", P3: "P3" });

export const DOMAIN_TREE = Object.freeze([
  {
    id: "product-development",
    name: "توسعه محصول و فرمولاسیون",
    children: ["سفیده باشگاهی", "سفیده بیکری", "زرده آنزیمی"]
  },
  {
    id: "sports-line",
    name: "احداث خط محصولات باشگاهی",
    children: [
      "طراحی فرایند",
      "ظرفیت و مشخصات",
      "انتخاب ماشین — میکسر",
      "انتخاب ماشین — اگلومراتور",
      "انتخاب ماشین — پرکن",
      "انتخاب ماشین — ساشه‌زن",
      "خرید و تحویل",
      "نصب",
      "راه‌اندازی",
      "تحویل خط"
    ]
  },
  {
    id: "current-production",
    name: "پایش و بهبود تولید جاری",
    children: ["مایع پاستوریزه", "پودر سفیده", "پودر زرده و تخم‌مرغ کامل", "هات‌روم", "بسته‌بندی"]
  },
  {
    id: "maintenance",
    name: "تعمیر و نگهداری",
    children: ["تعمیر", "نگهداری"]
  },
  {
    id: "licenses",
    name: "مجوزها و انطباق قانونی",
    children: ["پودر فرموله — غذا و دارو", "محصولات باشگاهی — مسیر نیازمند تکمیل"]
  },
  {
    id: "design-support",
    name: "طراحی و پشتیبانی مشتریان",
    children: ["اصلاح و نهایی‌سازی طراحی", "پشتیبانی فنی مشتری", "جمع‌آوری بازخورد مشتری"]
  }
]);

function randomPart() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function createId(prefix) {
  return (prefix || "item") + "-" + randomPart();
}

export function localISO(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

export function addDaysISO(isoDate, days) {
  const date = new Date(isoDate + "T12:00:00");
  date.setDate(date.getDate() + Number(days || 0));
  return localISO(date);
}

export function formatFaDate(isoDate, options) {
  if (!isoDate) return "بدون تاریخ";
  const date = new Date(isoDate + "T12:00:00");
  return new Intl.DateTimeFormat("fa-IR", options || { month: "short", day: "numeric" }).format(date);
}

export function normalizePersian(value) {
  return String(value || "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u200c/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fa");
}

function defaultRoutines() {
  return [
    {
      id: "routine-morning-plan",
      title: "برنامه‌ریزی شروع روز",
      cadence: "daily",
      weekday: null,
      estimateMinutes: 5,
      priority: PRIORITIES.P2,
      active: true
    },
    {
      id: "routine-end-day",
      title: "مرور و بستن روز",
      cadence: "daily",
      weekday: null,
      estimateMinutes: 10,
      priority: PRIORITIES.P2,
      active: true
    },
    {
      id: "routine-weekly-review",
      title: "مرور هفتگی و انتخاب سه پروژه تمرکز",
      cadence: "weekly",
      weekday: 4,
      estimateMinutes: 40,
      priority: PRIORITIES.P1,
      active: true
    }
  ];
}

export function createDefaultState(now) {
  const stamp = (now instanceof Date ? now : new Date(now || Date.now())).toISOString();
  return {
    version: APP_VERSION,
    createdAt: stamp,
    updatedAt: stamp,
    settings: {
      theme: "auto",
      notificationsEnabled: false,
      reminderHour: 9,
      reminderMinute: 0,
      lastReminderKeys: [],
      installHintSeen: false
    },
    domains: DOMAIN_TREE.map(function (domain) {
      return { id: domain.id, name: domain.name, children: domain.children.slice() };
    }),
    inbox: [],
    tasks: [],
    projects: [],
    notes: [],
    routines: defaultRoutines()
  };
}

export function migrateState(input) {
  const base = createDefaultState();
  if (!input || typeof input !== "object") return base;
  const state = input;
  state.version = APP_VERSION;
  state.createdAt = state.createdAt || base.createdAt;
  state.updatedAt = state.updatedAt || base.updatedAt;
  state.settings = Object.assign({}, base.settings, state.settings || {});
  state.domains = Array.isArray(state.domains) && state.domains.length ? state.domains : base.domains;
  state.inbox = Array.isArray(state.inbox) ? state.inbox : [];
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  state.notes = Array.isArray(state.notes) ? state.notes : [];
  state.routines = Array.isArray(state.routines) && state.routines.length ? state.routines : base.routines;
  state.tasks.forEach(function (task) {
    task.status = task.status || STATUSES.READY;
    task.priority = task.priority || PRIORITIES.P2;
    task.attachments = Array.isArray(task.attachments) ? task.attachments : [];
    task.dailyFocus = Boolean(task.dailyFocus);
  });
  state.projects.forEach(function (project) {
    project.status = project.status || PROJECT_STATUSES.ACTIVE;
    project.weeklyFocus = Boolean(project.weeklyFocus);
    project.attachments = Array.isArray(project.attachments) ? project.attachments : [];
  });
  return state;
}

export function shouldRunRoutine(routine, isoDate) {
  if (!routine || !routine.active) return false;
  if (routine.cadence === "daily") return true;
  if (routine.cadence === "weekly") {
    return new Date(isoDate + "T12:00:00").getDay() === Number(routine.weekday);
  }
  return false;
}

export function materializeRoutineTasks(state, isoDate) {
  const date = isoDate || localISO();
  const created = [];
  state.routines.forEach(function (routine) {
    if (!shouldRunRoutine(routine, date)) return;
    const alreadyExists = state.tasks.some(function (task) {
      return task.sourceRoutineId === routine.id && task.recurringGeneratedDate === date;
    });
    if (alreadyExists) return;
    const stamp = new Date().toISOString();
    const task = {
      id: createId("task"),
      title: routine.title,
      details: routine.details || "",
      type: "recurring_task",
      domainId: routine.domainId || null,
      domainChild: "",
      projectId: null,
      owner: "من",
      status: STATUSES.READY,
      priority: routine.priority || PRIORITIES.P2,
      estimateMinutes: Number(routine.estimateMinutes || 0),
      actionDate: date,
      deadline: date,
      dailyFocus: false,
      sourceRoutineId: routine.id,
      recurringGeneratedDate: date,
      createdAt: stamp,
      updatedAt: stamp,
      completedAt: null,
      waiting: null,
      result: null,
      attachments: Array.isArray(routine.attachments) ? routine.attachments.slice() : []
    };
    state.tasks.push(task);
    created.push(task);
  });
  return created;
}

export function isTaskOpen(task) {
  return Boolean(task) && task.status !== STATUSES.DONE && task.status !== STATUSES.CANCELLED;
}

export function priorityOrder(value) {
  return value === PRIORITIES.P1 ? 1 : value === PRIORITIES.P2 ? 2 : 3;
}

function taskSort(a, b) {
  const priorityDifference = priorityOrder(a.priority) - priorityOrder(b.priority);
  if (priorityDifference) return priorityDifference;
  return String(a.deadline || "9999-99-99").localeCompare(String(b.deadline || "9999-99-99"));
}

export function selectFocusTasks(state, isoDate) {
  const date = isoDate || localISO();
  return state.tasks.filter(function (task) {
    return task.status !== STATUSES.CANCELLED && task.dailyFocus === true && (!task.focusDate || task.focusDate === date);
  }).sort(function (a, b) {
    return Number(a.focusOrder || 99) - Number(b.focusOrder || 99) || taskSort(a, b);
  });
}

export function selectTodayTasks(state, isoDate) {
  const date = isoDate || localISO();
  const focusIds = new Set(selectFocusTasks(state, date).map(function (task) { return task.id; }));
  const due = state.tasks.filter(function (task) {
    if (!isTaskOpen(task) || task.status === STATUSES.WAITING || focusIds.has(task.id)) return false;
    return (task.actionDate && task.actionDate <= date) || (task.deadline && task.deadline <= date);
  });
  return {
    focus: selectFocusTasks(state, date),
    commitments: due.filter(function (task) {
      const estimate = Number(task.estimateMinutes || 0);
      return !task.sourceRoutineId && !(estimate > 0 && estimate <= 15);
    }).sort(taskSort),
    recurring: due.filter(function (task) { return Boolean(task.sourceRoutineId); }).sort(taskSort),
    quick: due.filter(function (task) { return !task.sourceRoutineId && Number(task.estimateMinutes || 0) > 0 && Number(task.estimateMinutes) <= 15; }).sort(taskSort)
  };
}

export function selectWaitingTasks(state) {
  return state.tasks.filter(function (task) {
    return isTaskOpen(task) && task.status === STATUSES.WAITING && task.waiting;
  });
}

export function followupBucket(task, isoDate) {
  const date = isoDate || localISO();
  const waiting = task && task.waiting ? task.waiting : {};
  if (waiting.expectedDue && waiting.expectedDue < date) return "overdue";
  if (waiting.nextFollowup && waiting.nextFollowup <= date) return "today";
  return "future";
}

export function selectDueFollowups(state, isoDate) {
  const date = isoDate || localISO();
  return selectWaitingTasks(state).filter(function (task) {
    return followupBucket(task, date) !== "future";
  }).sort(function (a, b) {
    const bucketOrder = { overdue: 1, today: 2, future: 3 };
    const bucketDifference = bucketOrder[followupBucket(a, date)] - bucketOrder[followupBucket(b, date)];
    if (bucketDifference) return bucketDifference;
    const aDate = a.waiting.nextFollowup || a.waiting.expectedDue || "9999-99-99";
    const bDate = b.waiting.nextFollowup || b.waiting.expectedDue || "9999-99-99";
    return aDate.localeCompare(bDate);
  });
}

export function daysSince(value, now) {
  if (!value) return Infinity;
  const current = now instanceof Date ? now : new Date(now || Date.now());
  return Math.floor((current.getTime() - new Date(value).getTime()) / 86400000);
}

export function isProjectAtRisk(project, now) {
  if (!project || project.status !== PROJECT_STATUSES.ACTIVE) return false;
  return daysSince(project.lastActivityAt || project.updatedAt || project.createdAt, now) >= 7;
}

export function selectWeeklyResults(state, isoDate) {
  const endDate = isoDate || localISO();
  const startDate = addDaysISO(endDate, -6);
  return state.tasks.filter(function (task) {
    if (task.status !== STATUSES.DONE || !task.completedAt || !task.result || !task.result.outcome) return false;
    const completedDate = localISO(new Date(task.completedAt));
    return completedDate >= startDate && completedDate <= endDate;
  }).sort(function (a, b) {
    return String(b.completedAt).localeCompare(String(a.completedAt));
  });
}

export function setTaskDailyFocus(state, taskId, enabled, isoDate) {
  const task = state.tasks.find(function (item) { return item.id === taskId; });
  if (!task) throw new Error("کار پیدا نشد.");
  const date = isoDate || localISO();
  const focusedOnDate = task.dailyFocus && (!task.focusDate || task.focusDate === date);
  if (enabled && !focusedOnDate && selectFocusTasks(state, date).length >= 3) {
    throw new Error("سه تمرکز امروز پر شده است؛ ابتدا یکی را خارج کنید.");
  }
  task.dailyFocus = Boolean(enabled);
  task.focusDate = enabled ? date : null;
  task.focusOrder = enabled ? selectFocusTasks(state, date).length + 1 : null;
  task.updatedAt = new Date().toISOString();
  return task;
}

export function setProjectWeeklyFocus(state, projectId, enabled) {
  const project = state.projects.find(function (item) { return item.id === projectId; });
  if (!project) throw new Error("پروژه پیدا نشد.");
  const activeCount = state.projects.filter(function (item) { return item.weeklyFocus; }).length;
  if (enabled && !project.weeklyFocus && activeCount >= 3) {
    throw new Error("سه پروژه تمرکز هفتگی پر شده است؛ ابتدا یکی را خارج کنید.");
  }
  project.weeklyFocus = Boolean(enabled);
  project.updatedAt = new Date().toISOString();
  return project;
}

export function domainName(state, domainId) {
  const domain = state.domains.find(function (item) { return item.id === domainId; });
  return domain ? domain.name : "بدون حوزه";
}

export function projectName(state, projectId) {
  const project = state.projects.find(function (item) { return item.id === projectId; });
  return project ? project.title : "بدون پروژه";
}

export function projectNextActions(state, projectId) {
  return state.tasks.filter(function (task) {
    return task.projectId === projectId && isTaskOpen(task) && task.status !== STATUSES.WAITING;
  }).sort(taskSort);
}
