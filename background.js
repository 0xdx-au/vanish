/* VANISH v1.3 — privileged, network-free rule broker.
   Content scripts cannot directly read extension storage. */
"use strict";
const SCHEMA = "vanish.schema.version";
const VERSION = 3;
const APPROVED = "vanish.approvedOrigins";
const RULE_PREFIX = "vanish.rules.v3.";
const MAX_RULES = 24;
const MAX_SELECTORS = 3;
const MAX_SELECTOR = 650;
const SELECTOR = /^html\s*>\s*body(?:\s*>\s*[a-z][a-z0-9-]*(?::nth-of-type\([1-9]\d{0,2}\))?){1,25}$/;
const SEMANTIC_SELECTORS = new Set(['html > body [role="dialog"][aria-modal="true"]', 'html > body dialog[open]']);
const SAFE_TAGS = new Set(["body","div","section","article","aside","main","header","footer","nav","dialog","span","p","h1","h2","h3","h4","h5","h6","ul","li","ol","table","tbody","thead","tfoot","tr","td","th","a","button","form","fieldset","label","details","summary","figure","figcaption","picture","img","svg","canvas","blockquote","pre","code","small","strong","em","iframe","video","audio","ins","address","time","output"]);
function safeSelector(value) {
  return typeof value === "string" && value.length <= MAX_SELECTOR &&
    (SEMANTIC_SELECTORS.has(value) || (SELECTOR.test(value) &&
    value.split(/\s*>\s*/).slice(1).every(segment => SAFE_TAGS.has(segment.split(":")[0]))));
}
const OPTIONS = { enabled: true, rules: [] };

/* Opt-in, on-device aggregate telemetry. Never store an origin, selector, URL or error string. */
const TELEMETRY_KEY = "vanish.telemetry.v1";
const TELEMETRY_EVENTS = Object.freeze([
  "picker_started", "picker_cancelled", "picker_failed", "rules_saved",
  "rule_restored", "site_restored", "page_cleaned", "mutation_backoff",
  "scan_deferred", "safety_paused", "permission_granted", "site_forgotten",
  "rules_paused", "rules_resumed"
]);
const TELEMETRY_EVENT_SET = new Set(TELEMETRY_EVENTS);
const TELEMETRY_DAYS = 14;
const TELEMETRY_MAX_COUNT = 1000000;
let telemetryQueue = Promise.resolve();
const recentSignals = new Map();
function telemetrySequence(job) {
  const current = telemetryQueue.then(job);
  telemetryQueue = current.catch(() => {});
  return current;
}
function normaliseTelemetry(input) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const oldest = new Date(now - (TELEMETRY_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const byDay = new Map();
  const rows = Array.isArray(input?.days) ? input.days.slice(-TELEMETRY_DAYS * 2) : [];
  for (const row of rows) {
    if (!row || typeof row.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.day) ||
        row.day < oldest || row.day > today) continue;
    const counts = {};
    for (const event of TELEMETRY_EVENTS) {
      const n = row.counts?.[event];
      counts[event] = Number.isSafeInteger(n) && n >= 0
        ? Math.min(n, TELEMETRY_MAX_COUNT) : 0;
    }
    byDay.set(row.day, { day: row.day, counts });
  }
  return { version: 1, enabled: input?.enabled === true,
    days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-TELEMETRY_DAYS) };
}
async function telemetrySnapshot() {
  return telemetrySequence(async () =>
    normaliseTelemetry((await chrome.storage.local.get(TELEMETRY_KEY))[TELEMETRY_KEY]));
}
async function recordTelemetry(event) {
  if (!TELEMETRY_EVENT_SET.has(event)) return;
  return telemetrySequence(async () => {
    const value = normaliseTelemetry((await chrome.storage.local.get(TELEMETRY_KEY))[TELEMETRY_KEY]);
    if (!value.enabled) return;
    const day = new Date().toISOString().slice(0, 10);
    let row = value.days.find(item => item.day === day);
    if (!row) {
      row = { day, counts: Object.fromEntries(TELEMETRY_EVENTS.map(x => [x, 0])) };
      value.days.push(row);
      value.days = value.days.slice(-TELEMETRY_DAYS);
    }
    row.counts[event] = Math.min(TELEMETRY_MAX_COUNT, row.counts[event] + 1);
    await chrome.storage.local.set({ [TELEMETRY_KEY]: value });
  });
}
async function recordSafely(event) {
  try { await recordTelemetry(event); } catch { /* Telemetry cannot break the extension. */ }
}
async function setTelemetry(enabled) {
  return telemetrySequence(async () => {
    const model = normaliseTelemetry((await chrome.storage.local.get(TELEMETRY_KEY))[TELEMETRY_KEY]);
    model.enabled = enabled;
    await chrome.storage.local.set({ [TELEMETRY_KEY]: model });
    return model;
  });
}
async function clearTelemetry() {
  return telemetrySequence(async () => {
    const model = normaliseTelemetry((await chrome.storage.local.get(TELEMETRY_KEY))[TELEMETRY_KEY]);
    model.days = [];
    await chrome.storage.local.set({ [TELEMETRY_KEY]: model });
    return model;
  });
}
function allowTelemetrySignal(sender, event) {
  if (!TELEMETRY_EVENT_SET.has(event) ||
      !["picker_started", "picker_cancelled", "picker_failed", "page_cleaned",
        "mutation_backoff", "scan_deferred", "safety_paused"].includes(event)) return false;
  const id = sender.tab?.id;
  if (!Number.isInteger(id)) return false;
  const key = id + ":" + event;
  const now = Date.now();
  const wait = ["mutation_backoff", "scan_deferred"].includes(event) ? 30000 : 2500;
  if (now - (recentSignals.get(key) || 0) < wait) return false;
  if (recentSignals.size > 512) recentSignals.clear();
  recentSignals.set(key, now);
  return true;
}


