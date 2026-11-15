#!/usr/bin/env python3
"""Real, unpacked Manifest V3 acceptance test. No mock chrome APIs.
Runs Chromium+extension against loopback HTTP fixtures only.
"""
from __future__ import annotations
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from tempfile import TemporaryDirectory
import json, time, os, subprocess
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
SECRET="never-persist-this@example.invalid"
HTML="""<!doctype html><html><head><meta charset="utf-8"><title>VANISH_FIXTURE</title>
<style>
html,body{margin:0;font-family:system-ui,sans-serif}
body{overflow:hidden}
main{padding:40px;min-height:1700px;background:#eff5f2}
#shade{position:fixed;inset:0;background:#0009;z-index:20}
#modal{position:fixed;top:25%;left:25%;width:50%;min-height:280px;z-index:30;background:white;
box-shadow:0 5px 50px #0006;text-align:center;padding:35px}
</style></head><body>
<main><h1>Visible article content</h1><p>Only a local synthetic browser fixture.</p><p id="storm">test</p></main>
<div id="shade"></div><section id="modal" role="dialog" aria-modal="true">
<h2>Popup interruption</h2><p>SENSITIVE_MARKER</p><button>Allow ads</button>
</section></body></html>""".replace("SENSITIVE_MARKER",SECRET)

class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        body=HTML.encode()
        self.send_response(200)
        self.send_header("Content-Type","text/html; charset=utf-8")
        self.send_header("Content-Length",str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self,*_): pass

def server():
    h=ThreadingHTTPServer(("127.0.0.1",0),Fixture)
    t=Thread(target=h.serve_forever,daemon=True);t.start()
    return h,"http://127.0.0.1:"+str(h.server_address[1])

proxy_hits=[]
class EgressTrap(BaseHTTPRequestHandler):
    def do_CONNECT(self):
        proxy_hits.append(("CONNECT",self.path))
        self.send_response(403);self.end_headers()
    def do_GET(self):
        proxy_hits.append(("GET",self.path))
        self.send_response(403);self.end_headers()
    def log_message(self,*_): pass

def check(assertion, message):
    if not assertion: raise AssertionError(message)
    print("PASS:",message,flush=True)

def broker(page,kind,options=None):
    options=options or {}
    return page.evaluate("async input => chrome.runtime.sendMessage({type:input.kind,...input.options})",
                         {"kind":kind,"options":options})

def find_target_tab(popup,origin):
    tabs=popup.evaluate("async()=>chrome.tabs.query({})")
    for tab in tabs:
        if (tab.get("url") or "").startswith(origin) and "id" in tab:
            return tab["id"]
    raise RuntimeError("Could not discover approved test tab: "+str(tabs))

