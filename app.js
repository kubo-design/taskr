const STORAGE = {
  tasks: "tm_tasks_v2",
  projects: "tm_projects_v1",
  projectsTrash: "tm_projects_trash_v1",
  todos: "tm_todos_v1",
  todosTrash: "tm_todos_trash_v1",
  doneTrash: "tm_done_trash_v1",
  ui: "tm_ui_v1"
};

const $ = (sel) => document.querySelector(sel);

const els = {
  typeTabs: document.querySelectorAll(".type-btn"),
  form: $("#taskForm"),
  projectInput: $("#projectInput"),
  projectSelect: $("#projectSelect"),
  todoInput: $("#todoInput"),
  todoSelect: $("#todoSelect"),
  noteInput: $("#noteInput"),
  noteAttachments: $("#noteAttachments"),
  noteAddCheckbox: $("#noteAddCheckbox"),
  noteUndo: $("#noteUndo"),
  dueRow: document.querySelector(".date-row"),
  dueInput: $("#dueInput"),
  dueTimeRow: $("#dueTimeRow"),
  dueTimeInput: $("#dueTimeInput"),
  dueTimeToggle: $("#dueTimeToggle"),
  projectHistory: $("#projectHistory"),
  projectTrash: $("#projectTrash"),
  todoHistory: $("#todoHistory"),
  todoTrash: $("#todoTrash"),
  doneTrash: $("#doneTrash"),
  doneSelectAll: $("#doneSelectAll"),
  doneDeleteSelected: $("#doneDeleteSelected"),
  projectSelectAll: $("#projectSelectAll"),
  todoSelectAll: $("#todoSelectAll"),
  projectDelete: $("#projectDelete"),
  todoDelete: $("#todoDelete"),
  filterButtons: document.querySelectorAll(".filter-btn"),
  sortButtons: document.querySelectorAll(".sort-btn"),
  toggleView: $("#toggleView"),
  activeProjectFilter: $("#activeProjectFilter"),
  activeList: $("#activeList"),
  doneList: $("#doneList"),
  activeListView: $("#activeListView"),
  calendarView: $("#calendarView"),
  calendarTitle: $("#calendarTitle"),
  calendarGrid: $("#calendarGrid"),
  calendarUndated: $("#calendarUndated"),
  prevMonth: $("#prevMonth"),
  nextMonth: $("#nextMonth"),
  editDialog: $("#editDialog"),
  editForm: $("#editForm"),
  editId: $("#editId"),
  editProject: $("#editProject"),
  editTodo: $("#editTodo"),
  editNote: $("#editNote"),
  editNoteAddCheckbox: $("#editNoteAddCheckbox"),
  editNoteUndo: $("#editNoteUndo"),
  editAttachments: $("#editAttachments"),
  editAttachmentsList: $("#editAttachmentsList"),
  editDue: $("#editDue"),
  editDueRow: $("#editDue")?.closest(".date-row"),
  editDueTimeRow: $("#editDueTimeRow"),
  editDueTime: $("#editDueTime"),
  editDueTimeToggle: $("#editDueTimeToggle"),
  editCancel: $("#editCancel"),
  previewDialog: $("#previewDialog"),
  previewType: $("#previewType"),
  previewProject: $("#previewProject"),
  previewTodo: $("#previewTodo"),
  previewNote: $("#previewNote"),
  previewDue: $("#previewDue"),
  previewAttachments: $("#previewAttachments"),
  previewAttachmentsRow: document.querySelector(".preview-attachments"),
  previewClose: $("#previewClose"),
  previewEdit: $("#previewEdit"),
  previewDuplicate: $("#previewDuplicate"),
  previewComplete: $("#previewComplete"),
  exportActiveJson: $("#exportActiveJson"),
  importActiveJsonBtn: $("#importActiveJsonBtn"),
  importActiveJson: $("#importActiveJson"),
  exportDialog: $("#exportDialog"),
  exportShareBtn: $("#exportShareBtn"),
  exportSaveBtn: $("#exportSaveBtn"),
  exportDownloadBtn: $("#exportDownloadBtn"),
  exportCancelBtn: $("#exportCancelBtn"),
  exportSupportNote: $("#exportSupportNote")
};

const state = {
  newType: "work",
  filters: {
    active: { work: true, private: true },
    done: { work: true, private: true }
  },
  sortActive: "all",
  sortDone: "all",
  activeProjectFilter: "all",
  view: "list",
  calendarMonth: new Date().getMonth(),
  calendarYear: new Date().getFullYear()
};

let trashCleanupTimer = null;
const HISTORY_TRASH_TTL = 300000;
const DONE_TRASH_TTL = 300000;
const FILE_SAVE_DELAY = 400;
const ATTACHMENT_TTL = 1000 * 60 * 60 * 24 * 20;
const MAX_ATTACHMENTS_PER_TASK = 5;
const MAX_ATTACHMENT_SIZE = 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "application/pdf"
]);
const ALLOWED_ATTACHMENT_EXTS = new Set([".jpg", ".jpeg", ".png", ".svg", ".pdf"]);
const ATTACHMENT_DB_NAME = "taskr_attachments_v1";
const ATTACHMENT_STORE = "attachments";

