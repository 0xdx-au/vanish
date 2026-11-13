(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const ui = {domain:$("domain"),count:$("count"),pick:$("pick"),rules:$("rules"),undo:$("undo"),
    restore:$("restore"),forget:$("forget"),access:$("access"),enabled:$("enabled"),status:$("status"),theme:$("theme")};
  const prefKey = "vanish.preferences";
  let key = null, tabId = null, hostPattern = null, scriptId = null, state = {enabled:true,rules:[]};

  function normalise(raw) {
    return {enabled:raw?.enabled!==false,rules:Array.isArray(raw?.rules)?raw.rules.filter(r =>
      r && typeof r.id==="string" && Array.isArray(r.selectors)).slice(0,100):[]};
  }
  const announce = message => {ui.status.textContent = message;};
  function empty(message) {const x=document.createElement("div");x.className="empty";x.textContent=message;return x;}
  function unavailable(message) {
    ui.domain.textContent=message; ui.count.textContent="Unavailable";
    for(const item of [ui.pick,ui.undo,ui.restore,ui.forget,ui.enabled]) item.disabled=true;
    ui.access.textContent = "This page cannot grant Vanish access.";
    ui.rules.replaceChildren(empty("Open an ordinary HTTP(S) page."));
  }
  function draw() {
    ui.enabled.checked=state.enabled;
    ui.count.textContent=state.rules.length+" saved";
    ui.undo.disabled=ui.restore.disabled=state.rules.length===0;
    ui.rules.replaceChildren();
    if(!state.rules.length){ui.rules.append(empty("Nothing hidden. Select a page element to begin."));return;}
    for(const rule of [...state.rules].reverse()){
      const row=document.createElement("div");row.className="rule";
      const copy=document.createElement("div");copy.className="rule-label";
      const title=document.createElement("strong");title.textContent=rule.label||"Hidden item";title.title=title.textContent;
      const detail=document.createElement("small");detail.textContent=rule.unlockScroll?"Overlay / scroll recovery":"Element / visual rule";
      copy.append(title,detail);
      const button=document.createElement("button");button.type="button";button.textContent="Restore";
      button.setAttribute("aria-label","Restore "+title.textContent);
      button.addEventListener("click",()=>change(next=>{next.rules=next.rules.filter(r=>r.id!==rule.id);},"Item restored."));
      row.append(copy,button);ui.rules.append(row);
    }
  }
  async function change(mutator,message){
    if(!key)return;
    try{
      const result=await chrome.storage.local.get(key);
      const next=normalise(result[key]);mutator(next);
      await chrome.storage.local.set({[key]:next});
      state=next;draw();announce(message);
    }catch(error){announce("Could not save: "+(error?.message||"storage unavailable"));}
  }
  async function deliver(message){
    try{return await chrome.tabs.sendMessage(tabId,message,{frameId:0});}
    catch{
      await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},files:["content.js"]});
      return chrome.tabs.sendMessage(tabId,message,{frameId:0});
    }
  }
  async function ensureHostAccess() {
    if (!hostPattern || !scriptId) throw new Error("Unsupported page");
    // This API is deliberately first in the click's async path: Chrome requires a user gesture.
    const approved = await chrome.permissions.request({origins:[hostPattern]});
    if (!approved) throw new Error("Site access declined; nothing was changed");
    const registered = await chrome.scripting.getRegisteredContentScripts({ids:[scriptId]});
    if (!registered.length) {
      await chrome.scripting.registerContentScripts([{
        id:scriptId,matches:[hostPattern],js:["content.js"],
        runAt:"document_start",allFrames:false,persistAcrossSessions:true
      }]);
    }
    ui.access.textContent = "✓ Permission granted for this website only.";
    ui.forget.disabled = false;
  }
  ui.pick.addEventListener("click",async()=>{
    ui.pick.disabled=true;
    try{
      await ensureHostAccess();
      const result=await deliver({type:"START_PICK"});
      if(!result?.ok)throw new Error(result?.error||"picker unavailable");
      window.close();
    }catch(error){announce("Picker unavailable: "+(error?.message||"try reloading"));ui.pick.disabled=false;}
  });
  ui.forget.addEventListener("click", async () => {
    if (!key || !hostPattern || !scriptId) return;
    ui.forget.disabled=true;
    try {
      // Remove stored selectors first; an already-running script then restores the page.
      await chrome.storage.local.remove(key);
      const scripts=await chrome.scripting.getRegisteredContentScripts({ids:[scriptId]});
      if (scripts.length) await chrome.scripting.unregisterContentScripts({ids:[scriptId]});
      const revoked=await chrome.permissions.remove({origins:[hostPattern]});
      state={enabled:true,rules:[]};draw();
      ui.access.textContent=revoked?"No site permission. Access fully revoked.":"No site permission is currently granted.";
      announce("Site data cleared. Reload the tab to unload its existing script.");
    } catch(error) {
      announce("Incomplete site reset: "+(error?.message||"check Chrome site permissions"));
      ui.forget.disabled=false;
    }
  });
  ui.undo.addEventListener("click",()=>change(next=>{next.rules.pop();},"Last rule restored."));
  ui.restore.addEventListener("click",()=>change(next=>{next.rules=[];},"Site rules cleared."));
  ui.enabled.addEventListener("change",()=>change(next=>{next.enabled=ui.enabled.checked;},ui.enabled.checked?"Hiding enabled.":"Hiding paused."));
  ui.theme.addEventListener("change",async()=>{
    const theme=ui.theme.value;
    document.documentElement.dataset.theme=theme;
    try{await chrome.storage.local.set({[prefKey]:{theme}});}catch{announce("Appearance preference could not be saved.");}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==="local"&&key&&Object.hasOwn(changes,key)){state=normalise(changes[key].newValue);draw();}
  });
  (async()=>{
    try{
      const preference=(await chrome.storage.local.get(prefKey))[prefKey];
      const theme=["system","light","dark"].includes(preference?.theme)?preference.theme:"system";
      ui.theme.value=theme;document.documentElement.dataset.theme=theme;
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!tab?.id||!/^https?:\/\//i.test(tab.url||""))return unavailable("Unsupported page");
      const url=new URL(tab.url);tabId=tab.id;key="vanish.site."+url.hostname.toLowerCase();
      // An exact origin needs no site-wide extension content script permission at installation.
      hostPattern=url.protocol+"//"+url.hostname+"/*";
      scriptId="vanish_"+[...url.origin].map(character=>character.charCodeAt(0).toString(16).padStart(2,"0")).join("");
      ui.domain.textContent=url.hostname;
      const permitted=await chrome.permissions.contains({origins:[hostPattern]});
      ui.access.textContent=permitted?"✓ Permission granted for this origin.":"No site access yet. Selecting requests permission.";
      ui.forget.disabled=!permitted;
      state=normalise((await chrome.storage.local.get(key))[key]);draw();
    }catch(error){unavailable("Page access unavailable");announce(error?.message||"Permission denied");}
  })();
})();