with TemporaryDirectory(prefix="vanish-mv3-") as profile, sync_playwright() as p:
    primary,origin=server()
    secondary,origin2=server()
    trap=ThreadingHTTPServer(("127.0.0.1",0),EgressTrap)
    Thread(target=trap.serve_forever,daemon=True).start()
    requests=[]
    try:
        context=p.chromium.launch_persistent_context(
            profile,channel="chromium",headless=os.getenv("VANISH_HEADED") != "1",
            args=["--proxy-server=http://127.0.0.1:"+str(trap.server_address[1]),
                  "--proxy-bypass-list=127.0.0.1;localhost",
                  "--disable-extensions-except="+str(ROOT),
                  "--load-extension="+str(ROOT),
                  "--disable-background-networking","--no-first-run"])
        context.on("request",lambda req:requests.append(req.url))
        worker=context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker",timeout=25000)
        extension_id=worker.evaluate("chrome.runtime.id")
        check(bool(extension_id),"Real unpacked MV3 extension and worker started")
        target=context.new_page()
        target.goto(origin+"/",wait_until="domcontentloaded")
        # Prove our independent transport trap actually catches browser egress.
        target.evaluate("""async()=>{
          try{await fetch('https://blocked.invalid/probe',{mode:'no-cors'});}catch{}
        }""")
        target.wait_for_timeout(250)
        check(any("blocked.invalid" in entry[1] for entry in proxy_hits),
              "Local network proxy captures a deliberately blocked control request")
        proxy_hits.clear();requests.clear()
        popup=context.new_page()
        popup.goto("chrome-extension://"+extension_id+"/popup.html",wait_until="domcontentloaded")
        check(popup.evaluate("async()=>chrome.extension.isAllowedIncognitoAccess()") is False,
              "Incognito extension permission is prohibited")
        # The on-device telemetry dashboard runs as a real trusted extension page.
        dashboard=context.new_page()
        dashboard.goto("chrome-extension://"+extension_id+"/dashboard.html",wait_until="domcontentloaded")
        dashboard.wait_for_function("!document.getElementById('recording').disabled",timeout=9000)
        initial=broker(dashboard,"TELEMETRY_READ")
        check(initial.get("ok") is True and initial["telemetry"]["enabled"] is False and
              initial["telemetry"]["days"]==[],
              "Local telemetry defaults OFF with no saved activity")
        check(broker(popup,"TELEMETRY_READ").get("ok") is False and
              broker(popup,"TELEMETRY_SET",{"enabled":True}).get("ok") is False,
              "Only the exact dashboard extension URL may read or change telemetry")
        check(dashboard.locator("#recording").is_visible() and
              dashboard.locator("#chart").is_visible(),
              "Actual on-device dashboard has consent and daily chart controls")
        dashboard.locator("#recording").check()
        dashboard.wait_for_function("document.getElementById('recording-label').textContent.includes('on')")
        check(broker(dashboard,"TELEMETRY_READ")["telemetry"]["enabled"] is True,
              "Recording requires a deliberate user opt-in")
        unapproved=broker(popup,"ADMIN_APPROVE",{"origin":origin})
        check(unapproved.get("ok") is False,"Permission gate refuses ungranted origin")
        notallowed=broker(popup,"ADMIN_READ",{"origin":origin})
        check(notallowed.get("approved") is False,"Unapproved origin has no active rules")

        # Real Chrome optional-host permission request, from a physical Playwright click.
        popup.evaluate("""pattern => {
          const button=document.createElement('button');button.id='test-permission';
          button.addEventListener('click', async()=> {
            try {window.permissionResult=await chrome.permissions.request({origins:[pattern]});}
            catch(e){window.permissionResultError=e.message;}
            document.body.dataset.permissionFinished='1';
          });
          document.body.append(button);
        }""","http://127.0.0.1/*")
        popup.locator("#test-permission").click()
        if os.getenv("VANISH_HEADED")=="1":
            time.sleep(0.8)
            # Chrome's extension permission bubble is browser UI, not a DOM dialog.
            subprocess.run(["xdotool","key","Tab","Return"],check=True)
        popup.locator('body[data-permission-finished="1"]').wait_for(timeout=12000)
        if popup.evaluate("window.permissionResultError"): raise RuntimeError(popup.evaluate("window.permissionResultError"))
        granted=popup.evaluate("window.permissionResult")
        print("CHROME PERMISSION DECISION:",granted,flush=True)
        check(granted is True,"Real Chrome optional host permission granted from click")
        response=broker(popup,"ADMIN_APPROVE",{"origin":origin})
        check(response.get("ok") is True,"Approved origin registered by trusted worker")
        check(broker(dashboard,"TELEMETRY_READ")["telemetry"]["days"][-1]["counts"]["permission_granted"]>=1,
              "New origin grants are counted without storing an origin in telemetry")
        tab_id=find_target_tab(popup,origin)
        target.reload(wait_until="domcontentloaded")
        target.wait_for_timeout(500)
        response=popup.evaluate("""async tab=>chrome.tabs.sendMessage(
          tab,{type:"START_PICK"},{frameId:0})""",tab_id)
        check(response.get("ok") is True,"Picker launched inside actual content script")
        target.mouse.move(570,310)
        target.mouse.click(570,310)
        target.wait_for_function("getComputedStyle(document.querySelector('#modal')).display==='none'",timeout=8000)
        check(target.evaluate("getComputedStyle(document.querySelector('#shade')).display")=="none",
              "Actual popup and backdrop hidden")
        check(target.evaluate("getComputedStyle(document.body).overflowY")!="hidden",
              "Scroll was unlocked")
        saved=broker(popup,"ADMIN_READ",{"origin":origin})
        check(len(saved.get("state",{}).get("rules",[]))>=1,"Full-origin rule persisted via worker")
        dashboard.wait_for_function("""async() => {
          const r=await chrome.runtime.sendMessage({type:"TELEMETRY_READ"});
          return r.telemetry.days.some(x=>x.counts.rules_saved>0);
        }""",timeout=8000)
        stats=broker(dashboard,"TELEMETRY_READ")["telemetry"]
        check(stats["enabled"] is True and stats["days"][-1]["counts"]["rules_saved"]>=1,
              "Real picker save appears in on-device telemetry")
        check(origin not in json.dumps(stats) and SECRET not in json.dumps(stats) and
              "html > body" not in json.dumps(stats),
              "Telemetry never includes page text, origin, URL or CSS selector")
        raw=popup.evaluate("async()=>chrome.storage.local.get(null)")
        check(SECRET not in json.dumps(raw),"Sensitive selected-page text never persisted")
        check(not any("label" in r for r in saved["state"]["rules"]),"No rule labels persisted")
        check(all(r["selectors"][0].startswith("html > body > ") for r in saved["state"]["rules"]),
              "Persisted CSS is structural only")
        check('html > body [role="dialog"][aria-modal="true"]' in saved["state"]["rules"][0]["selectors"],
              "Stable semantic role fallback saved without page text")
        target.evaluate("""()=>{
          const modal=document.getElementById('modal');
          const wrapper=document.createElement('article');
          document.body.insertBefore(wrapper,document.body.firstChild);
          wrapper.append(modal);
        }""")
        target.wait_for_timeout(600)
        check(target.evaluate("getComputedStyle(document.querySelector('#modal')).display")=="none",
              "Selected dialog stays hidden after its DOM hierarchy moves")
        target.evaluate("""()=>{
          document.querySelector('#modal').style.setProperty('display','block','important')
        }""")
        target.wait_for_function("getComputedStyle(document.querySelector('#modal')).display==='none'",timeout=5000)
        check(True,"Vanish restores hiding after the page overwrites an inline!important style")

        # Same hostname, different port: Chrome may grant host access but broker must not.
        second=context.new_page()
        second.goto(origin2+"/",wait_until="domcontentloaded")
        check(broker(popup,"ADMIN_READ",{"origin":origin2}).get("approved") is False,
              "Different port is not an approved origin")
        check(second.evaluate("getComputedStyle(document.querySelector('#modal')).display")!="none",
              "Rules do not transfer between ports")
        second_id=find_target_tab(popup,origin2)
        rejected=popup.evaluate("""async tab => {
          const result=await chrome.scripting.executeScript({target:{tabId:tab,frameIds:[0]},
            func:()=>chrome.runtime.sendMessage({type:"CONTENT_SIGNAL",event:"picker_failed"})});
          return result[0]?.result;
        }""",second_id)
        check(rejected.get("ok") is False,
              "Unapproved origin cannot forge or record telemetry signals")
        negative=popup.evaluate("""async tab=> {
          const r=await chrome.scripting.executeScript({target:{tabId:tab,frameIds:[0]},
            func:()=>chrome.runtime.sendMessage({type:"CONTENT_SAVE",
              rule:{selectors:["html > body {background:url(https://attacker.invalid)}"],unlockScroll:true}})});
          return r[0]?.result;
        }""",tab_id)
        check(negative.get("ok") is False,"Malicious CSS selector rejected by worker")

        # Busy DOMs must back off rather than silently forgetting all rules.
        start=time.monotonic()
        target.evaluate("""()=>{
          const node=document.getElementById('storm');
          for(let i=0;i<1400;i++)node.setAttribute('class','noise'+i);
        }""")
        check(time.monotonic()-start < 5.0,"Mutation storm does not lock up browser input")
        target.wait_for_timeout(1700)
        check(target.evaluate("getComputedStyle(document.querySelector('#modal')).display")=="none",
              "Mutation-storm backoff keeps selected elements hidden")
        dashboard.wait_for_function("""async() => {
          const r=await chrome.runtime.sendMessage({type:"TELEMETRY_READ"});
          return r.telemetry.days.some(x=>x.counts.mutation_backoff>0);
        }""",timeout=8000)
        check(broker(dashboard,"TELEMETRY_READ")["telemetry"]["days"][-1]["counts"]["mutation_backoff"]>=1,
              "Mutation-storm safeguard surfaced as an aggregate health counter")
        cleared=broker(popup,"ADMIN_CLEAR",{"origin":origin})
        check(cleared.get("ok") is True,"Restore clears rules without revoking approval")
        popup.evaluate("""async tab=>chrome.tabs.sendMessage(tab,{type:"RULES_REFRESH"},{frameId:0})""",tab_id)
        target.wait_for_function("getComputedStyle(document.querySelector('#modal')).display!=='none'",timeout=8000)
        check(target.evaluate("getComputedStyle(document.body).overflowY")=="hidden",
              "Restoring rules also restores original scroll lock")

        target.reload(wait_until="domcontentloaded")
        target.wait_for_timeout(500)
        response=popup.evaluate("""async tab=>chrome.tabs.sendMessage(tab,{type:"START_PICK"},{frameId:0})""",tab_id)
        check(response.get("ok") is True,"Picker can be reopened after restoring a site")
        target.mouse.move(570,310)
        target.mouse.click(570,310)
        target.wait_for_function("getComputedStyle(document.querySelector('#modal')).display==='none'",timeout=8000)
        check(len(broker(popup,"ADMIN_READ",{"origin":origin})["state"]["rules"])==1,
              "Reselection works without duplicate rules")

        # Exercise the actual extension popup's layout, theme and saved-choice UI.
        popup.evaluate("async tab=>chrome.tabs.update(tab,{active:true})",tab_id)
        popup.reload(wait_until="domcontentloaded")
        popup.wait_for_function("document.getElementById('domain')?.textContent.includes('127.0.0.1')",timeout=9000)
        check(popup.locator("#rules .rule").count()==1,
              "Actual popup renders the saved rule without mocked Chrome APIs")
        check(popup.evaluate("document.body.scrollWidth <= 390"),
              "Popup has no horizontal overflow at its intended viewport width")
        check(popup.locator("#dashboard").is_visible(),
              "Popup always offers local telemetry without visiting a website")
        check(popup.locator('a[href="https://admine.au/vanish-terms"]').is_visible() and
              popup.locator('a[href="https://admine.au/vanish-privacy"]').is_visible(),
              "Terms and privacy are visible in the actual installed popup")
        check(popup.locator('nav.legal-links a').count()==2,
              "No remote executable or tracking embeds required to display policies")
        popup.locator("#theme").select_option("dark")
        check(popup.evaluate("getComputedStyle(document.body).backgroundColor")=="rgb(16, 16, 16)",
              "ADMINE dark theme uses site-aligned background tokens")
        (ROOT/"tests"/"output").mkdir(parents=True,exist_ok=True)
        popup.set_viewport_size({"width":390,"height":650})
        popup.screenshot(path=str(ROOT/"tests"/"output"/"vanish-popup-dark.png"))
        dashboard.wait_for_function("getComputedStyle(document.body).backgroundColor==='rgb(16, 16, 16)'",timeout=9000)
        check(dashboard.evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth"),
              "Local dashboard dark theme has no horizontal overflow")
        dashboard.set_viewport_size({"width":390,"height":780})
        dashboard.screenshot(path=str(ROOT/"tests"/"output"/"vanish-dashboard-dark.png"))
        popup.locator("#theme").select_option("light")
        check(popup.evaluate("getComputedStyle(document.body).backgroundColor")=="rgb(245, 244, 240)",
              "ADMINE light theme uses site-aligned background tokens")
        popup.screenshot(path=str(ROOT/"tests"/"output"/"vanish-popup-light.png"))
        dashboard.wait_for_function("getComputedStyle(document.body).backgroundColor==='rgb(245, 244, 240)'",timeout=9000)
        check(dashboard.evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth"),
              "Local dashboard light theme fits 390px viewport")
        dashboard.screenshot(path=str(ROOT/"tests"/"output"/"vanish-dashboard-light.png"))
        # Switch collection off, then perform a real broker operation; aggregates must not change.
        dashboard.locator("#recording").uncheck()
        before_pause=broker(dashboard,"TELEMETRY_READ")["telemetry"]["days"]
        check(broker(popup,"ADMIN_TOGGLE",{"origin":origin,"enabled":False}).get("ok") is True,
              "Rule controls continue working while telemetry is off")
        check(broker(popup,"ADMIN_TOGGLE",{"origin":origin,"enabled":True}).get("ok") is True,
              "Rules resume normally with telemetry disabled")
        after_pause=broker(dashboard,"TELEMETRY_READ")["telemetry"]["days"]
        check(before_pause==after_pause,"Opt-out prevents any new counters")
        # Clearing telemetry must not clear the saved rules or site permissions.
        dashboard.locator("#clear").click()
        check(dashboard.locator("#clear").inner_text()=="Confirm clear",
              "Clearing activity requires a second intentional click")
        dashboard.locator("#clear").click()
        dashboard.wait_for_function("document.getElementById('metric-saved').textContent==='0'",timeout=9000)
        check(broker(dashboard,"TELEMETRY_READ")["telemetry"]["days"]==[],
              "Clear telemetry erases the aggregate window")
        check(len(broker(popup,"ADMIN_READ",{"origin":origin})["state"]["rules"])==1,
              "Telemetry reset never removes saved hiding rules")
        dashboard.locator("#recording").check()
        check(broker(dashboard,"TELEMETRY_READ")["telemetry"]["enabled"] is True,
              "Recording can be reenabled after an explicit reset")
        check(popup.locator("#forget-all").is_visible() is False,
              "Destructive global action stays behind expandable controls")
        popup.locator(".site-controls summary").click()
        check(popup.locator("#forget-all").is_visible(),
              "Advanced controls expand intentionally")

        result=broker(popup,"ADMIN_FORGET_HOST",{"hostname":"127.0.0.1"})
        check(result.get("ok") is True,"Complete hostname revocation succeeded")
        permitted=popup.evaluate("async()=>chrome.permissions.contains({origins:['http://127.0.0.1/*']})")
        check(permitted is False,"Chrome host permission fully removed")
        scripts=popup.evaluate("async()=>chrome.scripting.getRegisteredContentScripts()")
        check(not any(s["id"].startswith("vanish_") for s in scripts),
              "Persisted content-script registrations removed")
        raw=popup.evaluate("async()=>chrome.storage.local.get(null)")
        check(not any(k.startswith("vanish.rules.v3.") for k in raw),
              "All origin-specific rules for hostname erased")
        check(broker(popup,"ADMIN_CLEAR_ALL").get("ok") is True,
              "Global purge operates without any site permission")
        raw=popup.evaluate("async()=>chrome.storage.local.get(null)")
        check("vanish.telemetry.v1" not in raw,
              "Global clear deletes the local telemetry setting and every metric")
        unexpected=[u for u in requests if urlsplit(u).scheme in ("http","https") and
                    urlsplit(u).hostname not in ("127.0.0.1","localhost")]
        check(not unexpected,"No unexpected HTTP(S) page/context requests: "+str(unexpected))
        # Independent proxy also observes vendor-owned Chrome traffic, not only extension traffic.
        chrome_service_hosts={"www.google.com","accounts.google.com","android.clients.google.com"}
        chrome_ambient=[hit for hit in proxy_hits if hit[1].split(":")[0] in chrome_service_hosts]
        unknown=[hit for hit in proxy_hits if hit not in chrome_ambient]
        print("CHROME AMBIENT PROXY ATTEMPTS (blocked):",json.dumps(chrome_ambient),flush=True)
        check(not unknown,"No unexpected non-browser-service HTTP(S) egress attempts: "+str(unknown))
        print("ACCEPTANCE: real Chromium installed-extension checks completed",flush=True)
        context.close()
    finally:
        primary.shutdown()
        secondary.shutdown()
        trap.shutdown()
