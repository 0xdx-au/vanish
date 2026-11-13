/* VANISH v1.3 — privileged, network-free rule broker.
   Content scripts cannot directly read extension storage. */
"use strict";
const SCHEMA = "vanish.schema.version";
const VERSION = 3;
const APPROVED = "vanish.approvedOrigins";
const RULE_PREFIX = "vanish.rules.v3.";
const MAX_RULES = 24;
const MAX_SELECTORS = 3;
const MAX_SELECTOR = 480;
const SELECTOR = /^html\s*>\s*body(?:\s*>\s*[a-z][a-z0-9-]*(?::nth-of-type\([1-9]\d{0,2}\))?){1,18}$/;
const OPTIONS = { enabled: true, rules: [] };

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
  return key === APPROVED || key === SCHEMA || key.startsWith(RULE_PREFIX) || key.startsWith("vanish.site.") || key === "vanish.preferences";
}
function approvedArray(value) {
  return Array.isArray(value) ? [...new Set(value.filter(x => typeof x === "string" && originOf(x) === x))].slice(0, 256) : [];
}
function validRule(value) {
  return value && typeof value === "object" && typeof value.id === "string" &&
    /^r_[a-f0-9-]{12,40}$/.test(value.id) &&
    Array.isArray(value.selectors) && value.selectors.length > 0 &&
    value.selectors.length <= MAX_SELECTORS &&
    value.selectors.every(x => typeof x === "string" && x.length <= MAX_SELECTOR && SELECTOR.test(x)) &&
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
  if (message.type.startsWith("CONTENT_")) {
    if (!contentOrigin || !(await isApproved(contentOrigin))) return { ok: false, error: "Origin not approved", state: OPTIONS };
    if (message.type === "CONTENT_READ") return { ok: true, state: await readState(contentOrigin) };
    if (message.type === "CONTENT_SAVE") {
      const item = message.rule;
      if (!item || !Array.isArray(item.selectors) || item.selectors.length > MAX_SELECTORS ||
        !item.selectors.every(s => typeof s === "string" && s.length <= MAX_SELECTOR && SELECTOR.test(s))) {
        return { ok: false, error: "Unsafe or unstable selector rejected" };
      }
      const state = await readState(contentOrigin);
      if (state.rules.length >= MAX_RULES) return { ok: false, error: "Rule limit reached; restore an earlier selection" };
      if (state.rules.some(r => r.selectors[0] === item.selectors[0])) return { ok: false, error: "Element already saved" };
      const id = "r_" + crypto.randomUUID();
      state.enabled = true;
      state.rules.push({ id, selectors: [...new Set(item.selectors)], unlockScroll: item.unlockScroll === true });
      await writeState(contentOrigin, state);
      return { ok: true, state, id };
    }
    if (message.type === "CONTENT_REMOVE") {
      const state = await readState(contentOrigin);
      state.rules = state.rules.filter(r => r.id !== message.id);
      await writeState(contentOrigin, state);
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
      if (!approved.includes(origin)) {
        if (approved.length >= 256) return { ok: false, error: "Approved-origin limit reached" };
        approved.push(origin);
        await chrome.storage.local.set({ [APPROVED]: approved });
      }
      return { ok: true, approved: true, state: await readState(origin) };
    }
    case "ADMIN_REMOVE":
    case "ADMIN_TOGGLE":
    case "ADMIN_CLEAR": {
      if (!origin) return { ok: false, error: "Invalid origin" };
      const state = await readState(origin);
      if (message.type === "ADMIN_REMOVE") state.rules = state.rules.filter(r => r.id !== message.id);
      else if (message.type === "ADMIN_TOGGLE") state.enabled = message.enabled === true;
      else state.rules = [];
      await writeState(origin, state);
      return { ok: true, state };
    }
    case "ADMIN_FORGET_HOST": {
      if (typeof message.hostname !== "string" || !/^[a-z0-9.:[\]-]{1,253}$/i.test(message.hostname)) {
        return { ok: false, error: "Invalid hostname" };
      }
      return removeHost(message.hostname.toLowerCase());
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