function autoGrowTextArea(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

const hasNativeStorage = typeof window !== "undefined" &&
  window.api &&
  typeof window.api.saveData === "function";
let storageMode = "local";
let fileCache = null;
let fileSaveTimer = null;
let attachmentCleanupRunning = false;
let attachmentCleanupTimer = null;

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

let attachmentDbPromise = null;
let attachmentUrlCache = new Map();
const editAttachmentState = {
  list: [],
  removed: new Set()
};

function openAttachmentDb() {
  if (attachmentDbPromise) return attachmentDbPromise;
  attachmentDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(ATTACHMENT_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(ATTACHMENT_STORE, { keyPath: "id" });
      store.createIndex("taskId", "taskId", { unique: false });
      store.createIndex("expiresAt", "expiresAt", { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return attachmentDbPromise;
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putAttachment(record) {
  const db = await openAttachmentDb();
  const tx = db.transaction(ATTACHMENT_STORE, "readwrite");
  const store = tx.objectStore(ATTACHMENT_STORE);
  const req = store.put(record);
  await requestToPromise(req);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function getAttachment(id) {
  const db = await openAttachmentDb();
  const tx = db.transaction(ATTACHMENT_STORE, "readonly");
  const store = tx.objectStore(ATTACHMENT_STORE);
  const req = store.get(id);
  const result = await requestToPromise(req);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function deleteAttachmentById(id) {
  const db = await openAttachmentDb();
  const tx = db.transaction(ATTACHMENT_STORE, "readwrite");
  const store = tx.objectStore(ATTACHMENT_STORE);
  const req = store.delete(id);
  await requestToPromise(req);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function deleteAttachmentsByTask(taskId) {
  const db = await openAttachmentDb();
  const tx = db.transaction(ATTACHMENT_STORE, "readwrite");
  const store = tx.objectStore(ATTACHMENT_STORE);
  const index = store.index("taskId");
  return new Promise((resolve, reject) => {
    const req = index.openCursor(IDBKeyRange.only(taskId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function isAllowedAttachment(file) {
  if (ALLOWED_ATTACHMENT_TYPES.has(file.type)) return true;
  const name = (file.name || "").toLowerCase();
  return Array.from(ALLOWED_ATTACHMENT_EXTS).some((ext) => name.endsWith(ext));
}

function validateAttachments(files, existingCount) {
  if (existingCount + files.length > MAX_ATTACHMENTS_PER_TASK) {
    return { ok: false, message: `添付は最大${MAX_ATTACHMENTS_PER_TASK}件までです。` };
  }
  for (const file of files) {
    if (!isAllowedAttachment(file)) {
      return { ok: false, message: "添付できるのは jpeg/jpg, png, svg, pdf のみです。" };
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      return { ok: false, message: "1ファイルの上限は1MBです。" };
    }
  }
  return { ok: true };
}

async function saveAttachments(taskId, files) {
  const now = Date.now();
  const metas = [];
  for (const file of files) {
    const id = uid();
    const record = {
      id,
      taskId,
      name: file.name,
      type: file.type,
      size: file.size,
      createdAt: now,
      expiresAt: now + ATTACHMENT_TTL,
      blob: file
    };
    await putAttachment(record);
    metas.push({
      id,
      name: file.name,
      type: file.type,
      size: file.size,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt
    });
  }
  return metas;
}

async function duplicateAttachments(original, newTaskId) {
  if (!original || !original.length) return [];
  const now = Date.now();
  const next = [];
  for (const item of original) {
    const record = await getAttachment(item.id);
    if (!record || !record.blob) continue;
    const newId = uid();
    const newRecord = {
      ...record,
      id: newId,
      taskId: newTaskId,
      createdAt: now,
      expiresAt: now + ATTACHMENT_TTL
    };
    await putAttachment(newRecord);
    next.push({
      id: newId,
      name: record.name,
      type: record.type,
      size: record.size,
      createdAt: newRecord.createdAt,
      expiresAt: newRecord.expiresAt
    });
  }
  return next;
}

async function cleanupExpiredAttachments() {
  const db = await openAttachmentDb();
  const tx = db.transaction(ATTACHMENT_STORE, "readwrite");
  const store = tx.objectStore(ATTACHMENT_STORE);
  const now = Date.now();
  const expiredIds = new Set();
  return new Promise((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      if (cursor.value && cursor.value.expiresAt && cursor.value.expiresAt <= now) {
        expiredIds.add(cursor.value.id);
        cursor.delete();
      }
      cursor.continue();
    };
    tx.oncomplete = () => {
      if (expiredIds.size === 0) return resolve(false);
      const tasks = loadTasks();
      let changed = false;
      tasks.forEach((task) => {
        if (!task.attachments) return;
        const before = task.attachments.length;
        task.attachments = task.attachments.filter((a) => !expiredIds.has(a.id));
        if (task.attachments.length !== before) changed = true;
      });
      if (changed) saveTasks(tasks);
      resolve(changed);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function loadLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveLocal(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function defaultFileCache() {
  return {
    [STORAGE.tasks]: [],
    [STORAGE.projects]: [],
    [STORAGE.projectsTrash]: [],
    [STORAGE.todos]: [],
    [STORAGE.todosTrash]: [],
    [STORAGE.doneTrash]: []
  };
}

function load(key, fallback) {
  if (storageMode === "file" && fileCache) {
    const value = fileCache[key];
    return value !== undefined ? value : fallback;
  }
  return loadLocal(key, fallback);
}

function queueFileSave() {
  if (storageMode !== "file" || !hasNativeStorage || !fileCache) return;
  if (fileSaveTimer) clearTimeout(fileSaveTimer);
  fileSaveTimer = setTimeout(async () => {
    await window.api.saveData(fileCache);
  }, FILE_SAVE_DELAY);
}

function save(key, value) {
  if (storageMode === "file" && fileCache) {
    fileCache[key] = value;
    queueFileSave();
    return;
  }
  saveLocal(key, value);
}

function buildLocalSnapshot() {
  return {
    [STORAGE.tasks]: loadLocal(STORAGE.tasks, []),
    [STORAGE.projects]: loadLocal(STORAGE.projects, []),
    [STORAGE.projectsTrash]: loadLocal(STORAGE.projectsTrash, []),
    [STORAGE.todos]: loadLocal(STORAGE.todos, []),
    [STORAGE.todosTrash]: loadLocal(STORAGE.todosTrash, []),
    [STORAGE.doneTrash]: loadLocal(STORAGE.doneTrash, [])
  };
}

async function loadFileSnapshot() {
  if (!hasNativeStorage) return null;
  const res = await window.api.loadData();
  if (!res || !res.ok) return null;
  return res.data || defaultFileCache();
}

function loadTasks() {
  return load(STORAGE.tasks, []);
}

function saveTasks(tasks) {
  save(STORAGE.tasks, tasks);
}

function buildActiveExportPayload() {
  const tasks = loadTasks().filter((t) => !t.done);
  const cleaned = tasks.map((t) => ({
    id: t.id,
    type: t.type === "private" ? "private" : "work",
    project: typeof t.project === "string" ? t.project : "",
    todo: typeof t.todo === "string" ? t.todo : "",
    note: typeof t.note === "string" ? t.note : "",
    dueDate: typeof t.dueDate === "string" ? t.dueDate : "",
    dueTime: typeof t.dueTime === "string" ? t.dueTime : "",
    createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
    updatedAt: Number.isFinite(t.updatedAt) ? t.updatedAt : Date.now()
  }));
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    note: "attachments_not_included",
    tasks: cleaned
  };
}

function buildSingleTaskPayload(task) {
  const cleaned = {
    id: task.id,
    type: task.type === "private" ? "private" : "work",
    project: typeof task.project === "string" ? task.project : "",
    todo: typeof task.todo === "string" ? task.todo : "",
    note: typeof task.note === "string" ? task.note : "",
    dueDate: typeof task.dueDate === "string" ? task.dueDate : "",
    dueTime: typeof task.dueTime === "string" ? task.dueTime : "",
    createdAt: Number.isFinite(task.createdAt) ? task.createdAt : Date.now(),
    updatedAt: Number.isFinite(task.updatedAt) ? task.updatedAt : Date.now()
  };
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    note: "attachments_not_included",
    tasks: [cleaned]
  };
}

function createExportFile(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const file = new File([blob], filename, { type: "application/json" });
  return { blob, file };
}

function getExportCapabilities(file) {
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  const canSave = !!(window.showSaveFilePicker && window.isSecureContext);
  return { canShare, canSave };
}

async function shareJsonFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: "TASKR Active Tasks"
      });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  alert("共有に対応していない環境です。");
}

async function saveJsonFile(blob, filename) {
  if (window.showSaveFilePicker && window.isSecureContext) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: "JSON",
          accept: { "application/json": [".json"] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  alert("保存先の選択に対応していない環境です。");
}

function downloadJsonFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function extractImportedTasks(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.tasks)) return data.tasks;
  return null;
}

function sanitizeImportedTask(raw, existingIds) {
  if (!raw || typeof raw !== "object") return null;
  const now = Date.now();
  let id = typeof raw.id === "string" && raw.id.trim() ? raw.id : uid();
  if (existingIds.has(id)) id = uid();

  return {
    id,
    type: raw.type === "private" ? "private" : "work",
    project: typeof raw.project === "string" ? raw.project : "",
    todo: typeof raw.todo === "string" ? raw.todo : "",
    note: typeof raw.note === "string" ? raw.note : "",
    dueDate: typeof raw.dueDate === "string" ? raw.dueDate : "",
    dueTime: typeof raw.dueTime === "string" ? raw.dueTime : "",
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
    done: false,
    completedAt: null,
    attachments: []
  };
}

async function importActiveTasksFromFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    alert("JSONの読み込みに失敗しました。");
    return;
  }

  const list = extractImportedTasks(data);
  if (!list || list.length === 0) {
    alert("読み込める案件がありません。");
    return;
  }

  const existing = loadTasks();
  const existingIds = new Set(existing.map((t) => t.id));
  const incoming = list.map((t) => sanitizeImportedTask(t, existingIds)).filter(Boolean);

  if (incoming.length === 0) {
    alert("読み込める案件がありません。");
    return;
  }

  saveTasks(existing.concat(incoming));
  render();
  alert(`案件を${incoming.length}件読み込みました。添付ファイルは引き継がれません。`);
}

function loadHistory(key) {
  return load(key, []);
}

function saveHistory(key, items) {
  save(key, items);
}

function addToHistory(list, value) {
  if (!value) return list;
  const exists = list.some((item) => item.toLowerCase() === value.toLowerCase());
  if (!exists) list.unshift(value);
  return list;
}

function normalizeTrash(list) {
  return list.map((item) => {
    if (typeof item === "string") {
      return { value: item, deletedAt: Date.now() };
    }
    return item;
  });
}

function normalizeDoneTrash(list) {
  return list.map((item) => {
    if (item && item.task) return item;
    if (item && item.id) return { task: item, deletedAt: Date.now() };
    return null;
  }).filter(Boolean);
}

function purgeTrash() {
  const now = Date.now();
  const projectsTrash = normalizeTrash(loadHistory(STORAGE.projectsTrash))
    .filter((item) => now - item.deletedAt < HISTORY_TRASH_TTL);
  const todosTrash = normalizeTrash(loadHistory(STORAGE.todosTrash))
    .filter((item) => now - item.deletedAt < HISTORY_TRASH_TTL);
  const doneTrash = normalizeDoneTrash(loadHistory(STORAGE.doneTrash))
    .filter((item) => now - item.deletedAt < DONE_TRASH_TTL);

  saveHistory(STORAGE.projectsTrash, projectsTrash);
  saveHistory(STORAGE.todosTrash, todosTrash);
  saveHistory(STORAGE.doneTrash, doneTrash);
}

function scheduleTrashCleanup() {
  if (trashCleanupTimer) clearTimeout(trashCleanupTimer);
  const now = Date.now();
  const projectTrash = normalizeTrash(loadHistory(STORAGE.projectsTrash));
  const todoTrash = normalizeTrash(loadHistory(STORAGE.todosTrash));
  const doneTrash = normalizeDoneTrash(loadHistory(STORAGE.doneTrash));
  const all = [
    ...projectTrash.map((item) => ({ expiresAt: item.deletedAt + HISTORY_TRASH_TTL })),
    ...todoTrash.map((item) => ({ expiresAt: item.deletedAt + HISTORY_TRASH_TTL })),
    ...doneTrash.map((item) => ({ expiresAt: item.deletedAt + DONE_TRASH_TTL }))
  ];
  if (!all.length) return;
  const nextExpire = Math.min(...all.map((item) => item.expiresAt));
  const delay = Math.max(0, nextExpire - now);
  trashCleanupTimer = setTimeout(() => {
    purgeTrash();
    render();
  }, delay);
}

function dateFromInput(value, timeValue = "") {
  if (!value) return null;
  const time = timeValue ? `${timeValue}:00` : "00:00:00";
  return new Date(`${value}T${time}`);
}

function toLocalDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
  const first = new Date(year, monthIndex, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  return new Date(year, monthIndex, day);
}

function vernalEquinoxDay(year) {
  const base = 20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4);
  return Math.floor(base);
}

function autumnalEquinoxDay(year) {
  const base = 23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4);
  return Math.floor(base);
}

function getHolidaySet(year) {
  const holidays = new Set();
  const add = (y, m, d) => {
    holidays.add(toLocalDateKey(new Date(y, m - 1, d)));
  };

  add(year, 1, 1);
  add(year, 2, 11);
  if (year >= 2020) add(year, 2, 23);
  add(year, 4, 29);
  add(year, 5, 3);
  add(year, 5, 4);
  add(year, 5, 5);
  add(year, 8, 11);
  add(year, 11, 3);
  add(year, 11, 23);

  const comingOfAge = nthWeekdayOfMonth(year, 0, 1, 2);
  add(year, 1, comingOfAge.getDate());
  const marineDay = nthWeekdayOfMonth(year, 6, 1, 3);
  add(year, 7, marineDay.getDate());
  const respectForAged = nthWeekdayOfMonth(year, 8, 1, 3);
  add(year, 9, respectForAged.getDate());
  const sportsDay = nthWeekdayOfMonth(year, 9, 1, 2);
  add(year, 10, sportsDay.getDate());

  add(year, 3, vernalEquinoxDay(year));
  add(year, 9, autumnalEquinoxDay(year));

  const initial = Array.from(holidays).map((key) => dateFromInput(key));
  initial.forEach((date) => {
    if (date.getDay() !== 0) return;
    const substitute = new Date(date);
    do {
      substitute.setDate(substitute.getDate() + 1);
    } while (holidays.has(toLocalDateKey(substitute)));
    holidays.add(toLocalDateKey(substitute));
  });

  const cursor = new Date(year, 0, 1);
  while (cursor.getFullYear() === year) {
    const key = toLocalDateKey(cursor);
    if (!holidays.has(key)) {
      const prev = new Date(cursor);
      prev.setDate(prev.getDate() - 1);
      const next = new Date(cursor);
      next.setDate(next.getDate() + 1);
      if (holidays.has(toLocalDateKey(prev)) && holidays.has(toLocalDateKey(next))) {
        holidays.add(key);
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return holidays;
}

function todayMidnight() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function diffDays(target) {
  if (!target) return null;
  const ms = target.getTime() - todayMidnight().getTime();
  return Math.floor(ms / 86400000);
}

function riskLabel(dueDate) {
  if (!dueDate) return { text: "未定", className: "risk-normal" };
  const days = diffDays(dateFromInput(dueDate));
  if (days === 0) return { text: "今日", className: "risk-urgent" };
  if (days === 1) return { text: "明日", className: "risk-soon" };
  if (days === 2) return { text: "明後日", className: "risk-soon" };
  if (days > 2) return { text: `${days}日後`, className: "risk-normal" };
  return { text: `${Math.abs(days)}日前`, className: "risk-past" };
}

function formatDate(dueDate, dueTime = "") {
  if (!dueDate) return "未定";
  const date = dateFromInput(dueDate, dueTime);
  const options = {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  };
  if (dueTime) {
    options.hour = "2-digit";
    options.minute = "2-digit";
  }
  return new Intl.DateTimeFormat("ja-JP", options).format(date);
}

function remindText(dueDate, dueTime = "") {
  if (!dueDate) return "-";
  const target = dateFromInput(dueDate, dueTime);
  const diff = Math.max(0, target.getTime() - Date.now());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${days}日 ${hours}時 ${mins}分`;
}

function sortByDue(a, b) {
  const aDue = a.dueDate || "9999-12-31";
  const bDue = b.dueDate || "9999-12-31";
  const aTime = a.dueTime ? `T${a.dueTime}` : "T24:00";
  const bTime = b.dueTime ? `T${b.dueTime}` : "T24:00";
  const aKey = `${aDue}${aTime}`;
  const bKey = `${bDue}${bTime}`;
  if (aKey === bKey) return a.createdAt - b.createdAt;
  return aKey.localeCompare(bKey);
}

function sortByProject(a, b) {
  const ap = a.project.toLowerCase();
  const bp = b.project.toLowerCase();
  if (ap === bp) return sortByDue(a, b);
  return ap.localeCompare(bp);
}

function sortDoneByTime(a, b) {
  return (b.completedAt || 0) - (a.completedAt || 0);
}

function applyActiveSort(tasks) {
  const list = [...tasks];
  if (state.sortActive === "project") list.sort(sortByProject);
  else if (state.sortActive === "created") list.sort((a, b) => a.createdAt - b.createdAt);
  else list.sort(sortByDue);
  return list;
}

function applyDoneSort(tasks) {
  const list = [...tasks];
  if (state.sortDone === "project") list.sort(sortByProject);
  else list.sort(sortDoneByTime);
  return list;
}

function renderHistory() {
  const projects = loadHistory(STORAGE.projects);
  const projectTrash = normalizeTrash(loadHistory(STORAGE.projectsTrash));
  const todos = loadHistory(STORAGE.todos);
  const todoTrash = normalizeTrash(loadHistory(STORAGE.todosTrash));

  els.projectSelect.innerHTML = "<option value=\"\">過去の案件から選ぶ</option>" +
    projects.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
  els.todoSelect.innerHTML = "<option value=\"\">過去のTODOから選ぶ</option>" +
    todos.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

  els.projectHistory.innerHTML = projects.map((p, idx) => {
    return `<li class="history-item" data-history="project" data-index="${idx}">
      <input type="checkbox" data-history="project" data-index="${idx}">
      <span class="history-text">${escapeHtml(p)}</span>
      <input class="history-edit input is-hidden" type="text" value="${escapeHtml(p)}" maxlength="80">
      <button class="btn" data-action="edit-history" data-history="project" data-index="${idx}">編集</button>
    </li>`;
  }).join("");

  els.projectTrash.innerHTML = projectTrash.map((p, idx) => {
    return `<li class="history-item">
      <span class="history-text">${escapeHtml(p.value)}</span>
      <button class="btn" data-action="restore-history" data-history="project" data-index="${idx}">戻す</button>
    </li>`;
  }).join("");

  els.todoHistory.innerHTML = todos.map((t, idx) => {
    return `<li class="history-item" data-history="todo" data-index="${idx}">
      <input type="checkbox" data-history="todo" data-index="${idx}">
      <span class="history-text">${escapeHtml(t)}</span>
      <input class="history-edit input is-hidden" type="text" value="${escapeHtml(t)}" maxlength="80">
      <button class="btn" data-action="edit-history" data-history="todo" data-index="${idx}">編集</button>
    </li>`;
  }).join("");

  els.todoTrash.innerHTML = todoTrash.map((t, idx) => {
    return `<li class="history-item">
      <span class="history-text">${escapeHtml(t.value)}</span>
      <button class="btn" data-action="restore-history" data-history="todo" data-index="${idx}">戻す</button>
    </li>`;
  }).join("");
}

function renderAttachmentList(attachments) {
  if (!attachments || !attachments.length) return "";
  const items = attachments.map((item) => {
    return `<li><a class="attachment-link" data-attachment-id="${item.id}" data-attachment-name="${escapeHtml(item.name)}">${escapeHtml(item.name)}</a></li>`;
  }).join("");
  return `<ul class="attachment-list">${items}</ul>`;
}

function getUniqueProjects(tasks) {
  const set = new Set();
  tasks.forEach((t) => {
    const name = (t.project || "").trim();
    if (name) set.add(name);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
}

function renderActiveProjectOptions(tasks) {
  if (!els.activeProjectFilter) return;
  const projects = getUniqueProjects(tasks);
  if (state.activeProjectFilter !== "all" && !projects.includes(state.activeProjectFilter)) {
    state.activeProjectFilter = "all";
  }
  const options = [`<option value="all">すべての案件</option>`];
  if (projects.length) {
    options.push(`<option value="" disabled>──────────</option>`);
    projects.forEach((name) => {
      options.push(`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
    });
  }
  els.activeProjectFilter.innerHTML = options.join("");
  els.activeProjectFilter.value = state.activeProjectFilter;
}

function renderActiveList(tasks) {
  const typeFiltered = tasks.filter((t) => {
    if (t.done) return false;
    if (t.type === "work" && !state.filters.active.work) return false;
    if (t.type === "private" && !state.filters.active.private) return false;
    return true;
  });

  renderActiveProjectOptions(typeFiltered);
  const filtered = state.activeProjectFilter === "all"
    ? typeFiltered
    : typeFiltered.filter((t) => (t.project || "").trim() === state.activeProjectFilter);

  const sorted = applyActiveSort(filtered);
  els.activeList.innerHTML = sorted.map((t) => {
    const risk = riskLabel(t.dueDate);
    const attachments = renderAttachmentList(t.attachments);
    const hasNote = Boolean(t.note && t.note.trim());
    const hasAttachments = Boolean(t.attachments && t.attachments.length);
    const noteClass = !hasNote && !hasAttachments ? "note-empty" : "";
    const noteText = hasNote ? renderNoteLines(t) : (hasAttachments ? "" : "内 / 備 / 注なし");
    return `<tr>
      <td class="col-mini badge-cell ${t.type}"><span class="badge ${t.type}">${t.type === "work" ? "W" : "P"}</span></td>
      <td class="col-mini"><span class="risk-label ${risk.className}">${risk.text}</span></td>
      <td><span class="project-name ${t.type}">${escapeHtml(t.project)}</span></td>
      <td><span class="todo-text">${escapeHtml(t.todo)}</span></td>
      <td class="note-cell ${noteClass}"><div class="note-text">${noteText}</div>${attachments}</td>
      <td class="col-due">
        <div class="due-stack">
          <div class="due-date">${formatDate(t.dueDate, t.dueTime)}</div>
          <div class="action-row">
            <button class="btn is-minus" data-action="reschedule" data-days="-1" data-id="${t.id}">-1</button>
            <button class="btn" data-action="reschedule" data-days="1" data-id="${t.id}">+1</button>
            <button class="btn" data-action="reschedule" data-days="2" data-id="${t.id}">+2</button>
            <button class="btn" data-action="reschedule" data-days="3" data-id="${t.id}">+3</button>
          </div>
        </div>
      </td>
      <td class="col-actions">
        <div class="action-grid">
          <div class="action-row top">
            <button class="btn" data-action="edit" data-id="${t.id}">編集</button>
            <button class="btn is-duplicate" data-action="duplicate" data-id="${t.id}">複製</button>
          </div>
          <div class="action-row bottom">
            <button class="btn" data-action="share" data-id="${t.id}">共有</button>
            <button class="btn dark" data-action="complete" data-id="${t.id}">完了</button>
          </div>
        </div>
      </td>
    </tr>`;
  }).join("");
}

function renderDoneList(tasks) {
  const done = tasks.filter((t) => {
    if (!t.done) return false;
    if (t.type === "work" && !state.filters.done.work) return false;
    if (t.type === "private" && !state.filters.done.private) return false;
    return true;
  });
  const sorted = applyDoneSort(done);
  els.doneList.innerHTML = sorted.map((t) => {
    const risk = riskLabel(t.dueDate);
    const attachments = renderAttachmentList(t.attachments);
    const hasNote = Boolean(t.note && t.note.trim());
    const hasAttachments = Boolean(t.attachments && t.attachments.length);
    const noteClass = !hasNote && !hasAttachments ? "note-empty" : "";
    const noteText = hasNote ? renderNoteLines(t) : (hasAttachments ? "" : "内 / 備 / 注なし");
    return `<tr>
      <td class="col-mini"><input type="checkbox" class="done-check" data-id="${t.id}"></td>
      <td class="col-mini badge-cell ${t.type}"><span class="badge ${t.type}">${t.type === "work" ? "W" : "P"}</span></td>
      <td class="col-mini"><span class="risk-label ${risk.className}">${risk.text}</span></td>
      <td><span class="project-name ${t.type}">${escapeHtml(t.project)}</span></td>
      <td><span class="todo-text">${escapeHtml(t.todo)}</span></td>
      <td class="note-cell ${noteClass}"><div class="note-text">${noteText}</div>${attachments}</td>
      <td class="col-due">${formatDate(t.dueDate, t.dueTime)}</td>
      <td class="col-actions">
        <div class="action-row">
          <button class="btn" data-action="restore" data-id="${t.id}">戻す</button>
          <button class="btn" data-action="duplicate" data-id="${t.id}">複製</button>
          <button class="btn dark" data-action="delete" data-id="${t.id}">削除</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

function renderDoneTrash() {
  const trash = normalizeDoneTrash(loadHistory(STORAGE.doneTrash));
  els.doneTrash.innerHTML = trash.map((item, idx) => {
    const t = item.task;
    if (!t) return "";
    const project = escapeHtml(t.project);
    const todo = escapeHtml(t.todo);
    const shouldBreak = (t.project && t.project.length >= 40) || (t.todo && t.todo.length >= 40);
    const separator = shouldBreak ? "<br />" : " / ";
    return `<li class="history-item">
      <span><span class="project-name ${t.type}">${project}</span>${separator}<span class="todo-text">${todo}</span></span>
      <button class="btn" data-action="restore-done" data-index="${idx}">戻す</button>
    </li>`;
  }).join("");
}

function renderCalendar(tasks) {
  const year = state.calendarYear;
  const month = state.calendarMonth;
  const holidaySet = getHolidaySet(year);
  const weekdayKanji = ["月", "火", "水", "木", "金", "土", "日"];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeek = (firstDay.getDay() + 6) % 7;
  const totalDays = lastDay.getDate();

  els.calendarTitle.textContent = `${year}年/ ${month + 1}月`;

  const cells = [];
  for (let i = 0; i < startWeek; i += 1) {
    cells.push(`<div class="calendar-cell"></div>`);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const date = new Date(year, month, day);
    const dateKey = toLocalDateKey(date);
    const dow = weekdayKanji[(date.getDay() + 6) % 7];
    const isHoliday = date.getDay() === 0 || holidaySet.has(dateKey);
    const isSaturday = date.getDay() === 6;
    const dayTasks = tasks.filter((t) => !t.done && t.dueDate === dateKey);
    const list = dayTasks.map((t) => {
      const project = truncateText(t.project, 8);
      const todo = truncateText(t.todo, 8);
      return `<li class="calendar-item ${t.type}" data-id="${t.id}">
        <div class="calendar-task project-name ${t.type}" data-id="${t.id}">${escapeHtml(project)}</div>
        <div class="calendar-sep"></div>
        <div class="calendar-task todo-text">${escapeHtml(todo)}</div>
      </li>`;
    }).join("");

    cells.push(`<div class="calendar-cell">
      <div class="calendar-day"><span class="calendar-date">${day}</span><span class="calendar-dow ${isHoliday ? "is-holiday" : isSaturday ? "is-saturday" : ""}">${dow}</span></div>
      <ul class="calendar-list">${list}</ul>
    </div>`);
  }

  els.calendarGrid.innerHTML = cells.join("");

  els.calendarUndated.innerHTML = "";
  const undatedSection = els.calendarUndated?.closest(".calendar-undated");
  if (undatedSection) undatedSection.classList.add("is-hidden");
}

function render() {
  purgeTrash();
  if (!attachmentCleanupRunning) {
    attachmentCleanupRunning = true;
    cleanupExpiredAttachments()
      .then((changed) => {
        attachmentCleanupRunning = false;
        if (changed) render();
      })
      .catch(() => {
        attachmentCleanupRunning = false;
      });
  }
  const tasks = loadTasks();
  updateFilterButtons();
  renderHistory();
  renderActiveList(tasks);
  renderDoneList(tasks);
  renderDoneTrash();
  renderCalendar(tasks);
  els.activeListView.classList.toggle("is-hidden", state.view !== "list");
  els.calendarView.classList.toggle("is-hidden", state.view !== "calendar");
  els.toggleView.textContent = state.view === "list" ? "カレンダー" : "リストで表示";
  scheduleTrashCleanup();
  updateAttachmentLinks();
}

function startAttachmentCleanupTimer() {
  if (attachmentCleanupTimer) return;
  attachmentCleanupTimer = setInterval(() => {
    if (attachmentCleanupRunning) return;
    attachmentCleanupRunning = true;
    cleanupExpiredAttachments()
      .then((changed) => {
        attachmentCleanupRunning = false;
        if (changed) render();
      })
      .catch(() => {
        attachmentCleanupRunning = false;
      });
  }, 1000);
}

async function updateAttachmentLinks() {
  const links = Array.from(document.querySelectorAll(".attachment-link"));
  const needed = new Set();
  links.forEach((link) => {
    const id = link.dataset.attachmentId;
    if (!id) return;
    needed.add(id);
    if (attachmentUrlCache.has(id)) {
      link.href = attachmentUrlCache.get(id);
    } else {
      link.href = "#";
    }
    link.target = "_blank";
    link.rel = "noopener";
    if (link.dataset.attachmentName) link.title = link.dataset.attachmentName;
  });

  for (const [id, url] of attachmentUrlCache.entries()) {
    if (!needed.has(id)) {
      URL.revokeObjectURL(url);
      attachmentUrlCache.delete(id);
    }
  }

  for (const link of links) {
    const id = link.dataset.attachmentId;
    if (!id || attachmentUrlCache.has(id)) continue;
    let record = null;
    try {
      record = await getAttachment(id);
    } catch {
      record = null;
    }
    if (!record || !record.blob) continue;
    const url = URL.createObjectURL(record.blob);
    attachmentUrlCache.set(id, url);
    link.href = url;
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function linkifyText(value) {
  const text = value || "";
  if (!text) return "";
  const urlRegex = /https?:\/\/[^\s<>"']+/gi;
  let result = "";
  let lastIndex = 0;
  let match = null;
  const maxUrlLength = 20;

  while ((match = urlRegex.exec(text)) !== null) {
    const rawUrl = match[0];
    const offset = match.index;
    let url = rawUrl;
    let suffix = "";
    const trailing = url.match(/[)\].,!?;:}]+$/);
    if (trailing) {
      suffix = trailing[0];
      url = url.slice(0, -suffix.length);
    }

    result += escapeHtml(text.slice(lastIndex, offset));
    if (!url) {
      result += escapeHtml(rawUrl);
    } else {
      const safeHref = encodeURI(url).replace(/"/g, "%22");
      const displayUrl = url.length > maxUrlLength ? `${url.slice(0, maxUrlLength)}…` : url;
      result += `<a class="note-link" href="${safeHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayUrl)}</a>${escapeHtml(suffix)}`;
    }
    lastIndex = offset + rawUrl.length;
  }

  result += escapeHtml(text.slice(lastIndex));
  return result;
}

function renderNoteLines(task) {
  const text = task?.note || "";
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  const items = lines.map((line, index) => {
    const match = line.match(/^\s*(?:\[( |x|X)\]|[☐☑])\s*(.*)$/);
    if (match) {
      const marker = match[0].trim().startsWith("☑") || match[1]?.toLowerCase() === "x";
      const checked = marker ? "checked" : "";
      const content = match[2] || "";
      const html = linkifyText(content);
      return `<label class="note-line-row note-line"><input type="checkbox" class="note-check" data-id="${task.id}" data-line-index="${index}" ${checked}><span class="note-line-text">${html}</span></label>`;
    }
    if (!line.trim()) return `<div class="note-line-row">&nbsp;</div>`;
    return `<div class="note-line-row">${linkifyText(line)}</div>`;
  });
  return items.join("");
}

function truncateText(value, maxLength) {
  const text = value || "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

function enterHistoryEdit(itemEl) {
  const input = itemEl.querySelector(".history-edit");
  const text = itemEl.querySelector(".history-text");
  if (!input || !text) return;
  itemEl.classList.add("is-editing");
  input.classList.remove("is-hidden");
  text.classList.add("is-hidden");
  input.focus();
  input.select();
}

function exitHistoryEdit(itemEl, { save }) {
  const input = itemEl.querySelector(".history-edit");
  const text = itemEl.querySelector(".history-text");
  if (!input || !text) return;
  if (save) {
    const value = input.value.trim();
    if (!value) {
      input.value = text.textContent || "";
      return;
    }
    const historyType = itemEl.dataset.history;
    const index = Number(itemEl.dataset.index);
    const key = historyType === "project" ? STORAGE.projects : STORAGE.todos;
    const list = loadHistory(key);
    if (list[index] !== undefined) {
      list[index] = value;
      saveHistory(key, list.filter(Boolean));
      text.textContent = value;
    }
  } else {
    input.value = text.textContent || "";
  }
  itemEl.classList.remove("is-editing");
  input.classList.add("is-hidden");
  text.classList.remove("is-hidden");
}

function updateTypeTabs() {
  els.typeTabs.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.type === state.newType);
  });
}

function updateFilterButtons() {
  els.filterButtons.forEach((btn) => {
    const key = btn.dataset.filter;
    const scope = btn.dataset.scope || "active";
    btn.classList.toggle("is-active", state.filters[scope][key]);
  });
}

function rescheduleTask(tasks, id, days) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return tasks;
  const base = task.dueDate ? dateFromInput(task.dueDate, task.dueTime) : new Date();
  const target = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  target.setDate(target.getDate() + days);
  task.dueDate = toLocalDateKey(target);
  task.updatedAt = Date.now();
  return tasks;
}

els.typeTabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    state.newType = btn.dataset.type;
    updateTypeTabs();
  });
});

