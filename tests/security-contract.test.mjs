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
  assert.match(popup,/origin\s*=\s*url\.origin/);
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
      /\.sendBeacon\s*\(/,/\bimportScripts\s*\(/,
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
test("standard noncommercial licensing and required notices are consistent", () => {
  assert.match(licence,/PolyForm Noncommercial License 1\.0\.0/);
  assert.match(licence,/Noncommercial Purposes/);
  assert.match(licence,/No Other Rights/);
  assert.match(read("README.md"),/Commercial use is not granted/i);
  assert.match(read("README.md"),/not an OSI-approved open-source licence/i);
  assert.match(read("NOTICE"),/Required Notice: Copyright 2026 0xdx-au/);
  assert.match(read("TRADEMARKS.md"),/does not.*grant permission/i);
});
test("popup messaging avoids technical OPSEC inventory", () => {
  assert.doesNotMatch(html,/NO EXTENSION EGRESS|structural selectors|trusted context/i);
  assert.doesNotMatch(popup,/\bOPSEC\b|Rule processing exceeded budget/i);
});

test("README visual walkthrough uses genuine repository screenshots, not ASCII placeholders", () => {
  const readme = read("README.md");
  const assets = [
    "store-assets/marquee-promo-1400x560.png",
    "store-assets/screenshots/01-before.png",
    "store-assets/screenshots/02-target-selected.png",
    "store-assets/screenshots/03-vanished.png",
    "store-assets/screenshots/04-local-rule.png"
  ];
  for (const path of assets) {
    assert.ok(readme.includes(path), "README missing image: " + path);
    const bytes = readFileSync(new URL("../" + path, import.meta.url));
    assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10], path + ": PNG signature");
    assert.ok(bytes.length > 10_000, path + ": unexpected empty image");
  }
  assert.ok(readme.includes("https://admine.au/projects/vanish/#v-demo"), "Interactive demo link missing");
  assert.doesNotMatch(readme, /```text/);
  assert.match(readme, /illustrative composite/i);
});

test("Chrome Web Store evidence and privacy URL are linked in publisher instructions", () => {
  const store = read("store-assets/README.md");
  const readme = read("README.md");
  const url = "https://admine.au/vanish-privacy";
  assert.ok(store.includes(url), "Store checklist missing dedicated public privacy URL");
  assert.ok(readme.includes(url), "README missing dedicated privacy URL");
  for (const image of ["01-before.png", "02-target-selected.png", "03-vanished.png"]) {
    assert.ok(store.includes("screenshots/" + image), "Missing store upload asset: " + image);
  }
  assert.match(store, /Store listing[^\n]*Screenshots/);
  assert.match(store, /Privacy[^]*Privacy policy/);
  assert.match(store, /Save your draft/i);
});

test("Vanish 1.4 selectors use bounded structural paths or fixed, non-identifying dialog roles", () => {
  const selectors = [
    'html > body [role="dialog"][aria-modal="true"]',
    'html > body dialog[open]'
  ];
  for (const selector of selectors) {
    assert.ok(content.includes(selector), "Content missing stable role fallback");
    assert.ok(background.includes(selector), "Broker missing role whitelist");
  }
  assert.match(content, /semanticFor\(target\)/);
  assert.match(background, /SEMANTIC_SELECTORS\.has\(value\)/);
  assert.doesNotMatch(content, /node\.innerText|node\.textContent\s*\|\|/);
});
test("busy site fallback is temporary, never silently disables saved rules", () => {
  assert.match(content, /if \(churn > 1000\) \{/);
  assert.match(content, /cooldown = setTimeout/);
  assert.match(content, /scheduleScan\(800\)/);
  assert.doesNotMatch(content, /churn > 1000\)\s*\{\s*pauseForSafety/);
  assert.match(content, /hiddenInline\.set\(node, snapshot\(node, "display"\)\)/);
});
test("ADMINE popup is compact, accessible and requires confirmation for global reset", () => {
  const styles = read("popup.css");
  assert.match(styles, /--canvas:#f5f4f0/);
  assert.match(styles, /--canvas:#101010/);
  assert.match(styles, /--accent:#a72c66/);
  assert.match(styles, /--accent:#ff95ca/);
  assert.match(styles, /width:390px/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(html, /<details class="site-controls">/);
  assert.match(popup, /CLIENT_VERSION = "1\.4\.1"/);
  assert.match(popup, /Confirm clearing every site/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /Pink outline|NO EXTENSION EGRESS/i);
});

test("stable-only 1.4.1 release links terms and privacy without remote executable code", () => {
  assert.equal(manifest.version, "1.5.0");
  const terms = "https://admine.au/vanish-terms";
  const policy = "https://admine.au/vanish-privacy";
  const readme = read("README.md");
  assert.ok(html.includes('href="' + terms + '"'));
  assert.ok(html.includes('href="' + policy + '"'));
  assert.match(html, /rel="noopener noreferrer"/);
  assert.ok(readme.includes(terms) && readme.includes(policy));
  assert.match(read("SECURITY.md"), /Version 1\.4\.1 enforces/);
  assert.match(read("SECURITY.md"), /Nightly, beta and development snapshots are not published/);
  assert.match(read(".github/workflows/verify.yml"), /requirements-ci\.txt/);
  assert.match(read(".github/workflows/store-assets.yml"), /requirements-assets\.txt/);
  const tooling = read("requirements-ci.txt") + read("requirements-assets.txt");
  assert.match(tooling, /playwright==1\.65\.2/);
  assert.match(tooling, /pillow==13\.0\.0/);
  assert.match(tooling, /CairoSVG==2\.9\.0/);
  for (const deprecated of ["playwright==1.57.0","pillow==12.3.0","cairosvg==2.8.2"]) {
    assert.ok(!tooling.includes(deprecated));
  }
});

const dashboard = read("dashboard.js");
const dashboardHtml = read("dashboard.html");
const dashboardCss = read("dashboard.css");
test("telemetry has no remote sink and no user/site identifying fields", () => {
  assert.equal(manifest.options_ui.page, "dashboard.html");
  assert.equal(manifest.options_ui.open_in_tab, true);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
  assert.match(background, /const TELEMETRY_KEY = "vanish\.telemetry\.v1"/);
  assert.match(background, /TELEMETRY_DAYS = 14/);
  assert.match(background, /enabled: input\?\.enabled === true/);
  assert.match(background, /normaliseTelemetry/);
  assert.match(background, /telemetrySequence/);
  assert.match(background, /sender\.url === chrome\.runtime\.getURL\("dashboard\.html"\)/);
  assert.match(background, /fromDashboard\(sender\)/);
  assert.match(background, /allowTelemetrySignal\(sender, message\.event\)/);
  assert.match(background, /recentSignals\.size > 512/);
  assert.match(background, /TELEMETRY_CLEAR/);
  assert.match(background, /telemetryQueue; \/\/ Drain aggregate writes/);
  assert.match(background, /key === TELEMETRY_KEY/);
  for (const forbidden of [
    /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/,
    /\.sendBeacon\s*\(/, /\bimportScripts\s*\(/, /chrome\.storage\.sync/
  ]) {
    assert.doesNotMatch(dashboard, forbidden);
  }
  assert.doesNotMatch(dashboard, /location\.href|location\.origin|tab\.url|hostname|selectors|innerHTML|error\.stack/);
  assert.doesNotMatch(dashboardHtml, /<script[^>]*src=["']https?:|<iframe\b/i);
  assert.match(dashboardHtml, /id="recording"/);
  assert.match(dashboardHtml, /id="clear"/);
  assert.match(dashboardHtml, /id="export"/);
  assert.match(dashboardHtml, /id="chart"/);
  assert.match(dashboardCss, /max-width:700px/);
  assert.match(dashboardCss, /prefers-reduced-motion/);
  assert.match(html, /id="dashboard"/);
  assert.match(popup, /chrome\.runtime\.openOptionsPage\(\)/);
  const bundle = read("scripts/package_extension.py");
  for (const path of ["dashboard.html","dashboard.js","dashboard.css"]) {
    assert.ok(bundle.includes('"' + path + '"'));
  }
});
