#!/usr/bin/env python3
"""Real, unpacked Manifest V3 acceptance test. No mock chrome APIs.
Runs Chromium+extension against loopback HTTP fixtures only.
"""
from __future__ import annotations
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from tempfile import TemporaryDirectory
import json, time
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
    requests=[]
    try:
        context=p.chromium.launch_persistent_context(
            profile,channel="chromium",headless=True,
            args=["--disable-extensions-except="+str(ROOT),
                  "--load-extension="+str(ROOT),
                  "--disable-background-networking","--no-first-run"])
        context.on("request",lambda req:requests.append(req.url))
        worker=context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker",timeout=25000)
        extension_id=worker.evaluate("chrome.runtime.id")
        check(bool(extension_id),"Real unpacked MV3 extension and worker started")
        target=context.new_page()
        target.goto(origin+"/",wait_until="domcontentloaded")
        popup=context.new_page()
        popup.goto("chrome-extension://"+extension_id+"/popup.html",wait_until="domcontentloaded")
        check(popup.evaluate("async()=>chrome.extension.isAllowedIncognitoAccess()") is False,
              "Incognito extension permission is prohibited")
        unapproved=broker(popup,"ADMIN_APPROVE",{"origin":origin})
        check(unapproved.get("ok") is False,"Permission gate refuses ungranted origin")
        notallowed=broker(popup,"ADMIN_READ",{"origin":origin})
        check(notallowed.get("approved") is False,"Unapproved origin has no active rules")

        # Real Chrome optional-host permission request, from a physical Playwright click.
        popup.evaluate("""pattern => {
          const button=document.createElement('button');button.id='test-permission';
          button.addEventListener('click', async()=> {
            window.permissionResult=await chrome.permissions.request({origins:[pattern]});
          });
          document.body.append(button);
        }""","http://127.0.0.1/*")
        popup.locator("#test-permission").click()
        popup.wait_for_function("window.permissionResult !== undefined",timeout=12000)
        granted=popup.evaluate("window.permissionResult")
        check(granted is True,"Real Chrome optional host permission granted from click")
        response=broker(popup,"ADMIN_APPROVE",{"origin":origin})
        check(response.get("ok") is True,"Approved origin registered by trusted worker")
        tab_id=find_target_tab(popup,origin)
        target.reload(wait_until="domcontentloaded")
        target.wait_for_timeout(500)
        response=popup.evaluate("""async tab=>chrome.tabs.sendMessage(
          tab,{type:"START_PICK"},{frameId:0})""",tab_id)
        check(response.get("ok") is True,"Picker launched inside actual content script")
        target.mouse.move(570,310)
        target.mouse.click(570,310)
        target.wait_for_function("getComputedStyle(document.querySelector('#modal')).display==='none'",timeout=8000)
        check(target.evaluate("getComputedStyle(document.querySelector('#shade')).display")==="none",
              "Actual popup and backdrop hidden")
        check(target.evaluate("getComputedStyle(document.body).overflowY")!="hidden",
              "Scroll was unlocked")
        saved=broker(popup,"ADMIN_READ",{"origin":origin})
        check(len(saved.get("state",{}).get("rules",[]))>=1,"Full-origin rule persisted via worker")
        raw=popup.evaluate("async()=>chrome.storage.local.get(null)")
        check(SECRET not in json.dumps(raw),"Sensitive selected-page text never persisted")
        check(not any("label" in r for r in saved["state"]["rules"]),"No rule labels persisted")
        check(all(r["selectors"][0].startswith("html > body > ") for r in saved["state"]["rules"]),
              "Persisted CSS is structural only")

        # Same hostname, different port: Chrome may grant host access but broker must not.
        second=context.new_page()
        second.goto(origin2+"/",wait_until="domcontentloaded")
        check(broker(popup,"ADMIN_READ",{"origin":origin2}).get("approved") is False,
              "Different port is not an approved origin")
        check(second.evaluate("getComputedStyle(document.querySelector('#modal')).display")!="none",
              "Rules do not transfer between ports")
        negative=popup.evaluate("""async tab=> {
          const r=await chrome.scripting.executeScript({target:{tabId:tab,frameIds:[0]},
            func:()=>chrome.runtime.sendMessage({type:"CONTENT_SAVE",
              rule:{selectors:["html > body {background:url(https://attacker.invalid)}"],unlockScroll:true}})});
          return r[0]?.result;
        }""",tab_id)
        check(negative.get("ok") is False,"Malicious CSS selector rejected by worker")

        # Hostile DOM mutation storm: enforce fail-safe instead of ongoing rescans.
        target.evaluate("""()=>{
          const node=document.getElementById('storm');
          for(let i=0;i<1400;i++)node.setAttribute('class','noise'+i);
        }""")
        target.wait_for_timeout(800)
        check(target.evaluate("getComputedStyle(document.querySelector('#modal')).display")!="none",
              "Mutation-storm fail-safe restores page rather than thrashing")

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
        unexpected=[u for u in requests if urlsplit(u).scheme in ("http","https") and
                    urlsplit(u).hostname not in ("127.0.0.1","localhost")]
        check(not unexpected,"No unexpected HTTP(S) page/context requests: "+str(unexpected))
        print("ACCEPTANCE: real Chromium installed-extension checks completed",flush=True)
        context.close()
    finally:
        primary.shutdown()
        secondary.shutdown()