els.projectSelect.addEventListener("change", (e) => {
  if (e.target.value) {
    els.projectInput.value = e.target.value;
    autoGrowTextArea(els.projectInput);
  }
});

els.todoSelect.addEventListener("change", (e) => {
  if (e.target.value) {
    els.todoInput.value = e.target.value;
    autoGrowTextArea(els.todoInput);
  }
});

function bindDateRow(row, input) {
  if (!row || !input) return;
  row.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    input.focus();
    if (typeof input.showPicker === "function") {
      input.showPicker();
    }
  });
}

bindDateRow(els.dueRow, els.dueInput);
bindDateRow(els.editDueRow, els.editDue);

function setupTimeToggle({ dateInput, timeRow, timeInput, toggleButton }) {
  if (!dateInput || !timeRow || !timeInput || !toggleButton) return;

  const updateLabel = () => {
    toggleButton.textContent = timeRow.classList.contains("is-hidden")
      ? "時間を指定"
      : "時間を削除";
  };

  const hideTime = () => {
    timeRow.classList.add("is-hidden");
    timeInput.value = "";
    updateLabel();
  };

  toggleButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (timeRow.classList.contains("is-hidden")) {
      if (!dateInput.value) {
        dateInput.focus();
        if (typeof dateInput.showPicker === "function") {
          dateInput.showPicker();
        }
        return;
      }
      timeRow.classList.remove("is-hidden");
      if (!timeInput.value) timeInput.value = "09:00";
      timeInput.focus();
      if (typeof timeInput.showPicker === "function") {
        timeInput.showPicker();
      }
      updateLabel();
      return;
    }
    hideTime();
  });

  dateInput.addEventListener("change", () => {
    if (!dateInput.value) hideTime();
  });

  updateLabel();
}

