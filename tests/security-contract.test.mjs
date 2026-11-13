import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL("../"+path, import.meta.url),"utf8");
const manifest=JSON.parse(read("manifest.json"));
const background=read("background.js"),popup=read("popup.js"),
  content=read("content.js"),html=read("popup.html"),licence=read("LICENSE");
const storeWorkflow=read(".github/workflows/store-assets.yml");
const verifyWorkflow=read(".github/workflows/verify.yml");

test("manifest is minimal, opt-in, and cannot run Incognito", () => {
  assert.equal(manifest.manifest_version,3);
  assert.equal(manifest.incognito,"not_allowed");
  assert.deepEqual(manifest.permissions,["storage","activeTab","scripting"]);
  assert.equal(manifest.host_permissions,undefined);
  assert.equal(manifest.content_scripts,undefined);
  assert.deepEqual(manifest.optional_host_permissions,["http://*/*","https://*/*"]);
  assert.equal(manifest.background.service_worker,"background.js");
  assert.match(manifest.content_security_policy.extension_pages,/connect-src 'none'/);
});
test("page text, identifiers and arbitrary attributes cannot be persisted as rules", () => {
  assert.doesNotMatch(content,/node\.innerText|node\.textContent\s*\|\||\blabel\(target\)|label:\s*label\(/);
  assert.doesNotMatch(content,/chrome\.storage\.(local|sync)/);
  assert.match(content,/structural|non-identifying/);
  assert.match(background,/SELECTOR\s*=\s*\/\^html/);
  assert.match(background,/\.map\(\(\{ id, selectors, unlockScroll \}\)/);
  assert.doesNotMatch(background,/label:\s*(message|rule|item|label)/);
  assert.doesNotMatch(popup,/rule\.label|rule\.selectors\.join/);
  assert.match(popup,/Hidden element/);
});
test("origin is source of rule key, and background checks sender origin against granted origin", () => {
  assert.match(background,/encodeURIComponent\(origin\)/);
  assert.match(background,/sender\.frameId !== 0/);
  assert.match(background,/sender\.tab\.incognito/);
  assert.match(background,/approved\.includes\(origin\)|\(await allApproved\(\)\)\.includes\(origin\)/);
  assert.match(background,/chrome\.permissions\.contains/);
  assert.match(background,/contentOrigin.*isApproved/);
  assert.match(content,/location\.origin/);
  assert.match(popup,/origin=url\.origin/);
});
test("both host-specific and global revocation shut down scripts and delete rules", () => {
  assert.match(background,/CONTENT_SHUTDOWN_ALL/);
  assert.match(background,/CONTENT_SHUTDOWN/);
  assert.match(background,/chrome\.scripting\.unregisterContentScripts/);
  assert.match(background,/chrome\.permissions\.remove/);
  assert.match(background,/ADMIN_FORGET_HOST/);
  assert.match(background,/ADMIN_CLEAR_ALL/);
  for(const id of ["pick","enabled","undo","restore","forget","forget-all","access","rules","domain","status"]) {
    assert.ok(html.includes('id="'+id+'"'),id);
  }
});
test("page mutation observer has bounded work and a fail-safe", () => {
  assert.match(content,/MAX_RULES = 24/);
  assert.match(content,/MAX_MATCHES = 8/);
  assert.match(content,/MAX_SCAN_MS = 16/);
  assert.match(content,/churn > 1000/);
  assert.match(content,/pauseForSafety\(/);
  assert.match(content,/observer\?\.disconnect\(\)/);
});
test("migration deletes old hostname rules with labels and old grants", () => {
  assert.match(background,/vanish\.site\./);
  assert.match(background,/function migrate\(/);
  assert.match(background,/removeVanishRegistrations\(\)/);
  assert.match(background,/chrome\.storage\.local\.setAccessLevel/);
  assert.match(background,/TRUSTED_CONTEXTS/);
});
test("no intentional extension network APIs or remote assets", () => {
  for(const [path,src] of [["popup.js",popup],["content.js",content],["background.js",background]]) {
    for(const forbidden of [
      /\bfetch\s*\(/,/\bXMLHttpRequest\b/,/\bWebSocket\b/,/\bEventSource\b/,
      /\.sendBeacon\s*\(/,/\bimportScripts\s*\(/,/https?:\/\/(?!\*\/)/,
      /<script\b[^>]*src=["']https?:/i,/chrome\.storage\.sync/
    ]) assert.doesNotMatch(src,forbidden,path+": "+forbidden);
  }
});
test("no write token or uncontrolled git push in media build; source checks read only", () => {
  assert.match(storeWorkflow,/contents: read/);
  assert.doesNotMatch(storeWorkflow,/contents: write/);
  assert.doesNotMatch(storeWorkflow,/git push|git commit|persist-credentials:\s*true/);
  assert.match(verifyWorkflow,/contents: read/);
  assert.match(verifyWorkflow,/browser-acceptance/);
});
test("source-available rights reserved and no public support claim", () => {
  assert.match(licence,/commercial exploitation/i);
  assert.match(licence,/non-OSI/i);
  assert.match(read("README.md"),/source-available is not open-source/i);
});
