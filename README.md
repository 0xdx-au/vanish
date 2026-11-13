# VANISH
**An ADMINE local-first browser instrument.** Select a nuisance layer. Make it disappear. Keep control.

Vanish is a Chrome Manifest V3 extension for *visual* page cleanup: click an unwanted modal, banner, overlay or dimmer, inspect what will be hidden, and save a reversible rule for that hostname. It does **not** bypass server-side subscriptions, authorisation, DRM or access controls.

> **Privacy boundary:** No analytics, telemetry, tracking identifiers, remote assets, third-party SDKs, account, network API, or extension-initiated outbound requests. Rules stay in Chrome's `chrome.storage.local` on this browser profile. Chrome and visited websites continue their ordinary network activity. Local DOM observation, only while saved rules are active, is used to reapply hiding after page updates; that is not remote monitoring.

## Install
1. Download this repository as a ZIP from **Code → Download ZIP**, and extract it.
2. Open `chrome://extensions`, enable **Developer mode** and choose **Load unpacked**.
3. Select the extracted repository directory containing `manifest.json`. Pin Vanish from the extensions menu.
4. On an ordinary HTTP(S) site, click Vanish → **SELECT & VANISH**. Chrome requests permission for **that origin only**; approve it if you want to activate the picker. Hover to preview and click. **Shift** selects the exact element; **Esc** cancels.
5. Undo from the page notice or extension, restore individual rules, pause a site or restore all. **Forget site** deletes the local site rules, unregisters persistent injection and removes Chrome's permission for that origin. Reload any currently open tab to fully unload its existing injected script.

Chrome Web Store and `chrome://` pages are not injectable. Some iframes, shadow roots, dynamically generated selectors and server-enforced locks remain outside the capability boundary.

## Permissions and data

| Capability | Why it exists | Boundary |
| --- | --- | --- |
| Optional HTTP(S) host permission, granted per origin | Allow a dynamic content script only on sites you explicitly activate | No website content-script access at installation. A deliberate site grant persists until revoked. |
| `storage` | Save selector, a short locally derived label, per-site enabled flag, optional UI theme | `chrome.storage.local`, **not sync** |
| `activeTab` | Start the picker in the foreground tab on demand | User gesture required |
| `scripting` | On permission grant, register a persistent content script for that approved origin; inject into the currently selected tab | Registered sites load automatically on later visits; the first activation is on-demand |

No `tabs`, `webRequest`, `declarativeNetRequest`, `cookies`, `history`, `identity`, `downloads`, `nativeMessaging` or always-granted all-site host permission. Chrome shows an origin-specific permission prompt on first activation; the optional host list in the manifest is a request ceiling, **not** default website access. The content script reads the hostname and DOM only as necessary to identify or hide a selected element; a short label and CSS selectors are persisted **locally**, so avoid using this on highly sensitive pages if even local traces are unacceptable. No cookie or form-value harvesting is implemented.

## OPSEC notes
- **Extension-originated egress:** None in source. No `fetch`, XHR, WebSocket, sendBeacon, tracking pixel, CDN, remote script/font or remote endpoint. The manifest's extension-page CSP explicitly denies `connect-src`. **This does not make websites offline** and cannot control requests made by page scripts, browsers, other extensions or the OS.
- **Persistence:** Rules are hostname-scoped and reversible, with a hard maximum of 100 rules per host. Once an origin is approved, Chrome persists its dynamic site-specific content-script registration until you choose Forget site.  Manual use of the Chrome storage API, browser-profile backup, crash reports or a compromised browser are outside this promise.
- **Trust:** Published source is inspectable, not independently audited. Install only code you have reviewed; do not trust a repackaged binary. Treat any extension with access to webpages as sensitive software.
- **Failure mode:** If no stable selector exists, the picker reports that it cannot save the element instead of claiming success. Removing a site element cannot grant access to content that the server did not deliver.
- **Proof strategy:** Run `node --test tests/*.test.mjs`; read `docs/PRIVACY-AND-THREAT-MODEL.md` and inspect Chrome's popup Network panel and page Network panel separately (there is no extension service worker). A network capture is contextual evidence, not a universal guarantee.

## Source layout
- `manifest.json`: least-privilege permissions, opt-in host access and extension-page CSP
- `popup.*`: compact ADMINE-branded controls, theme choice and local rule management
- `content.js`: isolated-world picker and local mutation handling
- `icons/`: standalone ADMINE contour-A mark with Vanish pink spur
- `docs/PRIVACY-AND-THREAT-MODEL.md`: explicit data-flow and limitations
- `SECURITY.md`: private vulnerability disclosure and support boundaries
- `LICENSE`: **source-available personal/noncommercial permission; commercial rights reserved**

## Chrome Web Store assets

The repository includes a reproducible [store asset pack](https://github.com/0xdx-au/vanish/tree/main/store-assets) with:

- **96×96 Vanish identity logo** and a **128×128 PNG store icon** with 16px transparent padding.
- **Four 1280×800 RGB screenshots**, plus 440×280 and 1400×560 promotional tiles.
- **10-second MP4** of the published content script selecting and hiding a synthetic-page interruption in Chromium, with mocked extension messaging/storage. This demonstrates the DOM picker and is **not** a full installed-MV3 acceptance test.
- **Installable minimal extension ZIP** packaged from the manifest, interface, content script, local icons and policy files.

The Chrome Web Store global promo-video field accepts a genuine YouTube URL only. An MP4 or GitHub link cannot be pasted there: the operator must upload the file to a YouTube account they control. Store assets are produced by [the generator](https://github.com/0xdx-au/vanish/blob/main/scripts/generate_assets.py) and verified by the GitHub Actions media workflow.

## Public interaction boundaries

The [ADMINE Vanish project page](https://admine.au/projects/vanish/) does not embed comments. GitHub Discussions are disabled. This repository intentionally has no public support commitment. To disable **GitHub Issues** and the **Wiki**, the repository owner must change **Settings → General → Features**; the published ISSUE_TEMPLATE config disables blank public issue forms but does not itself disable the GitHub Issues feature. A public repository cannot categorically prevent comments on pull-request conversations. For sensitive vulnerabilities use the private channel in `SECURITY.md`.

## Licensing and owner protection
Copyright © 2026 0xdx-au. **Source-available is not open-source (OSI).** Individuals may inspect, install, run and adapt Vanish privately for non-commercial personal use under the accompanying license. **No other person may sell, sublicense, bundle for sale, redistribute or commercially exploit Vanish without written permission from the copyright holder.** The copyright holder retains the right to license or sell it commercially at their discretion. Public visibility does not cancel these conditions; it also does not technically prevent cloning or infringement. ADMINE marks remain reserved.

This repository accepts **no public support commitments or discussions**. See `SECURITY.md` for private disclosure.

**ADMINE — Less noise. More signal.** · https://admine.au/projects/vanish/