setupTimeToggle({
  dateInput: els.dueInput,
  timeRow: els.dueTimeRow,
  timeInput: els.dueTimeInput,
  toggleButton: els.dueTimeToggle
});

setupTimeToggle({
  dateInput: els.editDue,
  timeRow: els.editDueTimeRow,
  timeInput: els.editDueTime,
  toggleButton: els.editDueTimeToggle
});

[els.projectInput, els.todoInput, els.editProject, els.editTodo].forEach((input) => {
  if (!input) return;
  autoGrowTextArea(input);
  input.addEventListener("input", () => autoGrowTextArea(input));
});

function createUndoController(textarea, button) {
  if (!textarea || !button) return null;
  const stack = [textarea.value || ""];
  const pushState = () => {
    const value = textarea.value || "";
    const last = stack[stack.length - 1];
    if (value === last) return;
    stack.push(value);
    if (stack.length > 50) stack.shift();
  };
  textarea.addEventListener("input", pushState);
  button.addEventListener("click", () => {
    if (stack.length <= 1) return;
    stack.pop();
    const prev = stack[stack.length - 1] ?? "";
    textarea.value = prev;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = prev.length;
    autoGrowTextArea(textarea);
  });
  return { stack, pushState };
}

const noteUndo = createUndoController(els.noteInput, els.noteUndo);
const editNoteUndo = createUndoController(els.editNote, els.editNoteUndo);

