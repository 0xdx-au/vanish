#!/usr/bin/env python3
"""Build Vanish Chrome Web Store assets using a synthetic Chrome DOM test.
No production websites are visited and no private browsing data is read.
"""
from pathlib import Path
import io, json, math, subprocess, tempfile, time, zipfile
from PIL import Image, ImageDraw, ImageFont
import cairosvg
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "store-assets"
SHOTS = OUT / "screenshots"
OUT.mkdir(exist_ok=True)
SHOTS.mkdir(exist_ok=True)
PINK=(234,135,195);TEAL=(83,218,193);WHITE=(236,243,237);MUTED=(161,184,177);DARK=(9,16,18)
FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
def font(n,bold=False):
    return ImageFont.truetype(BOLD if bold else FONT,n)
def text(d,x,y,s,size,col=WHITE,bold=True):
    d.text((x,y),s,font=font(size,bold),fill=col)
def art(w,h):
    im=Image.new("RGB",(w,h))
    p=im.load()
    for y in range(h):
        for x in range(w):
            t=x/max(w-1,1);v=y/max(h-1,1)
            p[x,y]=(int(8+14*t+2*v),int(16+18*t+3*v),int(19+19*t+3*v))
    d=ImageDraw.Draw(im)
    for k in range(-10,40):
        points=[(x,int(h*.75+k*(18 if w<500 else 30)+(5 if w<500 else 24)*math.sin(x/90+k*.3)+8*math.sin(x/225+k*.8)-x*(h/w)*.17)) for x in range(0,w+6,6)]
        d.line(points,fill=(30,83,83) if k%4 else (45,124,116),width=1 if k%4 else 2)
    return im
def logo(n):
    raw=cairosvg.svg2png(bytestring=(ROOT/"icons/vanish.svg").read_bytes(),output_width=n,output_height=n)
    return Image.open(io.BytesIO(raw)).convert("RGBA")
lg=logo(96);lg.save(OUT/"vanish-logo-96x96.png")
icon=Image.new("RGBA",(128,128),(0,0,0,0));icon.alpha_composite(lg,(16,16))
icon.save(OUT/"store-icon-128x128.png")
icon.save(ROOT/"icons/icon128.png");lg.save(ROOT/"icons/icon96.png")
small=art(440,280);d=ImageDraw.Draw(small)
d.rounded_rectangle((17,17,423,263),radius=19,outline=(54,103,100),width=2,fill=(12,23,25))
mark=lg.resize((85,85),Image.Resampling.LANCZOS);small.paste(mark,(35,38),mark)
text(d,135,38,"VANISH.",41);text(d,136,96,"BY ADMINE",11,TEAL)
d.line([(39,150),(400,150)],fill=(44,94,92),width=2)
text(d,40,166,"SELECT  /  HIDE  /  CONTINUE",14)
text(d,40,211,"Local rules. No telemetry.",13,MUTED,False)
d.rounded_rectangle((35,246,405,250),radius=2,fill=PINK)
small.save(OUT/"small-promo-440x280.png")
wide=art(1400,560);d=ImageDraw.Draw(wide)
d.rounded_rectangle((30,30,1370,530),radius=25,outline=(45,97,97),width=2)
mark=lg.resize((220,220),Image.Resampling.LANCZOS);wide.paste(mark,(80,122),mark)
text(d,330,128,"VANISH.",112)
text(d,340,257,"BY ADMINE / LOCAL-FIRST CHROME EXTENSION",20,TEAL)
d.line([(340,319),(1240,319)],fill=(46,102,98),width=2)
text(d,340,356,"SELECT AN INTERRUPTION. MAKE IT DISAPPEAR.",29)
text(d,340,419,"Reversible page cleanup. No extension telemetry.",20,MUTED,False)
d.rounded_rectangle((340,483,1240,491),radius=4,fill=PINK)
wide.save(OUT/"marquee-promo-1400x560.png")

