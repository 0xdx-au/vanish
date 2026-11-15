/* ADMINE / Vanish. On-device, consent-gated aggregate dashboard. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const EVENTS = [
    "picker_started", "picker_cancelled", "picker_failed", "rules_saved",
    "rule_restored", "site_restored", "page_cleaned", "mutation_backoff",
    "scan_deferred", "safety_paused", "permission_granted", "site_forgotten",
    "rules_paused", "rules_resumed"
  ];
  const ui = {
    record: $("recording"), recordLabel: $("recording-label"), collection: $("collection-state"),
    refresh: $("refresh"), clear: $("clear"), export: $("export"), message: $("message"),
    chart: $("chart"), chartDescription: $("chart-description")
  };
  let telemetry = { version: 1, enabled: false, days: [] };
  let totals = {};
  let busy = false;
  let clearArmed = false;
  let serial = Promise.resolve();

  function announce(message, error = false) {
    ui.message.textContent = message;
    ui.message.dataset.error = String(error);
  }
  function request(type, data = {}) {
    return chrome.runtime.sendMessage({ type, ...data }).then(result => {
      if (!result?.ok) throw new Error(result?.error || "Local storage unavailable");
      return result;
    });
  }
  function count(key) { return totals[key] || 0; }
  function number(value) { return Number(value || 0).toLocaleString("en-AU"); }
  function newNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function dayString(offset) {
    return new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
  }
  function chart() {
    ui.chart.replaceChildren();
    const dates = Array.from({ length: 14 }, (_, i) => dayString(13 - i));
    const rows = new Map(telemetry.days.map(row => [row.day, row.counts || {}]));
    const values = dates.map(day => rows.get(day)?.rules_saved || 0);
    const maximum = Math.max(1, ...values);
    for (let i = 0; i < dates.length; i++) {
      const container = newNode("div", "chart-column");
      const count = values[i], day = dates[i];
      container.title = day + ": " + count + (count === 1 ? " rule saved" : " rules saved");
      container.append(newNode("span", "chart-value", count ? String(count) : ""));
      const bar = newNode("div", count ? "chart-bar" : "chart-bar empty");
      bar.style.height = Math.max(3, Math.round(count / maximum * 132)) + "px";
      bar.setAttribute("aria-hidden", "true");
      container.append(bar);
      // Label only alternate dates to keep the smallest browser windows legible.
      container.append(newNode("span", "chart-label", i % 2 ? "" : day.slice(5)));
      ui.chart.append(container);
    }
    const total = values.reduce((sum, n) => sum + n, 0);
    const text = total ? `${number(total)} selections saved across 14 days.`
      : "No selections saved in the current 14-day window.";
    ui.chartDescription.textContent = text;
    ui.chart.setAttribute("aria-label", dates.map((day,i) => day + ": " + values[i]).join("; "));
  }
  function paint(snapshot) {
    telemetry = snapshot;
    totals = Object.fromEntries(EVENTS.map(event => [event, 0]));
    for (const row of telemetry.days) {
      for (const event of EVENTS) totals[event] += row.counts?.[event] || 0;
    }
    ui.record.checked = telemetry.enabled;
    ui.recordLabel.textContent = telemetry.enabled ? "Recording on" : "Recording off";
    ui.collection.textContent = telemetry.enabled ? "Only anonymous aggregate counts · this device" : "No new activity is being recorded";
    ui.collection.dataset.active = String(telemetry.enabled);
    $("metric-saved").textContent = number(count("rules_saved"));
    $("metric-pages").textContent = number(count("page_cleaned"));
    $("metric-restores").textContent = number(count("rule_restored") + count("site_restored"));
    $("metric-guards").textContent = number(count("mutation_backoff") + count("scan_deferred") + count("safety_paused"));
    for (const [id, event] of [
      ["health-picker", "picker_started"], ["health-cancelled", "picker_cancelled"],
      ["health-failed", "picker_failed"], ["health-backoff", "mutation_backoff"],
      ["health-yields", "scan_deferred"], ["health-paused", "safety_paused"]
    ]) $(id).textContent = number(count(event));
    ui.export.disabled = !telemetry.days.length;
    chart();
  }
  function resetClear() {
    clearArmed = false;
    ui.clear.textContent = "Clear telemetry";
    ui.clear.classList.remove("confirm");
  }
  function showBusy(next) {
    busy = next;
    ui.record.disabled = next;
    ui.refresh.disabled = next;
    ui.clear.disabled = next;
    ui.export.disabled = next || !telemetry.days.length;
  }
  async function refresh() {
    const result = await request("TELEMETRY_READ");
    paint(result.telemetry);
    $("sites-approved").textContent = number(result.approvedSites);
    $("rules-present").textContent = number(result.savedRules);
  }
  function perform(job) {
    serial = serial.catch(() => {}).then(async () => {
      showBusy(true);
      try { await job(); }
      catch (error) { announce(error.message || "Could not read local data.", true); await refresh().catch(() => {}); }
      finally { showBusy(false); }
    });
  }
  ui.record.addEventListener("change", () => {
    const enabled = ui.record.checked;
    resetClear();
    perform(async () => {
      const result = await request("TELEMETRY_SET", { enabled });
      paint(result.telemetry);
      announce(enabled
        ? "Local counting enabled. No website information will be recorded."
        : "Counting paused. Existing aggregate data stays until cleared.");
    });
  });
  ui.refresh.addEventListener("click", () => {
    resetClear();
    perform(async () => { await refresh(); announce("Local dashboard refreshed."); });
  });
  ui.clear.addEventListener("click", () => {
    if (busy) return;
    if (!clearArmed) {
      clearArmed = true;
      ui.clear.textContent = "Confirm clear";
      ui.clear.classList.add("confirm");
      announce("Select Confirm clear to delete the local 14-day activity record.");
      return;
    }
    resetClear();
    perform(async () => {
      const result = await request("TELEMETRY_CLEAR");
      paint(result.telemetry);
      await refresh();
      announce("All local telemetry counters have been deleted.");
    });
  });
  ui.export.addEventListener("click", () => {
    if (busy || !telemetry.days.length) return;
    const safe = { version: 1, enabled: telemetry.enabled,
      retention: "14 UTC calendar days", days: telemetry.days };
    const blob = new Blob([JSON.stringify(safe, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vanish-local-signal.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce("Export generated locally. No telemetry was transmitted.");
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.hasOwn(changes, "vanish.telemetry.v1") && !busy) {
      perform(async () => { await refresh(); });
    }
    if (area === "local" && Object.hasOwn(changes, "vanish.preferences")) {
      const theme = changes["vanish.preferences"].newValue?.theme;
      document.documentElement.dataset.theme = ["light","dark","system"].includes(theme) ? theme : "system";
    }
  });
  perform(async () => {
    const pref = (await chrome.storage.local.get("vanish.preferences"))["vanish.preferences"];
    document.documentElement.dataset.theme = ["light","dark","system"].includes(pref?.theme)
      ? pref.theme : "system";
    await refresh();
    announce("");
  });
})();