function originOf(candidate) {
  try {
    const u = new URL(candidate);
    return (u.protocol === "http:" || u.protocol === "https:") && u.origin === candidate ? u.origin : null;
  } catch { return null; }
}
function patternFor(origin) {
  const u = new URL(origin);
  // Chrome match patterns cannot isolate ports: port-level isolation is enforced by this broker.
  return u.protocol + "//" + u.hostname + "/*";
}
function scriptIdFor(pattern) {
  let n = 2166136261;
  for (const c of pattern) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return "vanish_" + (n >>> 0).toString(16);
}
function keyFor(origin) { return RULE_PREFIX + encodeURIComponent(origin); }
function isVanishKey(key) {
  return key === APPROVED || key === SCHEMA || key.startsWith(RULE_PREFIX) || key.startsWith("vanish.site.") || key === "vanish.preferences" || key === TELEMETRY_KEY;
}
function approvedArray(value) {
  return Array.isArray(value) ? [...new Set(value.filter(x => typeof x === "string" && originOf(x) === x))].slice(0, 256) : [];
}
function validRule(value) {
  return value && typeof value === "object" && typeof value.id === "string" &&
    /^r_[a-f0-9-]{12,40}$/.test(value.id) &&
    Array.isArray(value.selectors) && value.selectors.length > 0 &&
    value.selectors.length <= MAX_SELECTORS &&
    value.selectors.every(safeSelector) &&
    typeof value.unlockScroll === "boolean";
}
function stateOf(raw) {
  return { enabled: raw?.enabled !== false,
    rules: Array.isArray(raw?.rules) ? raw.rules.filter(validRule).slice(-MAX_RULES)
      .map(({ id, selectors, unlockScroll }) => ({ id, selectors, unlockScroll })) : [] };
}
async function allApproved() {
  return approvedArray((await chrome.storage.local.get(APPROVED))[APPROVED]);
}
async function isApproved(origin) {
  if (originOf(origin) !== origin) return false;
  if (!(await allApproved()).includes(origin)) return false;
  return chrome.permissions.contains({ origins: [patternFor(origin)] });
}
async function readState(origin) {
  return stateOf((await chrome.storage.local.get(keyFor(origin)))[keyFor(origin)]);
}
async function writeState(origin, state) {
  await chrome.storage.local.set({ [keyFor(origin)]: stateOf(state) });
}
async function removeVanishRegistrations() {
  const scripts = await chrome.scripting.getRegisteredContentScripts();
  const ids = scripts.filter(x => x.id.startsWith("vanish_")).map(x => x.id);
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
}
async function migrate() {
  // On upgrading from 1.2 the old page-text labels are unrecoverably deleted,
  // along with old hostname rules and grants. Re-approval is required.
  const data = await chrome.storage.local.get(null);
  if (data[SCHEMA] === VERSION) return;
  const names = Object.keys(data).filter(isVanishKey);
  if (names.length) await chrome.storage.local.remove(names);
  await removeVanishRegistrations();
  const permissions = await chrome.permissions.getAll();
  const origins = (permissions.origins || []).filter(x => /^https?:\/\//.test(x));
  if (origins.length) await chrome.permissions.remove({ origins });
  await chrome.storage.local.set({ [SCHEMA]: VERSION });
}
let init = null;
function ready() {
  if (!init) {
    init = (async () => {
      await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
      await migrate();
    })().catch(e => { init = null; throw e; });
  }
  return init;
}
void ready().catch(() => {}); // fail closed; handled on every message too
chrome.runtime.onInstalled.addListener(() => { void ready().catch(() => {}); });

function senderOrigin(sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || sender.tab.incognito) return null;
  try {
    const u = new URL(sender.url || "");
    return originOf(u.origin);
  } catch { return null; }
}
function fromPopup(sender) {
  return sender.id === chrome.runtime.id &&
    typeof sender.url === "string" &&
    sender.url === chrome.runtime.getURL("popup.html");
}
function fromDashboard(sender) {
  return sender.id === chrome.runtime.id &&
    typeof sender.url === "string" &&
    sender.url === chrome.runtime.getURL("dashboard.html");
}