# Test fixture is intentionally synthetic; no news organisation logos or live requests.
PAGE="""<!doctype html><html><head><meta charset="utf-8"><title>Vanish / controlled demo</title>
<style>
*{box-sizing:border-box}html,body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#eff2f1;color:#1a2727}
body{overflow:hidden}.top{height:81px;background:#102021;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 42px}
.brand{font-size:26px;font-weight:900;letter-spacing:-1px}.lab{color:#91b7b2;font-size:12px;letter-spacing:1px}
.stripe{height:5px;background:linear-gradient(90deg,#EA87C3 20%,#45a99b 20% 60%,#EA87C3 60%)}
main{max-width:1040px;margin:auto;padding:40px 20px}.eyebrow{color:#498b84;font-size:12px;font-weight:800;letter-spacing:2px}
h1{font-size:53px;line-height:1.05;letter-spacing:-2px;margin:20px 0}
.lead{font-size:19px;color:#546361;max-width:750px;line-height:1.6}
.cards{display:flex;gap:16px;margin-top:35px}.cards div{flex:1;background:#fff;border:1px solid #dde4e0;border-radius:14px;padding:22px;height:135px}
.cards strong{display:block;margin-bottom:15px}.cards em{font-style:normal;color:#679e93}
#screen-layer{position:static;pointer-events:none}
#scrim{position:fixed;inset:0;z-index:9998;background:#0009;pointer-events:auto}
#user-interrupt{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9999;pointer-events:auto;background:#fff;text-align:center;border-radius:15px;padding:34px 40px;width:565px;box-shadow:0 25px 100px #0007}
#user-interrupt .key{color:#b93478;font-size:11px;letter-spacing:2px;font-weight:900}
#user-interrupt h2{font-size:33px;letter-spacing:-1px;margin:16px 0 13px}
#user-interrupt p{font-size:17px;line-height:1.45;color:#556361;margin:0 auto 24px}
#user-interrupt button{border:0;border-radius:7px;background:#178ead;color:#fff;padding:13px 28px;font-size:16px;font-weight:700}
.notice{font-size:11px;color:#7f8c88;margin-top:14px}
</style></head><body><header class="top"><div class="brand">READ.LAB / TEST PAGE</div><div class="lab">CONTROLLED LOCAL DEMONSTRATION</div></header><div class="stripe"></div>
<main><span class="eyebrow">FIELD NOTES / BROWSER USABILITY</span><h1>Your page. Your choice.<br>Less noise, more signal.</h1><p class="lead">Some interruptions cover content that is already in the browser. Vanish can hide unwanted visual elements using rules that stay on your device.</p>
<div class="cards"><div><strong>01 / Select</strong><em>Identify a page element.</em></div><div><strong>02 / Vanish</strong><em>Hide it from view.</em></div><div><strong>03 / Continue</strong><em>Restore it any time.</em></div></div></main>
<div id="screen-layer"><div id="scrim"></div><div id="user-interrupt" role="dialog" aria-modal="true" aria-label="Promotional popup"><span class="key">EXAMPLE INTERRUPTION / DEMO</span><h2>You're missing out.</h2><p>This interruption obscures the page. Select it with Vanish to remove it from your view.</p><button>ALLOW INTERRUPTIONS</button><div class="notice">Synthetic local page. No third-party websites.</div></div></div></body></html>"""
SHIM="""(() => {
const listeners=[],data={};
window.chrome={
storage:{local:{async get(key){return {[key]:data[key]};},async set(o){const c={};for(const [k,v] of Object.entries(o)){c[k]={oldValue:data[k],newValue:v};data[k]=v;}for(const fn of listeners)fn(c,'local');}},onChanged:{addListener(fn){listeners.push(fn);}}},
runtime:{onMessage:{addListener(fn){window.__vanishMessage=fn;}}}};
window.__vanishData=()=>data;
})();"""
with tempfile.TemporaryDirectory(prefix="vanish-test-recording-") as tmp:
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        context=browser.new_context(viewport={"width":1280,"height":720},record_video_dir=tmp,record_video_size={"width":1280,"height":720},device_scale_factor=1)
        page=context.new_page()
        page.set_content(PAGE)
        page.evaluate(SHIM)
        page.add_script_tag(path=str(ROOT/"content.js"))
        page.wait_for_function("Boolean(window.__vanishMessage)")
        page.screenshot(path=str(SHOTS/"01-before.png"))
        time.sleep(1.6)
        page.evaluate('window.__vanishMessage({type:"START_PICK"},{},()=>{})')
        page.mouse.move(740,390)
        time.sleep(1.8)
        page.screenshot(path=str(SHOTS/"02-target-selected.png"))
        page.mouse.click(740,390)
        page.wait_for_timeout(500)
        proof=page.evaluate("""() => ({
           modal:getComputedStyle(document.querySelector('#user-interrupt')).display,
           backdrop:getComputedStyle(document.querySelector('#scrim')).display,
           scroll:getComputedStyle(document.body).overflowY,
           saved:Object.values(window.__vanishData()).flatMap(x=>x?.rules||[]).length
        })""")
        print("CHROME DOM PROOF:", json.dumps(proof))
        if proof["modal"]!="none" or proof["backdrop"]!="none" or proof["saved"]<1 or proof["scroll"]=="hidden":
            raise RuntimeError("Unsuccessful browser picker/backdrop/scroll verification")
        page.screenshot(path=str(SHOTS/"03-vanished.png"))
        time.sleep(5.6)
        video=page.video
        context.close()
        recorded=Path(video.path())
        browser.close()
    output=OUT/"vanish-working-demo-10s.mp4"
    subprocess.run(["ffmpeg","-y","-loglevel","error","-i",str(recorded),"-vf","fps=30,scale=1280:720,tpad=stop_mode=clone:stop_duration=5,format=yuv420p","-an","-t","10.000","-r","30","-c:v","libx264","-preset","medium","-crf","22","-movflags","+faststart",str(output)],check=True)
    metadata=json.loads(subprocess.check_output(["ffprobe","-v","quiet","-show_entries","format=duration","-of","json",str(output)]))
    assert abs(float(metadata["format"]["duration"])-10)<.06

