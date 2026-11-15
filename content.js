/* VANISH / ADMINE — page picker. */
(() => {
  "use strict";
  if (globalThis.__admineVanishReady) return;
  globalThis.__admineVanishReady = true;

  const ORIGIN = location.origin;
  const CLIENT_VERSION = "1.4.1";
  const STYLE_ID = "__admine_vanish_rules";
  const MAX_RULES = 24;
  const MAX_SELECTOR = 650;
  const MAX_MATCHES = 8;
  const MAX_SCAN_MS = 16;
  const SAFE_TAGS = new Set(["body","div","section","article","aside","main","header","footer","nav","dialog","span","p","h1","h2","h3","h4","h5","h6","ul","li","ol","table","tbody","thead","tfoot","tr","td","th","a","button","form","fieldset","label","details","summary","figure","figcaption","picture","img","svg","canvas","blockquote","pre","code","small","strong","em","iframe","video","audio","ins","address","picture","time","output"]);
  const SEMANTIC_SELECTORS = new Set(['html > body [role="dialog"][aria-modal="true"]', 'html > body dialog[open]']);
  const HINT = /modal|dialog|pop.?up|overlay|interstitial|lightbox|adblock|ad.block|backdrop|scrim|dimmer|paywall|consent/i;
  let site = { enabled: true, rules: [] };
  let loaded = false;
  let picker = null;
  let toast = null;
  let toastTimeout = null;
  let observer = null;
  let ruleStyle = null;
  let scanTimeout = null;
  let stopped = false;
  let safetyPaused = false;
  let churn = 0, churnSince = 0;
  let cooldown = null;
  let scrollRepair = new Map();
  const hiddenInline = new Map();

  const element = (tag, klass, text) => {
    const node = document.createElement(tag);
    if (klass) node.className = klass;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function validSelector(selector) {
    // Validate structural selectors.
    const grammar = /^html\s*>\s*body(?:\s*>\s*[a-z][a-z0-9-]*(?::nth-of-type\([1-9]\d{0,2}\))?){1,25}$/;
    if (typeof selector !== "string" || selector.length > MAX_SELECTOR) return false;
    if (!SEMANTIC_SELECTORS.has(selector) && (!grammar.test(selector) ||
        !selector.split(/\s*>\s*/).slice(1).every(segment=>SAFE_TAGS.has(segment.split(":")[0])))) return false;
    try { document.querySelector(selector); return true; } catch { return false; }
  }
  function normalise(value) {
    const rules = Array.isArray(value?.rules) ? value.rules.filter(rule =>
      rule && typeof rule.id === "string" && /^r_[a-f0-9-]{12,40}$/.test(rule.id) &&
      Array.isArray(rule.selectors) && rule.selectors.length > 0 && rule.selectors.length <= 3 &&
      rule.selectors.every(validSelector)
    ).slice(-MAX_RULES).map(({id,selectors,unlockScroll})=>({id,selectors,unlockScroll:unlockScroll===true})) : [];
    return { enabled: value?.enabled !== false, rules };
  }
  function selectors() {
    return site.enabled ? site.rules.flatMap(rule => rule.selectors) : [];
  }
  function snapshot(node, property) {
    return { value: node.style.getPropertyValue(property), priority: node.style.getPropertyPriority(property) };
  }
  function restore(node, property, original) {
    if (original.value) node.style.setProperty(property, original.value, original.priority);
    else node.style.removeProperty(property);
  }

  function styleNode() {
    if (!document.documentElement) return null;
    if (!ruleStyle || !ruleStyle.isConnected) {
      // Keep a dedicated stylesheet reference.
      ruleStyle = element("style");
      ruleStyle.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(ruleStyle);
    }
    return ruleStyle;
  }
  function restoreScroll() {
    for (const [node, properties] of scrollRepair) {
      for (const [property, original] of properties) restore(node, property, original);
    }
    scrollRepair.clear();
  }
  function override(node, property, value) {
    if (!scrollRepair.has(node)) scrollRepair.set(node, new Map());
    const saved = scrollRepair.get(node);
    if (!saved.has(property)) saved.set(property, snapshot(node, property));
    if (node.style.getPropertyValue(property) !== value || node.style.getPropertyPriority(property) !== "important") {
      node.style.setProperty(property, value, "important");
    }
  }
  function unlockScroll() {
    if (!document.body || !document.documentElement) return;
    for (const node of [document.documentElement, document.body]) {
      const cs = getComputedStyle(node);
      if (cs.overflowY === "hidden" || scrollRepair.has(node)) {
        override(node, "overflow-y", "auto");
        if (node.style.getPropertyValue("overflow") === "hidden") override(node, "overflow", "auto");
      }
    }
    const body = document.body;
    if (getComputedStyle(body).position === "fixed" && /^-\d/.test(body.style.top.trim())) {
      override(body, "position", "static");
      override(body, "top", "auto");
      override(body, "width", "auto");
    }
  }
  function cancelInlineOverrides() {
    for (const [node, old] of hiddenInline) restore(node, "display", old);
    hiddenInline.clear();
  }

  function scan() {
    scanTimeout = null;
    if (!loaded || stopped || safetyPaused || !document.documentElement) return;
    const started = performance.now();
    const sel = selectors();
    // Keep saved rules active after DOM changes.
    const rulesCSS = sel.map(value => value + " { display: none !important; visibility: hidden !important; pointer-events: none !important; }").join("\n");
    const liveStyle = sel.length ? styleNode() : ruleStyle;
    if (liveStyle && liveStyle.textContent !== rulesCSS) liveStyle.textContent = rulesCSS;
    if (!sel.length) {
      cancelInlineOverrides();
      restoreScroll();
      return;
    }
    const matched = new Set();
    let overlayMatch = false;
    for (const rule of site.rules) {
      if (!site.enabled) break;
      for (const selector of rule.selectors) {
        try {
          const found = document.querySelectorAll(selector);
          if (found.length > MAX_MATCHES) { pauseForSafety("Rule matched too many elements"); return; }
          for (const node of found) {
            if (performance.now() - started > MAX_SCAN_MS) { scheduleScan(800); return; }
            if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) continue;
            matched.add(node);
            if (rule.unlockScroll) overlayMatch = true;
            // Inline!important beats the host page; a stylesheet alone is not enough.
            if (!hiddenInline.has(node)) hiddenInline.set(node, snapshot(node, "display"));
            if (node.style.getPropertyValue("display") !== "none" || node.style.getPropertyPriority("display") !== "important") {
              node.style.setProperty("display", "none", "important");
            }
          }
        } catch { /* DOM changed. */ }
      }
    }
    for (const [node, original] of hiddenInline) {
      if (!matched.has(node)) { restore(node, "display", original); hiddenInline.delete(node); }
    }
    if (overlayMatch) unlockScroll();
    else restoreScroll();
  }

  function scheduleScan(delay = 240) {
    if (stopped || safetyPaused || scanTimeout !== null || cooldown !== null) return;
    scanTimeout = setTimeout(scan, delay);
  }
  function pauseForSafety(reason) {
    safetyPaused = true;
    observer?.disconnect();
    observer = null;
    if (scanTimeout !== null) clearTimeout(scanTimeout);
    scanTimeout = null;
    if (cooldown !== null) clearTimeout(cooldown);
    cooldown = null;
    cancelInlineOverrides();
    restoreScroll();
    ruleStyle?.remove(); ruleStyle = null;
    show("Vanish paused", "The page changed too quickly. Reload to retry.");
  }
  function watch() {
    const active = loaded && !stopped && !safetyPaused && selectors().length > 0 && document.documentElement;
    if (!active) {
      observer?.disconnect();
      observer = null;
      return;
    }
    if (!observer) {
      observer = new MutationObserver(records => {
        const meaningful = records.filter(record => {
          if (record.type === "childList" || record.attributeName !== "style") return true;
          if (hiddenInline.has(record.target)) {
            return record.target.style.getPropertyValue("display") !== "none" ||
              record.target.style.getPropertyPriority("display") !== "important";
          }
          if (scrollRepair.has(record.target)) {
            return record.target.style.getPropertyValue("overflow-y") !== "auto" ||
              record.target.style.getPropertyPriority("overflow-y") !== "important";
          }
          return true;
        });
        if (!meaningful.length) return;
        const now = performance.now();
        if (!churnSince || now - churnSince > 3000) { churnSince = now; churn = 0; }
        churn += meaningful.length;
        if (churn > 1000) {
          // Back off on busy pages without discarding any rules or stopping CSS.
          observer?.disconnect(); observer = null;
          if (scanTimeout !== null) clearTimeout(scanTimeout);
          scanTimeout = null;
          cooldown = setTimeout(() => {
            cooldown = null; churn = 0; churnSince = 0;
            if (!stopped && !safetyPaused) { watch(); scheduleScan(0); }
          }, 1200);
          return;
        }
        scheduleScan();
      });
      observer.observe(document.documentElement, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ["class", "style", "open", "aria-hidden"]
      });
    }
  }
  function apply() {
    if (!document.documentElement) {
      document.addEventListener("DOMContentLoaded", apply, { once: true });
      return;
    }
    const list = stopped || safetyPaused ? [] : selectors();
    const css = list.map(s => s + " { display: none !important; visibility: hidden !important; pointer-events: none !important; }").join("\n");
    if (list.length) {
      const style = styleNode();
      if (style && style.textContent !== css) style.textContent = css;
    } else {
      ruleStyle?.remove(); ruleStyle = null;
      cancelInlineOverrides();
      restoreScroll();
    }
    watch();
    if (list.length) scan(); // Apply immediately.
  }
  function checkStyle() {
    if (loaded && site.enabled && site.rules.length) {
      const s = styleNode();
      if (!s || !s.isConnected) apply();
    }
  }

  function unique(selector) {
    if (!validSelector(selector)) return false;
    try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
  }
  function selectorFor(node) {
    if (!(node instanceof Element) || !node.isConnected ||
        node === document.body || node === document.documentElement) return null;
    if (node.closest("input,textarea,select,[contenteditable=true]")) return null;
    const parts = [];
    let current = node;
    while (current && current.localName !== "html" && parts.length < 26) {
      const tag = current.localName;
      if (!SAFE_TAGS.has(tag)) return null;
      const siblings = current.parentElement ?
        [...current.parentElement.children].filter(x => x.localName === tag) : [];
      const index = siblings.indexOf(current) + 1;
      const segment = tag + (siblings.length > 1 ? ":nth-of-type(" + index + ")" : "");
      parts.unshift(segment);
      current = current.parentElement;
    }
    if (!current || current.localName !== "html" || parts[0] !== "body") return null;
    const candidate = "html > " + parts.join(" > ");
    return validSelector(candidate) && unique(candidate) ? candidate : null;
  }
  function semanticFor(node) {
    if (node.matches('[role="dialog"][aria-modal="true"]')) {
      const selector = 'html > body [role="dialog"][aria-modal="true"]';
      if (unique(selector)) return selector;
    }
    if (node.matches("dialog[open]")) {
      const selector = 'html > body dialog[open]';
      if (unique(selector)) return selector;
    }
    return null;
  }
  function rectUsable(rect) {
    return rect.width >= 25 && rect.height >= 20 && rect.bottom > 0 && rect.right > 0 &&
      rect.top < innerHeight && rect.left < innerWidth;
  }
  function chooseTarget(start, exact) {
    if (!(start instanceof Element) || start === document.body || start === document.documentElement) return null;
    if (exact) return start;
    let dialog = null, positioned = null, fullscreen = null;
    for (let node = start; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      if (!rectUsable(rect)) continue;
      const style = getComputedStyle(node);
      const name = node.id + " " + (typeof node.className === "string" ? node.className : "");
      const large = rect.width > 150 && rect.height > 100;
      if (!dialog && large && (node.matches("dialog,[role=dialog],[aria-modal=true]") || HINT.test(name))) dialog = node;
      if (!positioned && large && ["fixed", "absolute", "sticky"].includes(style.position) &&
          rect.width * rect.height < innerWidth * innerHeight * 1.12) positioned = node;
      if (!fullscreen && style.position === "fixed" && rect.width >= innerWidth * .85 && rect.height >= innerHeight * .85 &&
          (HINT.test(name) || Number(style.zIndex) > 1)) fullscreen = node;
    }
    return dialog || positioned || fullscreen || start;
  }
  function looksLikeBackdrop(node) {
    if (!(node instanceof Element)) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < innerWidth * .8 || rect.height < innerHeight * .8) return false;
    const style = getComputedStyle(node);
    if (!["fixed", "absolute"].includes(style.position) || style.display === "none") return false;
    const name = node.id + " " + (typeof node.className === "string" ? node.className : "");
    return /backdrop|scrim|dimmer|underlay|shade|mask/i.test(name) ||
      (node.childElementCount === 0 &&
      !["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor));
  }
  function backdrops(primary) {
    const found = [];
    let branch = primary;
    for (let depth = 0; branch?.parentElement && depth < 5; depth++, branch = branch.parentElement) {
      const children = branch.parentElement.children;
      if (children.length > 40) continue;
      for (const node of children) {
        if (node === branch || !looksLikeBackdrop(node)) continue;
        const sel = selectorFor(node);
        if (sel && !found.includes(sel)) found.push(sel);
        if (found.length === 2) return found;
      }
    }
    return found;
  }
  function isOverlay(node) {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const name = node.id + " " + (typeof node.className === "string" ? node.className : "");
    return node.matches("dialog,[role=dialog],[aria-modal=true]") || HINT.test(name) ||
      (["fixed","absolute"].includes(style.position) && rect.width > 160 && rect.height > 100);
  }
  function makeUI(id) {
    const host = element("div");
    host.id = id;
    host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;";
    const root = host.attachShadow({ mode: "closed" });
    const style = element("style");
    style.textContent = [
      "*{box-sizing:border-box}",
      ".bar{position:fixed;left:50%;top:max(12px,env(safe-area-inset-top));transform:translateX(-50%);width:max-content;max-width:calc(100vw - 24px);display:flex;align-items:center;gap:12px;background:#101010;color:#f5f4f0;padding:10px 12px;border:1px solid #53514d;border-radius:6px;box-shadow:0 8px 28px #0007;font:12px/1.5 system-ui,sans-serif;pointer-events:auto}",
      ".mark{color:#ff95ca;font-weight:900;font-size:16px;letter-spacing:-.05em}",
      ".copy{min-width:0}.copy strong{display:block;white-space:normal;font-size:12px}.copy small{display:block;color:#bdbbb3;font-size:10px;margin-top:2px}",
      "button{background:#252525;color:#f5f4f0;border:1px solid #555;border-radius:4px;padding:7px 10px;font:700 11px system-ui;cursor:pointer;min-height:34px}",
      "button:focus-visible{outline:2px solid #ff95ca;outline-offset:2px}",
      ".outline{position:fixed;display:none;pointer-events:none;border:2px solid #ff95ca;background:#ff95ca20;box-shadow:0 0 0 2px #101010,0 0 0 3px #ff95ca;border-radius:2px}",
      "@media(max-width:480px){.bar{top:auto;bottom:max(12px,env(safe-area-inset-bottom));gap:8px;padding:9px}}",
      "@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}"
    ].join("\n");
    root.append(style);
    document.documentElement.append(host);
    return { host, root };
  }
  function endToast() {
    if (toastTimeout !== null) clearTimeout(toastTimeout);
    toastTimeout = null;
    toast?.host.remove();
    toast = null;
  }
  function show(title, sub, undoId) {
    endToast();
    if (!document.documentElement) return;
    const ui = makeUI("__admine_vanish_notice");
    const bar = element("div","bar");
    const mark = element("span","mark","A.");
    const copy = element("div","copy");
    copy.append(element("strong","",title),element("small","",sub));
    bar.append(mark,copy);
    if (undoId) {
      const undo = element("button","","UNDO");
      undo.addEventListener("click", async event => {
        event.stopPropagation();
        try {
          const result = await chrome.runtime.sendMessage({type:"CONTENT_REMOVE",id:undoId});
          if (!result?.ok) throw new Error(result?.error || "Undo denied");
          site = normalise(result.state);
          apply();
          show("Restored", "Item is visible again.");
        } catch { show("Restore failed", "Open Vanish and remove the rule manually."); }
      });
      bar.append(undo);
    }
    const close = element("button","","×");
    close.setAttribute("aria-label","Dismiss Vanish notice");
    close.addEventListener("click", e => {e.stopPropagation();endToast();});
    bar.append(close);
    ui.root.append(bar);
    toast = ui;
    toastTimeout = setTimeout(endToast, 6500);
  }
  function ownUI(event) {
    const path = event.composedPath?.() || [];
    return Boolean((picker && path.includes(picker.host)) || (toast && path.includes(toast.host)));
  }
  function preview(event) {
    if (!picker || ownUI(event)) return;
    const target = chooseTarget(document.elementFromPoint(event.clientX,event.clientY),event.shiftKey);
    const outline = picker.outline;
    if (!target) {outline.style.display="none";return;}
    const rect=target.getBoundingClientRect();
    outline.style.display="block";
    outline.style.left=Math.max(0,rect.left)+"px";
    outline.style.top=Math.max(0,rect.top)+"px";
    outline.style.width=Math.max(1,Math.min(innerWidth,rect.right)-Math.max(0,rect.left))+"px";
    outline.style.height=Math.max(1,Math.min(innerHeight,rect.bottom)-Math.max(0,rect.top))+"px";
  }
  function swallow(event) {
    if (picker && !ownUI(event) && event.button===0) {
      event.preventDefault();event.stopImmediatePropagation();
    }
  }
  function cancelKey(event) {
    if (event.key==="Escape") {
      event.preventDefault();event.stopImmediatePropagation();
      stopPicker();show("Cancelled", "No change made.");
    }
  }
  function stopPicker() {
    if (!picker) return;
    document.removeEventListener("pointermove",preview,true);
    document.removeEventListener("pointerdown",swallow,true);
    document.removeEventListener("mousedown",swallow,true);
    document.removeEventListener("mouseup",swallow,true);
    document.removeEventListener("click",pickClick,true);
    document.removeEventListener("keydown",cancelKey,true);
    picker.host.remove();picker=null;
  }
  async function save(target, exact) {
    const primary = selectorFor(target);
    if (!primary) return show("Couldn't hide this", "Try selecting a different part of the item.");
    const sel = [primary, ...(exact ? [] : [semanticFor(target), ...backdrops(target)])]
      .filter((value,index,all)=>value && all.indexOf(value)===index).slice(0,3);
    try {
      const result = await chrome.runtime.sendMessage({
        type: "CONTENT_SAVE", rule: { selectors: sel, unlockScroll: !exact && isOverlay(target) }
      });
      if (!result?.ok) throw new Error(result?.error || "Rule refused");
      site = normalise(result.state);
      loaded = true;
      apply();
      show("Gone!", "Saved for this website.", result.id);
    } catch (error) {
      show("Couldn't save", "Try again or choose another element.");
    }
  }
  function pickClick(event) {
    if (!picker || ownUI(event) || event.button!==0) return;
    event.preventDefault();event.stopImmediatePropagation();
    const node=chooseTarget(document.elementFromPoint(event.clientX,event.clientY),event.shiftKey);
    const exact=event.shiftKey;
    stopPicker();
    if (node) void save(node,exact);
    else show("Nothing selected","Try the middle of the popup.");
  }
  function startPicker() {
    if (!document.documentElement) return {ok:false,error:"Document not ready"};
    endToast();stopPicker();
    const ui=makeUI("__admine_vanish_picker");
    const bar=element("div","bar");
    const copy=element("div","copy");
    copy.append(element("strong","","VANISH / SELECT AN ELEMENT"),
      element("small","","Click to hide · Shift for precise selection · Esc to cancel"));
    const cancel=element("button","","CANCEL");
    cancel.addEventListener("click",event=>{event.stopPropagation();stopPicker();});
    bar.append(element("span","mark","A."),copy,cancel);
    const outline=element("div","outline");
    ui.root.append(outline,bar);
    picker={...ui,outline};
    document.addEventListener("pointermove",preview,true);
    document.addEventListener("pointerdown",swallow,true);
    document.addEventListener("mousedown",swallow,true);
    document.addEventListener("mouseup",swallow,true);
    document.addEventListener("click",pickClick,true);
    document.addEventListener("keydown",cancelKey,true);
    return {ok:true};
  }

  async function loadRules() {
    const result = await chrome.runtime.sendMessage({type:"CONTENT_READ"});
    site = result?.ok ? normalise(result.state) : {enabled:false,rules:[]};
    loaded = true;
    apply();
    return result?.ok === true;
  }
  function shutdown() {
    stopped = true;
    stopPicker();
    endToast();
    observer?.disconnect();observer=null;
    if (scanTimeout !== null) clearTimeout(scanTimeout);
    scanTimeout=null;
    if (cooldown !== null) clearTimeout(cooldown);
    cooldown=null;
    cancelInlineOverrides();
    restoreScroll();
    ruleStyle?.remove(); ruleStyle = null;
    site={enabled:false,rules:[]};
  }
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if (!message || typeof message!=="object") return;
    if (message.type === "CONTENT_SHUTDOWN_ALL" ||
      (message.type === "CONTENT_SHUTDOWN" && message.hostname === location.hostname)) {
      shutdown();respond({ok:true});return;
    }
    if (message.type === "RULES_REFRESH") {
      if (stopped) {respond({ok:false,error:"Reload page after revocation"});return;}
      safetyPaused=false;void loadRules().then(ok=>respond({ok})).catch(e=>respond({ok:false,error:e.message}));
      return true;
    }
    if (message.type === "START_PICK") {
      if (stopped) {respond({ok:false,error:"Reload page to reactivate"});return;}
      void loadRules().then(ok=>respond(ok?startPicker():{ok:false,error:"Origin not approved"}))
        .catch(e=>respond({ok:false,error:e.message}));
      return true;
    }
    if (message.type === "CANCEL_PICK") {stopPicker();respond({ok:true});}
    else if (message.type === "STATUS") respond({ok:true,enabled:site.enabled,count:site.rules.length,
      paused:safetyPaused,stopped,version:CLIENT_VERSION});
  });
  void loadRules().catch(()=>{site={enabled:false,rules:[]};loaded=true;apply();});
})();