async function broadcast(message) {
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch { return; }
  await Promise.allSettled(tabs.filter(t => Number.isInteger(t.id)).map(t =>
    chrome.tabs.sendMessage(t.id, message, { frameId: 0 })));
}
async function removeHost(hostname) {
  const approved = await allApproved();
  const removed = approved.filter(x => { try { return new URL(x).hostname === hostname; } catch { return false; } });
  const data = await chrome.storage.local.get(null);
  const oldKeys = Object.keys(data).filter(k => k === "vanish.site." + hostname ||
    k.startsWith(RULE_PREFIX) && (() => { try { return new URL(decodeURIComponent(k.slice(RULE_PREFIX.length))).hostname === hostname; } catch { return false; } })());
  // Revert already-injected pages before dropping permission.
  await broadcast({ type: "CONTENT_SHUTDOWN", hostname });
  if (oldKeys.length) await chrome.storage.local.remove(oldKeys);
  await chrome.storage.local.set({ [APPROVED]: approved.filter(x => !removed.includes(x)) });

  const scripts = await chrome.scripting.getRegisteredContentScripts();
  const patternSet = new Set(["http://" + hostname + "/*", "https://" + hostname + "/*"]);
  const ids = scripts.filter(x => x.id.startsWith("vanish_") &&
    (x.matches || []).some(match => patternSet.has(match))).map(x => x.id);
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });

  const current = await chrome.permissions.getAll();
  const targets = (current.origins || []).filter(x => {
    try { const host = new URL(x.replace(/\/\*$/, "/")).hostname; return host === hostname; }
    catch { return false; }
  });
  if (targets.length) await chrome.permissions.remove({ origins: targets });
  const after = await chrome.permissions.getAll();
  const leftovers = (await chrome.scripting.getRegisteredContentScripts()).filter(x => x.id.startsWith("vanish_") &&
    (x.matches || []).some(match => patternSet.has(match)));
  const remaining = (after.origins || []).filter(x => {
    try { return new URL(x.replace(/\/\*$/, "/")).hostname === hostname; }
    catch { return false; }
  });
  if (leftovers.length || remaining.length || (await allApproved()).some(x => new URL(x).hostname === hostname)) {
    throw new Error("Revocation incomplete; inspect Chrome extension permissions");
  }
  return { ok: true, revokedOrigins: removed.length, scripts: ids.length };
}
async function clearAll() {
  await telemetryQueue; // Drain aggregate writes before deleting all Vanish data.
  await broadcast({ type: "CONTENT_SHUTDOWN_ALL" });
  const data = await chrome.storage.local.get(null);
  const toRemove = Object.keys(data).filter(k => isVanishKey(k) && k !== SCHEMA);
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
  await removeVanishRegistrations();
  const p = await chrome.permissions.getAll();
  const origins = (p.origins || []).filter(x => /^https?:\/\//.test(x));
  if (origins.length) await chrome.permissions.remove({ origins });
  const remaining = (await chrome.permissions.getAll()).origins || [];
  if (remaining.some(x => /^https?:\/\//.test(x))) throw new Error("Not every permission was revoked");
  await chrome.storage.local.set({ [SCHEMA]: VERSION });
  return { ok: true, cleared: toRemove.length, revokedOrigins: origins.length };
}
async function handle(message, sender) {
  await ready();
  if (!message || typeof message !== "object" || typeof message.type !== "string") return { ok: false, error: "Invalid message" };
  const contentOrigin = senderOrigin(sender);
  if (message.type.startsWith("TELEMETRY_")) {
    if (!fromDashboard(sender)) return { ok: false, error: "Dashboard required" };
    if (message.type === "TELEMETRY_READ") {
      const [telemetry, all] = await Promise.all([
        telemetrySnapshot(), chrome.storage.local.get(null)
      ]);
      const approved = approvedArray(all[APPROVED]);
      const savedRules = Object.entries(all).filter(([key]) => key.startsWith(RULE_PREFIX))
        .reduce((sum, [, value]) => sum + stateOf(value).rules.length, 0);
      return { ok: true, telemetry, approvedSites: approved.length, savedRules };
    }
    if (message.type === "TELEMETRY_SET") {
      if (typeof message.enabled !== "boolean") return { ok: false, error: "Boolean required" };
      return { ok: true, telemetry: await setTelemetry(message.enabled) };
    }
    if (message.type === "TELEMETRY_CLEAR") {
      return { ok: true, telemetry: await clearTelemetry() };
    }
    return { ok: false, error: "Unknown telemetry request" };
  }
  if (message.type.startsWith("CONTENT_")) {
    if (!contentOrigin || !(await isApproved(contentOrigin))) return { ok: false, error: "Origin not approved", state: OPTIONS };
    if (message.type === "CONTENT_READ") return { ok: true, state: await readState(contentOrigin) };
    if (message.type === "CONTENT_SIGNAL") {
      if (typeof message.event !== "string" || !allowTelemetrySignal(sender, message.event))
        return { ok: false, error: "Unsupported or throttled signal" };
      await recordSafely(message.event);
      return { ok: true };
    }
    if (message.type === "CONTENT_SAVE") {
      const item = message.rule;
      if (!item || !Array.isArray(item.selectors) || item.selectors.length > MAX_SELECTORS ||
        !item.selectors.every(safeSelector)) {
        return { ok: false, error: "Unsafe or unstable selector rejected" };
      }
      const state = await readState(contentOrigin);
      if (state.rules.length >= MAX_RULES) return { ok: false, error: "Rule limit reached; restore an earlier selection" };
      if (state.rules.some(r => r.selectors[0] === item.selectors[0])) return { ok: false, error: "Element already saved" };
      const id = "r_" + crypto.randomUUID();
      state.enabled = true;
      state.rules.push({ id, selectors: [...new Set(item.selectors)], unlockScroll: item.unlockScroll === true });
      await writeState(contentOrigin, state);
      await recordSafely("rules_saved");
      return { ok: true, state, id };
    }
    if (message.type === "CONTENT_REMOVE") {
      const state = await readState(contentOrigin);
      const before = state.rules.length;
      state.rules = state.rules.filter(r => r.id !== message.id);
      await writeState(contentOrigin, state);
      if (state.rules.length < before) await recordSafely("rule_restored");
      return { ok: true, state };
    }
    return { ok: false, error: "Unknown content request" };
  }
  if (!fromPopup(sender)) return { ok: false, error: "Trusted popup required" };
  const origin = typeof message.origin === "string" ? originOf(message.origin) : null;
  switch (message.type) {
    case "ADMIN_READ":
      if (!origin) return { ok: false, error: "Invalid origin" };
      return { ok: true, approved: await isApproved(origin), state: await readState(origin) };
    case "ADMIN_APPROVE": {
      if (!origin) return { ok: false, error: "Invalid origin" };
      if (!(await chrome.permissions.contains({ origins: [patternFor(origin)] }))) {
        return { ok: false, error: "Chrome site permission not granted" };
      }
      const pattern = patternFor(origin), id = scriptIdFor(pattern);
      const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
      if (scripts.length && JSON.stringify(scripts[0].matches) !== JSON.stringify([pattern])) {
        return { ok: false, error: "Content script ID collision" };
      }
      if (!scripts.length) await chrome.scripting.registerContentScripts([{
        id, matches: [pattern], js: ["content.js"], allFrames: false,
        runAt: "document_start", persistAcrossSessions: true
      }]);
      const approved = await allApproved();
      const grantedNow = !approved.includes(origin);
      if (grantedNow) {
        if (approved.length >= 256) return { ok: false, error: "Approved-origin limit reached" };
        approved.push(origin);
        await chrome.storage.local.set({ [APPROVED]: approved });
      }
      if (grantedNow) await recordSafely("permission_granted");
      return { ok: true, approved: true, state: await readState(origin) };
    }
    case "ADMIN_REMOVE":
    case "ADMIN_TOGGLE":
    case "ADMIN_CLEAR": {
      if (!origin) return { ok: false, error: "Invalid origin" };
      const state = await readState(origin);
      const before = state.rules.length, wasEnabled = state.enabled;
      if (message.type === "ADMIN_REMOVE") state.rules = state.rules.filter(r => r.id !== message.id);
      else if (message.type === "ADMIN_TOGGLE") state.enabled = message.enabled === true;
      else state.rules = [];
      await writeState(origin, state);
      if (message.type === "ADMIN_REMOVE" && state.rules.length < before)
        await recordSafely("rule_restored");
      if (message.type === "ADMIN_CLEAR" && before > 0) await recordSafely("site_restored");
      if (message.type === "ADMIN_TOGGLE" && wasEnabled !== state.enabled)
        await recordSafely(state.enabled ? "rules_resumed" : "rules_paused");
      return { ok: true, state };
    }
    case "ADMIN_FORGET_HOST": {
      if (typeof message.hostname !== "string" || !/^[a-z0-9.:[\]-]{1,253}$/i.test(message.hostname)) {
        return { ok: false, error: "Invalid hostname" };
      }
      const result = await removeHost(message.hostname.toLowerCase());
      await recordSafely("site_forgotten");
      return result;
    }
    case "ADMIN_CLEAR_ALL": return clearAll();
    default: return { ok: false, error: "Unknown request" };
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  Promise.resolve(handle(message, sender)).then(respond).catch(error =>
    respond({ ok: false, error: error instanceof Error ? error.message : "Operation failed" }));
  return true;
});