function applyNoteCheckboxes(text, start, end) {
  const lines = text.split(/\r?\n/);
  const lineStarts = [];
  let pos = 0;
  lines.forEach((line, idx) => {
    lineStarts[idx] = pos;
    pos += line.length + 1;
  });

  const findLineIndex = (offset) => {
    for (let i = 0; i < lineStarts.length; i += 1) {
      const nextStart = i + 1 < lineStarts.length ? lineStarts[i + 1] : text.length + 1;
      if (offset >= lineStarts[i] && offset < nextStart) return i;
    }
    return lineStarts.length - 1;
  };

  const startLine = findLineIndex(start);
  const endLine = start === end ? startLine : findLineIndex(end);
  let addedBeforeStart = 0;
  let addedBeforeEnd = 0;

  for (let i = startLine; i <= endLine; i += 1) {
    const line = lines[i];
    if (line.match(/^\s*(?:\[( |x|X)\]|[☐☑])\s*/)) continue;
    lines[i] = `☐ ${line}`;
    if (i === startLine) addedBeforeStart += 2;
    addedBeforeEnd += 2;
  }

  const nextText = lines.join("\n");
  const nextStart = start + (start === end ? addedBeforeStart : 0);
  const nextEnd = end + addedBeforeEnd;
  return { text: nextText, start: nextStart, end: nextEnd };
}

