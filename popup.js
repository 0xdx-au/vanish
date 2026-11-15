/* Vanish / ADMINE */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const ui = {
    domain: $("domain"), count: $("count"), pick: $("pick"), rules: $("rules"),
    undo: $("undo"), restore: $("restore"), forget: $("forget"),
    forgetAll: $("forget-all"), access: $("access"), enabled: $("enabled"),
    status: $("status"), theme: $("theme"), site: document.querySelector(".current-site")
  };
  const PREF = "vanish.preferences";
  const CLIENT_VERSION = "1.4.1";
  let tabId = null, origin = null, hostname = null;
  let state = { enabled: true, rules: [] };
  let approved = false, ready = false, busy = false, refreshId = 0, confirmAll = false;

  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function announce(message, error = false) {
    ui.status.textContent = message;
    ui.status.dataset.tone = error ? "error" : "info";
  }
  async function ask(type, data = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...data });
    if (!response?.ok) throw new Error(response?.error || "Could not complete the request");
    return response;
  }
  function cancelConfirm() {
    confirmAll = false;
    ui.forgetAll.classList.remove("confirm");
    ui.forgetAll.textContent = "Clear all sites";
  }
  function setBusy(next) {
    busy = next;
    draw();
  }
  function unavailable(message) {
    ready = false;
    ui.domain.textContent = message;
    ui.count.textContent = "—";
    ui.site.classList.remove("is-approved");
    ui.access.textContent = "Open an ordinary website to use Vanish.";
    ui.rules.replaceChildren(el("div", "empty", "Choose a website to get started."));
    draw();
  }
  function draw() {
    ui.count.textContent = ready ? state.rules.length + " hidden" : "—";
    ui.enabled.checked = state.enabled;
    ui.enabled.disabled = !ready || !approved || busy;
    ui.pick.disabled = !ready || !origin || busy;
    ui.forget.disabled = !ready || !approved || busy;
    ui.forgetAll.disabled = busy;
    ui.undo.disabled = ui.restore.disabled = !ready || !approved || !state.rules.length || busy;
    ui.site.classList.toggle("is-approved", ready && approved);
    ui.rules.replaceChildren();
    if (!ready) {
      ui.rules.append(el("div", "empty", "No website selected."));
      return;
    }
    if (!state.rules.length) {
      ui.rules.append(el("div", "empty", "Nothing hidden. Select something to begin."));
      return;
    }
    for (let i = state.rules.length - 1; i >= 0; i--) {
      const rule = state.rules[i], row = el("div", "rule"), copy = el("div", "rule-label");
      row.append(el("span", "rule-index", String(i + 1).padStart(2, "0")));
      const title = el("strong", "", "Hidden element " + (i + 1));
      const detail = el("small", "", rule.unlockScroll ? "Overlay and page scrolling" : "Page element");
      copy.append(title, detail);
      const restore = el("button", "", "Restore");
      restore.type = "button";
      restore.disabled = busy || !approved;
      restore.setAttribute("aria-label", "Restore hidden element " + (i + 1));
      restore.addEventListener("click", () => void mutate("ADMIN_REMOVE", { id: rule.id }, "Selection restored."));
      row.append(copy, restore);
      ui.rules.append(row);
    }
  }
  async function refresh() {
    if (!origin) return;
    const request = ++refreshId;
    const data = await ask("ADMIN_READ", { origin });
    if (request !== refreshId) return;
    state = data.state; approved = data.approved; ready = true;
    ui.access.textContent = approved
      ? "Ready — your saved choices are local."
      : "Site permission is requested when you select.";
    draw();
  }
  async function tabMessage(message, injectIfMissing = false) {
    if (!tabId) throw new Error("No active website");
    try {
      return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    } catch (error) {
      if (!injectIfMissing) throw error;
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] }, files: ["content.js"]
      });
      return chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    }
  }
  async function activeVersion() {
    const status = await tabMessage({ type: "STATUS" }, true);
    if (!status?.ok) throw new Error("Please reload the page and try again.");
    if (status.version !== CLIENT_VERSION)
      throw new Error("This page has an older Vanish session. Reload it to update.");
    return status;
  }
  async function refreshTab() {
    if (!approved || !tabId) return true;
    try {
      await activeVersion();
      const applied = await tabMessage({ type: "RULES_REFRESH" });
      if (!applied?.ok) throw new Error(applied?.error || "Reload the page to apply changes.");
      return true;
    } catch (error) {
      announce(error.message || "Reload the page to apply changes.", true);
      return false;
    }
  }
  async function mutate(type, options, message) {
    if (!origin || busy) return;
    cancelConfirm();
    setBusy(true);
    try {
      const response = await ask(type, { origin, ...options });
      ++refreshId;
      state = response.state;
      draw();
      if (await refreshTab()) announce(message);
    } catch (error) {
      announce("Couldn't update the site: " + error.message, true);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  ui.pick.addEventListener("click", async () => {
    if (!origin || busy) return;
    cancelConfirm();
    setBusy(true);
    try {
      const url = new URL(origin);
      // Chrome requires the permission request to start in the click gesture.
      const granted = await chrome.permissions.request({
        origins: [url.protocol + "//" + url.hostname + "/*"]
      });
      if (!granted) throw new Error("Permission declined. Nothing was changed.");
      await ask("ADMIN_APPROVE", { origin });
      await refresh();
      await activeVersion();
      const response = await tabMessage({ type: "START_PICK" });
      if (!response?.ok) throw new Error(response?.error || "Unable to start the picker");
      window.close();
    } catch (error) {
      announce(error.message || "Couldn't start the picker", true);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  });
  ui.undo.addEventListener("click", () => {
    const last = state.rules.at(-1);
    if (last) void mutate("ADMIN_REMOVE", { id: last.id }, "Last selection restored.");
  });
  ui.restore.addEventListener("click", () =>
    void mutate("ADMIN_CLEAR", {}, "Everything on this site is visible again."));
  ui.enabled.addEventListener("change", () =>
    void mutate("ADMIN_TOGGLE", { enabled: ui.enabled.checked },
      ui.enabled.checked ? "Hiding is on." : "Hiding is paused."));

  ui.forget.addEventListener("click", async () => {
    if (!hostname || busy) return;
    cancelConfirm();
    setBusy(true);
    try {
      await ask("ADMIN_FORGET_HOST", { hostname });
      ++refreshId; state = { enabled: true, rules: [] };
      approved = false; ready = true;
      ui.access.textContent = "Site access removed.";
      announce("Website forgotten. Reload open tabs to finish.");
    } catch (error) {
      announce("Couldn't forget this site: " + error.message, true);
    } finally {
      setBusy(false);
    }
  });
  ui.forgetAll.addEventListener("click", async () => {
    if (busy) return;
    if (!confirmAll) {
      confirmAll = true;
      ui.forgetAll.classList.add("confirm");
      ui.forgetAll.textContent = "Confirm clearing every site";
      announce("Select Confirm to remove every saved Vanish choice.");
      return;
    }
    cancelConfirm();
    setBusy(true);
    try {
      await ask("ADMIN_CLEAR_ALL");
      ++refreshId;
      state = { enabled: true, rules: [] };
      approved = false; ready = Boolean(origin);
      ui.access.textContent = "All site access removed.";
      announce("All saved choices and site permissions cleared.");
    } catch (error) {
      announce("Couldn't clear all sites: " + error.message, true);
    } finally {
      setBusy(false);
    }
  });
  ui.theme.addEventListener("change", async () => {
    const theme = ui.theme.value;
    document.documentElement.dataset.theme = theme;
    try { await chrome.storage.local.set({ [PREF]: { theme } }); }
    catch { announce("Appearance preference couldn't be saved.", true); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && origin &&
        Object.hasOwn(changes, "vanish.rules.v3." + encodeURIComponent(origin)))
      void refresh().catch(error => announce("Couldn't refresh choices: " + error.message, true));
  });
  (async () => {
    try {
      const pref = (await chrome.storage.local.get(PREF))[PREF];
      const theme = ["system", "light", "dark"].includes(pref?.theme) ? pref.theme : "system";
      ui.theme.value = theme;
      document.documentElement.dataset.theme = theme;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) {
        unavailable("Unsupported page");
        return;
      }
      const url = new URL(tab.url);
      tabId = tab.id; origin = url.origin; hostname = url.hostname.toLowerCase();
      ui.domain.textContent = url.host;
      ui.domain.title = origin;
      await refresh();
    } catch (error) {
      unavailable("Unavailable");
      announce("Unable to read the current website: " + error.message, true);
    }
  })();
})();
