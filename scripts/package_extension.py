#!/usr/bin/env python3
"""Deterministic Vanish extension ZIP. No network, no build-time code execution."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
from hashlib import sha256
import json, sys

ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/"manifest.json").read_text())
assert manifest["manifest_version"]==3
assert manifest["incognito"]=="not_allowed"
assert manifest["background"]["service_worker"]=="background.js"
version=manifest["version"]
files=[
 "manifest.json","background.js","content.js","popup.js","popup.css","popup.html",
 "README.md","LICENSE","NOTICE","TRADEMARKS.md","SECURITY.md","docs/PRIVACY-AND-THREAT-MODEL.md",
 "icons/vanish.svg","icons/icon16.png","icons/icon48.png","icons/icon96.png","icons/icon128.png"
]
dest=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/"dist"/("Vanish-extension-v"+version+".zip")
dest.parent.mkdir(parents=True,exist_ok=True)
with ZipFile(dest,"w",ZIP_DEFLATED,compresslevel=9) as zipout:
    for item in files:
        data=(ROOT/item).read_bytes()
        zi=ZipInfo(item,date_time=(2026,11,13,0,0,0))
        zi.compress_type=ZIP_DEFLATED
        zi.external_attr=0o644<<16
        zipout.writestr(zi,data,compress_type=ZIP_DEFLATED,compresslevel=9)
with ZipFile(dest) as check:
    assert check.testzip() is None
    assert set(check.namelist())==set(files)
    assert json.loads(check.read("manifest.json"))["version"]==version
print(dest, dest.stat().st_size, sha256(dest.read_bytes()).hexdigest())
