import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const content = read('content.js');
const popup = read('popup.js');
const html = read('popup.html');
const css = read('popup.css');
const license = read('LICENSE');
test('Manifest V3, exact permissions, Chrome minimum and no background agent', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab', 'scripting']);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.minimum_chrome_version, '116');
});
test('Site entry point and page limitations are explicit', () => {
  assert.deepEqual(manifest.content_scripts[0].matches, ['http://*/*', 'https://*/*']);
  assert.equal(manifest.content_scripts[0].all_frames, false);
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.equal(manifest.content_scripts[0].js[0], 'content.js');
});
test('Extension pages have connect-src none and packaged resources', () => {
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
  for(const path of ['popup.html', 'popup.css', 'popup.js', 'content.js', 'icons/vanish.svg', 'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png']) {
    assert.ok(readFileSync(new URL('../'+path, import.meta.url)).length > 0, path);
  }
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/);
  assert.doesNotMatch(css, /@import\b|url\(\s*["']?https?:/i);
});
test('No extension-initiated network APIs or remote assets', () => {
  for(const name of ['content.js','popup.js']) {
    const src=read(name);
    for(const forbidden of [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bEventSource\b/, /\.sendBeacon\s*\(/, /\.sendMessageExternal\s*\(/, /https?:\/\//]) {
      assert.doesNotMatch(src, forbidden, name+': '+forbidden);
    }
  }
});
test('User-facing rule, undo, pause and theme controls have handlers', () => {
  for(const id of ['pick','enabled','undo','restore','rules','domain','theme','status']) assert.match(html, new RegExp('id="'+id+'"'));
  for(const name of ['START_PICK','undo','restore','enabled','theme']) assert.match(popup, new RegExp(name));
});
test('Selector cap, isolated UI and reversible scroll handling are present', () => {
  assert.match(content, /MAX_RULES = 100/);
  assert.match(content, /attachShadow\(\{ mode: "closed" \}\)/);
  assert.match(content, /restoreScroll/);
  assert.match(content, /observer\?\.disconnect\(\)/);
  assert.match(content, /chrome\.storage\.local/);
  assert.doesNotMatch(content, /chrome\.storage\.sync/);
});
test('Commercial rights are reserved, licence is not misrepresented as open source', () => {
  assert.match(license, /commercial exploitation/i);
  assert.match(license, /non-OSI/i);
  assert.match(read('README.md'), /not open-source \(OSI\)/i);
});