const handleNoteAddCheckbox = (textarea) => {
  if (!textarea) return;
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? start;
  const { text, start: nextStart, end: nextEnd } = applyNoteCheckboxes(textarea.value, start, end);
  textarea.value = text;
  textarea.focus();
  textarea.setSelectionRange(nextStart, nextEnd);
  autoGrowTextArea(textarea);
};

els.noteAddCheckbox?.addEventListener("click", () => {
  handleNoteAddCheckbox(els.noteInput);
  noteUndo?.pushState();
});
els.editNoteAddCheckbox?.addEventListener("click", () => {
  handleNoteAddCheckbox(els.editNote);
  editNoteUndo?.pushState();
});

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const tasks = loadTasks();
  const projects = loadHistory(STORAGE.projects);
  const todos = loadHistory(STORAGE.todos);

  const files = Array.from(els.noteAttachments?.files || []);
  const validation = validateAttachments(files, 0);
  if (!validation.ok) {
    alert(validation.message);
    return;
  }

  const task = {
    id: uid(),
    type: state.newType,
    project: els.projectInput.value.trim(),
    todo: els.todoInput.value.trim(),
    note: els.noteInput.value.trim(),
    dueDate: els.dueInput.value || "",
    dueTime: els.dueInput.value ? (els.dueTimeInput.value || "") : "",
    done: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
    attachments: []
  };

  if (files.length) {
    try {
      task.attachments = await saveAttachments(task.id, files);
    } catch {
      alert("添付の保存に失敗しました。");
      return;
    }
  }

  tasks.push(task);
  saveTasks(tasks);

  saveHistory(STORAGE.projects, addToHistory(projects, task.project));
  saveHistory(STORAGE.todos, addToHistory(todos, task.todo));

  els.form.reset();
  if (els.noteAttachments) els.noteAttachments.value = "";
  if (els.dueTimeInput) els.dueTimeInput.value = "";
  if (els.dueTimeRow) els.dueTimeRow.classList.add("is-hidden");
  if (els.dueTimeToggle) els.dueTimeToggle.textContent = "時間を指定";
  autoGrowTextArea(els.projectInput);
  autoGrowTextArea(els.todoInput);
  render();
});

els.filterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.filter;
    const scope = btn.dataset.scope || "active";
    state.filters[scope][key] = !state.filters[scope][key];
    updateFilterButtons();
    render();
  });
});

els.sortButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const scope = btn.closest(".sorts").dataset.scope;
    const value = btn.dataset.sort;
    if (scope === "active") state.sortActive = value;
    if (scope === "done") state.sortDone = value;
    btn.parentElement.querySelectorAll(".sort-btn").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    render();
  });
});

els.toggleView.addEventListener("click", () => {
  state.view = state.view === "list" ? "calendar" : "list";
  render();
});

els.activeProjectFilter?.addEventListener("change", (e) => {
  state.activeProjectFilter = e.target.value || "all";
  render();
});

if (els.exportActiveJson) {
  let exportPayload = null;
  let exportFilename = "";
  let exportBlob = null;
  let exportFile = null;

  const openExportDialog = () => {
    if (!els.exportDialog) return;
    if (els.exportSupportNote) {
      const note = window.isSecureContext
        ? "共有・保存先選択・ダウンロードから選べます。"
        : "file:// で開いている場合は保存先選択が使えないことがあります。";
      els.exportSupportNote.textContent = note;
    }
    if (els.exportShareBtn) els.exportShareBtn.classList.toggle("is-hidden", !exportFile || !getExportCapabilities(exportFile).canShare);
    if (els.exportSaveBtn) els.exportSaveBtn.classList.toggle("is-hidden", !exportFile || !getExportCapabilities(exportFile).canSave);
    if (els.exportDownloadBtn) els.exportDownloadBtn.classList.remove("is-hidden");
    els.exportDialog.showModal();
  };

  els.exportActiveJson.addEventListener("click", () => {
    exportPayload = buildActiveExportPayload();
    const dateKey = new Date().toISOString().slice(0, 10);
    exportFilename = `taskr-active-${dateKey}.json`;
    const created = createExportFile(exportPayload, exportFilename);
    exportBlob = created.blob;
    exportFile = created.file;
    openExportDialog();
  });

  if (els.exportShareBtn) {
    els.exportShareBtn.addEventListener("click", async () => {
      if (!exportFile) return;
      await shareJsonFile(exportFile);
    });
  }
  if (els.exportSaveBtn) {
    els.exportSaveBtn.addEventListener("click", async () => {
      if (!exportBlob) return;
      await saveJsonFile(exportBlob, exportFilename);
    });
  }
  if (els.exportDownloadBtn) {
    els.exportDownloadBtn.addEventListener("click", () => {
      if (!exportBlob) return;
      downloadJsonFile(exportBlob, exportFilename);
    });
  }
}

if (els.importActiveJsonBtn && els.importActiveJson) {
  els.importActiveJsonBtn.addEventListener("click", () => {
    els.importActiveJson.click();
  });

  els.importActiveJson.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    await importActiveTasksFromFile(file);
    e.target.value = "";
  });
}

els.prevMonth.addEventListener("click", () => {
  state.calendarMonth -= 1;
  if (state.calendarMonth < 0) {
    state.calendarMonth = 11;
    state.calendarYear -= 1;
  }
  render();
});

els.nextMonth.addEventListener("click", () => {
  state.calendarMonth += 1;
  if (state.calendarMonth > 11) {
    state.calendarMonth = 0;
    state.calendarYear += 1;
  }
  render();
});

