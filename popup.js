/* VANISH / ADMINE — network-free extension control. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const ui = {domain:$("domain"),count:$("count"),pick:$("pick"),rules:$("rules"),
    undo:$("undo"),restore:$("restore"),forget:$("forget"),forgetAll:$("forget-all"),
    access:$("access"),enabled:$("enabled"),status:$("status"),theme:$("theme")};
  const prefKey="vanish.preferences";
  let tabId=null,origin=null,hostname=null,approved=false,ready=false;
  let state={enabled:true,rules:[]};
  const announce=message=>{ui.status.textContent=message;};
  function el(tag,name,value) {
    const e=document.createElement(tag);
    if(name)e.className=name;
    if(value!==undefined)e.textContent=value;
    return e;
  }
  async function ask(type,options={}) {
    const response=await chrome.runtime.sendMessage({type,...options});
    if(!response?.ok)throw new Error(response?.error||"Extension request rejected");
    return response;
  }
  function unavailable(message) {
    ui.domain.textContent=message;
    ui.count.textContent="Unavailable";
    for(const x of [ui.pick,ui.undo,ui.restore,ui.forget,ui.enabled])x.disabled=true;
    ui.access.textContent="Open an ordinary HTTP(S) webpage.";
    ui.rules.replaceChildren(el("div","empty","No active site."));
  }
  function draw() {
    ui.count.textContent=state.rules.length+" saved";
    ui.enabled.checked=state.enabled;
    ui.enabled.disabled=!approved||!ready;
    ui.forget.disabled=!approved||!ready;
    ui.undo.disabled=ui.restore.disabled=state.rules.length===0||!ready;
    ui.rules.replaceChildren();
    if(!state.rules.length) {
      ui.rules.append(el("div","empty","Nothing hidden on this origin."));
      return;
    }
    for(let i=state.rules.length-1;i>=0;i--){
      const rule=state.rules[i],row=el("div","rule"),copy=el("div","rule-label");
      const title=el("strong","","Hidden element "+String(i+1).padStart(2,"0"));
      const detail=el("small","",rule.unlockScroll?"Overlay / scroll repair":"Visual selection");
      copy.append(title,detail);
      const restore=el("button","","Restore");restore.type="button";restore.disabled=!approved;
      restore.setAttribute("aria-label","Restore hidden element "+(i+1));
      restore.addEventListener("click",()=>mutate("ADMIN_REMOVE",{id:rule.id},"Element restored."));
      row.append(copy,restore);ui.rules.append(row);
    }
  }
  async function refresh(){
    if(!origin)return;
    const data=await ask("ADMIN_READ",{origin});
    state=data.state;approved=data.approved;ready=true;
    ui.access.textContent=approved?
      "✓ Approved origin. Local rules only.":
      "No approval for this origin. Chrome will ask on selection.";
    draw();
  }
  async function refreshTab(){
    if(!tabId)return;
    try{await chrome.tabs.sendMessage(tabId,{type:"RULES_REFRESH"},{frameId:0});}
    catch{/* Tab may have no content script. */}
  }
  async function mutate(type,options,message){
    if(!origin)return;
    try{
      const response=await ask(type,{origin,...options});
      state=response.state;draw();await refreshTab();announce(message);
    }catch(error){announce("Change failed: "+error.message);}
  }
  async function deliver(message){
    try{return await chrome.tabs.sendMessage(tabId,message,{frameId:0});}
    catch{
      await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},files:["content.js"]});
      return chrome.tabs.sendMessage(tabId,message,{frameId:0});
    }
  }
  ui.pick.addEventListener("click",async()=>{
    if(!origin||!hostname)return;
    ui.pick.disabled=true;
    try{
      const url=new URL(origin);
      // This must be the first await after the click so Chrome retains the user gesture.
      const granted=await chrome.permissions.request({origins:[url.protocol+"//"+url.hostname+"/*"]});
      if(!granted)throw new Error("Permission declined. No changes were saved.");
      await ask("ADMIN_APPROVE",{origin});
      await refresh();
      const result=await deliver({type:"START_PICK"});
      if(!result?.ok)throw new Error(result?.error||"Picker unavailable");
      window.close();
    }catch(error){announce(error.message||"Picker unavailable");ui.pick.disabled=false;}
  });
  ui.undo.addEventListener("click",()=>{
    const last=state.rules.at(-1);
    if(last)void mutate("ADMIN_REMOVE",{id:last.id},"Last selection restored.");
  });
  ui.restore.addEventListener("click",()=>mutate("ADMIN_CLEAR",{},"Origin rules cleared."));
  ui.enabled.addEventListener("change",()=>mutate("ADMIN_TOGGLE",{enabled:ui.enabled.checked},
    ui.enabled.checked?"Hiding resumed.":"Hiding paused."));
  ui.forget.addEventListener("click",async()=>{
    if(!hostname)return;
    ui.forget.disabled=true;
    try{
      const result=await ask("ADMIN_FORGET_HOST",{hostname});
      state={enabled:true,rules:[]};approved=false;draw();
      ui.access.textContent="Hostname permissions and local rules revoked.";
      announce("Revoked "+result.revokedOrigins+" approved origins. Reload open tabs.");
    }catch(error){announce("Revocation incomplete: "+error.message);ui.forget.disabled=false;}
  });
  ui.forgetAll.addEventListener("click",async()=>{
    ui.forgetAll.disabled=true;
    try{
      await ask("ADMIN_CLEAR_ALL");
      state={enabled:true,rules:[]};approved=false;draw();
      ui.access.textContent="All sites cleared and permissions revoked.";
      announce("All sites reset. Reload already-open tabs.");
    }catch(error){announce("Global reset incomplete: "+error.message);}
    finally{ui.forgetAll.disabled=false;}
  });
  ui.theme.addEventListener("change",async()=>{
    const theme=ui.theme.value;document.documentElement.dataset.theme=theme;
    try{await chrome.storage.local.set({[prefKey]:{theme}});}
    catch{announce("Theme preference was not saved.");}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="local"||!origin)return;
    if(Object.hasOwn(changes,"vanish.rules.v3."+encodeURIComponent(origin)))
      void refresh().catch(()=>{});
  });
  (async()=>{
    try{
      const pref=(await chrome.storage.local.get(prefKey))[prefKey];
      const theme=["system","light","dark"].includes(pref?.theme)?pref.theme:"system";
      ui.theme.value=theme;document.documentElement.dataset.theme=theme;
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!tab?.id||!/^https?:\/\//i.test(tab.url||""))return unavailable("Unsupported page");
      const url=new URL(tab.url);
      tabId=tab.id;origin=url.origin;hostname=url.hostname.toLowerCase();
      ui.domain.textContent=origin;await refresh();
    }catch(error){unavailable("Unavailable");announce(error.message||"Browser permission error");}
  })();
})();