# Fourth screenshot depicts the real result with a clearly labelled illustrative popup layout.
preview=Image.open(SHOTS/"03-vanished.png").convert("RGB")
d=ImageDraw.Draw(preview)
d.rounded_rectangle((843,140,1238,667),radius=17,fill=(22,34,36),outline=(88,126,123),width=3)
mark=logo(72);preview.paste(mark,(861,160),mark);d=ImageDraw.Draw(preview)
text(d,943,171,"VANISH.",35);text(d,943,215,"ADMINE / LOCAL INSTRUMENT",10,TEAL)
d.line([(860,253),(1220,253)],fill=(70,105,102),width=2)
text(d,866,276,"CURRENT SITE",12,MUTED);text(d,866,304,"SYNTHETIC PAGE",18)
d.rounded_rectangle((858,359,1225,412),radius=7,fill=PINK)
text(d,874,370,"SELECT & VANISH",18,DARK)
text(d,865,445,"1 SAVED RULE",15);text(d,865,482,"Undo  /  Restore all",13,MUTED)
d.line([(860,538),(1220,538)],fill=(70,105,102),width=2)
text(d,865,568,"LOCAL STORAGE",14,TEAL)
text(d,865,595,"NO EXTENSION EGRESS",12)
text(d,865,634,"Illustrative popup composite",10,MUTED)
preview.save(SHOTS/"04-local-rule.png")

# Full-bleed square-cornered 1280×800 24-bit PNG screenshots; no alpha.
for path in SHOTS.glob("*.png"):
    im=Image.open(path).convert("RGB")
    assert im.size==(1280,720)
    canvas=Image.new("RGB",(1280,800),DARK);canvas.paste(im,(0,0))
    d=ImageDraw.Draw(canvas)
    text(d,35,737,"ADMINE  /  VANISH",24)
    text(d,1000,745,"CONTROLLED DEMO",11,TEAL)
    canvas.save(path)

sizes={"vanish-logo-96x96.png":(96,96),"store-icon-128x128.png":(128,128),
       "small-promo-440x280.png":(440,280),"marquee-promo-1400x560.png":(1400,560)}
for filename,dimensions in sizes.items():
    im=Image.open(OUT/filename)
    assert im.size==dimensions
assert Image.open(OUT/"store-icon-128x128.png").getpixel((0,0))[3]==0
for path in SHOTS.glob("*.png"):
    im=Image.open(path)
    assert im.size==(1280,800) and im.mode=="RGB"

(OUT/"README.md").write_text("""# Vanish / Chrome Web Store asset pack

Each image is at the required listing dimensions. The 128×128 icon includes
16px transparent padding surrounding the actual 96×96 identity mark.
Screenshots are 1280×800 RGB PNGs of a synthetic test page, with no private
user or third-party site content. Screenshot 04 overlays an illustrative popup,
clearly labelled as such. Source: scripts/generate_assets.py.

The 10-second MP4 shows Chromium executing the published Vanish content.js
picker on that synthetic page with MOCKED extension storage/message APIs. It
checks modal hiding, backdrop removal, locally saved rule and scroll recovery.
This is a DOM behaviour demonstration, NOT proof that the full unpacked MV3
extension and permission flow work on all real sites.

Chrome Web Store's global promo video field requires a real YouTube URL.
Upload the generated MP4 to your own YouTube channel to obtain one. A local
file path or GitHub video URL is not a substitute for YouTube. No URL is invented.
""",encoding="utf-8")
with zipfile.ZipFile(OUT/"Vanish-Chrome-Web-Store-assets.zip","w",compression=zipfile.ZIP_DEFLATED) as z:
    for path in sorted(OUT.rglob("*")):
        if path.is_file() and path.suffix.lower() in (".png",".mp4",".md"):
            z.write(path,path.relative_to(OUT))
print("STORE ASSET GENERATION COMPLETE", len(list(SHOTS.glob("*.png"))),"screenshots")