document.addEventListener("click", async (e) => {
  const link = e.target.closest(".attachment-link");
  if (!link) return;
  const id = link.dataset.attachmentId;
  if (!id) return;
  if (attachmentUrlCache.has(id)) return;
  e.preventDefault();
  let record = null;
  try {
    record = await getAttachment(id);
  } catch {
    record = null;
  }
  if (!record || !record.blob) return;
  const url = URL.createObjectURL(record.blob);
  attachmentUrlCache.set(id, url);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  window.open(url, "_blank", "noopener");
});

els.activeList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  let tasks = loadTasks();

  if (action === "reschedule") {
    const days = Number(btn.dataset.days || 0);
    tasks = rescheduleTask(tasks, id, days);
  }

  if (action === "complete") {
    const task = tasks.find((t) => t.id === id);
    if (task) {
      task.done = true;
      task.completedAt = Date.now();
      task.updatedAt = Date.now();
    }
  }

  if (action === "duplicate") {
    const task = tasks.find((t) => t.id === id);
    if (task) {
      const newTaskId = uid();
      let attachments = [];
      try {
        attachments = await duplicateAttachments(task.attachments || [], newTaskId);
      } catch {
        attachments = [];
      }
      tasks.push({
        ...task,
        id: newTaskId,
        done: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: null,
        attachments
      });
    }
  }

  if (action === "share") {
    const task = tasks.find((t) => t.id === id);
    if (task) {
      const payload = buildSingleTaskPayload(task);
      const dateKey = new Date().toISOString().slice(0, 10);
      const filename = `taskr-task-${dateKey}.json`;
      const { file } = createExportFile(payload, filename);
      await shareJsonFile(file);
    }
    return;
  }

  if (action === "edit") {
    const task = tasks.find((t) => t.id === id);
    if (task) openEditDialog(task);
    return;
  }

  saveTasks(tasks);
  render();
});

const handleNoteCheckChange = (e) => {
  const input = e.target.closest(".note-check");
  if (!input) return;
  const id = input.dataset.id;
  const lineIndex = Number(input.dataset.lineIndex);
  if (!id || !Number.isFinite(lineIndex)) return;
  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task || !task.note) return;
  const lines = task.note.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) return;
  const line = lines[lineIndex];
  const match = line.match(/^(\s*)(?:\[( |x|X)\]|([☐☑]))(\s*)(.*)$/);
  if (!match) return;
  const prefix = match[1] || "";
  const spacer = match[4] || "";
  const content = match[5] || "";
  const mark = input.checked ? "☑" : "☐";
  lines[lineIndex] = `${prefix}${mark}${spacer}${content}`;
  task.note = lines.join("\n");
  task.updatedAt = Date.now();
  saveTasks(tasks);
};

els.activeList.addEventListener("change", handleNoteCheckChange);

els.doneList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  let tasks = loadTasks();

  if (action === "restore") {
    const task = tasks.find((t) => t.id === id);
    if (task) {
      task.done = false;
      task.completedAt = null;
      task.updatedAt = Date.now();
    }
  }

  if (action === "duplicate") {
    const task = tasks.find((t) => t.id === id);
    if (task) {
      const newTaskId = uid();
      let attachments = [];
      try {
        attachments = await duplicateAttachments(task.attachments || [], newTaskId);
      } catch {
        attachments = [];
      }
      tasks.push({
        ...task,
        id: newTaskId,
        done: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: null,
        attachments
      });
    }
  }

  if (action === "delete") {
    const trash = normalizeDoneTrash(loadHistory(STORAGE.doneTrash));
    const task = tasks.find((t) => t.id === id);
    if (task) {
      trash.unshift({ task, deletedAt: Date.now() });
      if (task.attachments && task.attachments.length) {
        await deleteAttachmentsByTask(task.id);
      }
    }
    tasks = tasks.filter((t) => t.id !== id);
    saveHistory(STORAGE.doneTrash, trash);
  }

  saveTasks(tasks);
  render();
});

els.doneList.addEventListener("change", handleNoteCheckChange);


els.projectHistory.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.action !== "edit-history") return;
  const item = btn.closest(".history-item");
  if (!item) return;
  if (item.classList.contains("is-editing")) {
    exitHistoryEdit(item, { save: true });
  } else {
    enterHistoryEdit(item);
  }
});

els.projectHistory.addEventListener("dblclick", (e) => {
  const text = e.target.closest(".history-text");
  if (!text) return;
  const item = text.closest(".history-item");
  if (!item) return;
  enterHistoryEdit(item);
});

els.projectTrash.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.action !== "restore-history") return;
  const index = Number(btn.dataset.index);
  const trash = normalizeTrash(loadHistory(STORAGE.projectsTrash));
  const item = trash[index];
  if (!item || !item.value) return;
  const projects = loadHistory(STORAGE.projects);
  const nextProjects = addToHistory(projects, item.value);
  trash.splice(index, 1);
  saveHistory(STORAGE.projects, nextProjects);
  saveHistory(STORAGE.projectsTrash, trash);
  render();
});

els.todoTrash.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.action !== "restore-history") return;
  const index = Number(btn.dataset.index);
  const trash = normalizeTrash(loadHistory(STORAGE.todosTrash));
  const item = trash[index];
  if (!item || !item.value) return;
  const todos = loadHistory(STORAGE.todos);
  const nextTodos = addToHistory(todos, item.value);
  trash.splice(index, 1);
  saveHistory(STORAGE.todos, nextTodos);
  saveHistory(STORAGE.todosTrash, trash);
  render();
});

els.todoHistory.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.action !== "edit-history") return;
  const item = btn.closest(".history-item");
  if (!item) return;
  if (item.classList.contains("is-editing")) {
    exitHistoryEdit(item, { save: true });
  } else {
    enterHistoryEdit(item);
  }
});

els.todoHistory.addEventListener("dblclick", (e) => {
  const text = e.target.closest(".history-text");
  if (!text) return;
  const item = text.closest(".history-item");
  if (!item) return;
  enterHistoryEdit(item);
});

function handleHistoryEditKeydown(e) {
  const input = e.target.closest(".history-edit");
  if (!input) return;
  const item = input.closest(".history-item");
  if (!item) return;
  if (e.key === "Enter") {
    e.preventDefault();
    exitHistoryEdit(item, { save: true });
  }
  if (e.key === "Escape") {
    e.preventDefault();
    exitHistoryEdit(item, { save: false });
  }
}

function handleHistoryEditBlur(e) {
  const input = e.target.closest(".history-edit");
  if (!input) return;
  const item = input.closest(".history-item");
  if (!item || !item.classList.contains("is-editing")) return;
  exitHistoryEdit(item, { save: true });
}

els.projectHistory.addEventListener("keydown", handleHistoryEditKeydown);
els.todoHistory.addEventListener("keydown", handleHistoryEditKeydown);
els.projectHistory.addEventListener("focusout", handleHistoryEditBlur);
els.todoHistory.addEventListener("focusout", handleHistoryEditBlur);

els.projectSelectAll.addEventListener("click", () => {
  els.projectHistory.querySelectorAll("input[type=checkbox]").forEach((box) => {
    box.checked = true;
  });
});

els.todoSelectAll.addEventListener("click", () => {
  els.todoHistory.querySelectorAll("input[type=checkbox]").forEach((box) => {
    box.checked = true;
  });
});

els.projectDelete.addEventListener("click", () => {
  const boxes = Array.from(els.projectHistory.querySelectorAll("input[type=checkbox]"));
  const remove = boxes.filter((box) => box.checked).map((box) => Number(box.dataset.index));
  if (!remove.length) return;
  const current = loadHistory(STORAGE.projects);
  const trash = normalizeTrash(loadHistory(STORAGE.projectsTrash));
  const removedItems = remove.map((idx) => current[idx]).filter(Boolean)
    .map((value) => ({ value, deletedAt: Date.now() }));
  const projects = current.filter((_, idx) => !remove.includes(idx));
  saveHistory(STORAGE.projects, projects);
  saveHistory(STORAGE.projectsTrash, [...removedItems, ...trash]);
  render();
});

els.todoDelete.addEventListener("click", () => {
  const boxes = Array.from(els.todoHistory.querySelectorAll("input[type=checkbox]"));
  const remove = boxes.filter((box) => box.checked).map((box) => Number(box.dataset.index));
  if (!remove.length) return;
  const current = loadHistory(STORAGE.todos);
  const trash = normalizeTrash(loadHistory(STORAGE.todosTrash));
  const removedItems = remove.map((idx) => current[idx]).filter(Boolean)
    .map((value) => ({ value, deletedAt: Date.now() }));
  const todos = current.filter((_, idx) => !remove.includes(idx));
  saveHistory(STORAGE.todos, todos);
  saveHistory(STORAGE.todosTrash, [...removedItems, ...trash]);
  render();
});

els.doneTrash.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.action !== "restore-done") return;
  const index = Number(btn.dataset.index);
  const trash = normalizeDoneTrash(loadHistory(STORAGE.doneTrash));
  const item = trash[index];
  if (!item || !item.task) return;
  const tasks = loadTasks();
  tasks.push({ ...item.task, done: true });
  trash.splice(index, 1);
  saveTasks(tasks);
  saveHistory(STORAGE.doneTrash, trash);
  render();
});

els.doneSelectAll.addEventListener("click", () => {
  els.doneList.querySelectorAll("input[type=checkbox]").forEach((box) => {
    box.checked = true;
  });
});

els.doneDeleteSelected.addEventListener("click", async () => {
  const boxes = Array.from(els.doneList.querySelectorAll("input[type=checkbox]"));
  const ids = boxes.filter((box) => box.checked).map((box) => box.dataset.id);
  if (!ids.length) return;
  let tasks = loadTasks();
  const trash = normalizeDoneTrash(loadHistory(STORAGE.doneTrash));
  const move = tasks.filter((t) => ids.includes(t.id));
  for (const task of move) {
    trash.unshift({ task, deletedAt: Date.now() });
    if (task.attachments && task.attachments.length) {
      await deleteAttachmentsByTask(task.id);
    }
  }
  tasks = tasks.filter((t) => !ids.includes(t.id));
  saveTasks(tasks);
  saveHistory(STORAGE.doneTrash, trash);
  render();
});

function openEditDialog(task) {
  els.editId.value = task.id;
  els.editProject.value = task.project;
  els.editTodo.value = task.todo;
  els.editNote.value = task.note || "";
  els.editDue.value = task.dueDate || "";
  if (els.editDueTime) els.editDueTime.value = task.dueTime || "";
  if (els.editDueTimeRow) {
    els.editDueTimeRow.classList.toggle("is-hidden", !task.dueTime);
  }
  if (els.editDueTimeToggle) {
    els.editDueTimeToggle.textContent = task.dueTime ? "時間を削除" : "時間を指定";
  }
  els.editForm.editType.value = task.type;
  editAttachmentState.list = (task.attachments || []).map((item) => ({ ...item }));
  editAttachmentState.removed = new Set();
  renderEditAttachments();
  if (els.editAttachments) els.editAttachments.value = "";
  els.editDialog.showModal();
  requestAnimationFrame(() => {
    autoGrowTextArea(els.editProject);
    autoGrowTextArea(els.editTodo);
  });
}

function renderEditAttachments() {
  if (!els.editAttachmentsList) return;
  if (!editAttachmentState.list.length) {
    els.editAttachmentsList.innerHTML = "";
    return;
  }
  els.editAttachmentsList.innerHTML = editAttachmentState.list.map((item) => {
    return `<li>
      <a class="attachment-link" data-attachment-id="${item.id}" data-attachment-name="${escapeHtml(item.name)}">${escapeHtml(item.name)}</a>
      <button class="btn" type="button" data-action="remove-attachment" data-id="${item.id}">削除</button>
    </li>`;
  }).join("");
}

if (els.editAttachmentsList) {
  els.editAttachmentsList.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.action !== "remove-attachment") return;
    const id = btn.dataset.id;
    if (!id) return;
    editAttachmentState.list = editAttachmentState.list.filter((item) => item.id !== id);
    editAttachmentState.removed.add(id);
    if (attachmentUrlCache.has(id)) {
      URL.revokeObjectURL(attachmentUrlCache.get(id));
      attachmentUrlCache.delete(id);
    }
    renderEditAttachments();
  });
}

function openPreviewDialog(task) {
  if (!els.previewDialog) return;
  els.previewDialog.dataset.taskId = task.id;
  const typeLabel = task.type === "work" ? "仕事" : "プライベート";
  els.previewType.textContent = typeLabel;
  els.previewProject.textContent = task.project || "";
  els.previewTodo.textContent = task.todo || "";
  if (task.note && task.note.trim()) {
    els.previewNote.innerHTML = linkifyText(task.note);
  } else {
    els.previewNote.textContent = "内 / 備 / 注なし";
  }
  els.previewDue.textContent = task.dueDate ? formatDate(task.dueDate, task.dueTime) : "未定";
  if (task.attachments && task.attachments.length) {
    els.previewAttachments.innerHTML = renderAttachmentList(task.attachments);
    if (els.previewAttachmentsRow) els.previewAttachmentsRow.classList.remove("is-hidden");
  } else {
    els.previewAttachments.innerHTML = "";
    if (els.previewAttachmentsRow) els.previewAttachmentsRow.classList.add("is-hidden");
  }
  els.previewDialog.showModal();
  updateAttachmentLinks();
}

els.editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === els.editId.value);
  if (!task) return;

  const newFiles = Array.from(els.editAttachments?.files || []);
  const validation = validateAttachments(newFiles, editAttachmentState.list.length);
  if (!validation.ok) {
    alert(validation.message);
    return;
  }

  task.type = els.editForm.editType.value;
  task.project = els.editProject.value.trim();
  task.todo = els.editTodo.value.trim();
  task.note = els.editNote.value.trim();
  task.dueDate = els.editDue.value || "";
  task.dueTime = task.dueDate ? (els.editDueTime.value || "") : "";
  task.updatedAt = Date.now();
  task.attachments = editAttachmentState.list.slice();
  if (newFiles.length) {
    try {
      const added = await saveAttachments(task.id, newFiles);
      task.attachments = task.attachments.concat(added);
    } catch {
      alert("添付の保存に失敗しました。");
      return;
    }
  }
  if (editAttachmentState.removed.size) {
    try {
      for (const id of editAttachmentState.removed) {
        await deleteAttachmentById(id);
      }
    } catch {
      alert("添付の削除に失敗しました。");
      return;
    }
  }
  saveTasks(tasks);
  els.editDialog.close();
  render();
});

els.editCancel.addEventListener("click", () => {
  els.editDialog.close();
});

els.editDialog.addEventListener("click", (e) => {
  if (e.target === els.editDialog) {
    els.editDialog.close();
  }
});

if (els.previewClose) {
  els.previewClose.addEventListener("click", () => {
    els.previewDialog.close();
  });
}

if (els.previewEdit) {
  els.previewEdit.addEventListener("click", () => {
    const id = els.previewDialog?.dataset?.taskId;
    if (!id) return;
    const task = loadTasks().find((t) => t.id === id);
    if (!task) return;
    els.previewDialog.close();
    openEditDialog(task);
  });
}

if (els.previewDuplicate) {
  els.previewDuplicate.addEventListener("click", async () => {
    const id = els.previewDialog?.dataset?.taskId;
    if (!id) return;
    const tasks = loadTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const newTaskId = uid();
    let attachments = [];
    try {
      attachments = await duplicateAttachments(task.attachments || [], newTaskId);
    } catch {
      attachments = [];
    }
    tasks.push({
      ...task,
      id: newTaskId,
      done: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
      attachments
    });
    saveTasks(tasks);
    els.previewDialog.close();
    render();
  });
}

if (els.previewComplete) {
  els.previewComplete.addEventListener("click", () => {
    const id = els.previewDialog?.dataset?.taskId;
    if (!id) return;
    const tasks = loadTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    task.done = true;
    task.completedAt = Date.now();
    task.updatedAt = Date.now();
    saveTasks(tasks);
    els.previewDialog.close();
    render();
  });
}

if (els.previewDialog) {
  els.previewDialog.addEventListener("click", (e) => {
    if (e.target === els.previewDialog) {
      els.previewDialog.close();
    }
  });
}

els.calendarGrid.addEventListener("click", (e) => {
  const target = e.target.closest(".calendar-item");
  if (!target) return;
  const id = target.dataset.id;
  if (!id) return;
  const task = loadTasks().find((t) => t.id === id);
  if (!task) return;
  openPreviewDialog(task);
});

els.editDialog.addEventListener("input", (e) => {
  const target = e.target;
  if (target && target.classList && target.classList.contains("auto-grow")) {
    autoGrowTextArea(target);
  }
});

updateTypeTabs();
startAttachmentCleanupTimer();
render();
