# VANISH
**An ADMINE local-first browser instrument.** Select a nuisance layer. Make it disappear. Keep control.

Vanish is a Chrome Manifest V3 extension for *visual* page cleanup: click an unwanted modal, banner, overlay or dimmer, inspect what will be hidden, and save a reversible rule for that hostname. It does **not** bypass server-side subscriptions, authorisation, DRM or access controls.

> **Privacy boundary:** No analytics, telemetry, tracking identifiers, remote assets, third-party SDKs, account, network API, or extension-initiated outbound requests. Rules stay in Chrome's `chrome.storage.local` on this browser profile. Chrome and visited websites continue their ordinary network activity. Local DOM observation, only while saved rules are active, is used to reapply hiding after page updates; that is not remote monitoring.

## Install
1. Download this repository as a ZIP from **Code → Download ZIP**, and extract it.
2. Open `chrome://extensions`, enable **Developer mode** and choose **Load unpacked**.
3. Select the extracted repository directory containing `manifest.json`. Pin Vanish from the extensions menu.
4. On an ordinary HTTP(S) site, click Vanish → **SELECT & VANISH**, hover to preview and click. **Shift** selects the exact element; **Esc** cancels.
5. Undo from the page notice or extension, restore individual rules, pause a site or restore all.

Chrome Web Store and `chrome://` pages are not injectable. Some iframes, shadow roots, dynamically generated selectors and server-enforced locks remain outside the capability boundary.

## Permissions and data

| Capability | Why it exists | Boundary |
| --- | --- | --- |
| `content_scripts` on HTTP(S) pages | Saved selectors must reapply on subsequent visits | No background crawler; no active logging; page data is not sent out |
| `storage` | Save selector, a short locally derived label, per-site enabled flag, optional UI theme | `chrome.storage.local`, **not sync** |
| `activeTab` | Start the picker in the foreground tab on demand | User gesture required |
| `scripting` | Re-inject picker on existing tabs opened before installation | Foreground tab only |

No `tabs`, `webRequest`, `declarativeNetRequest`, `cookies`, `history`, `identity`, `downloads`, `nativeMessaging` or broad extension host networking permission. The content script reads the hostname and DOM only as necessary to identify or hide a selected element; a short label and CSS selectors are persisted **locally**, so avoid using this on highly sensitive pages if even local traces are unacceptable. No cookie or form-value harvesting is implemented.

## OPSEC notes
- **Extension-originated egress:** None in source. No `fetch`, XHR, WebSocket, sendBeacon, tracking pixel, CDN, remote script/font or remote endpoint. The manifest's extension-page CSP explicitly denies `connect-src`. **This does not make websites offline** and cannot control requests made by page scripts, browsers, other extensions or the OS.
- **Persistence:** Rules are hostname-scoped and reversible, with a hard maximum of 100 rules per host. Manual use of the Chrome storage API, browser-profile backup, crash reports or a compromised browser are outside this promise.
- **Trust:** Published source is inspectable, not independently audited. Install only code you have reviewed; do not trust a repackaged binary. Treat any extension with access to webpages as sensitive software.
- **Failure mode:** If no stable selector exists, the picker reports that it cannot save the element instead of claiming success. Removing a site element cannot grant access to content that the server did not deliver.
- **Proof strategy:** Run `node --test tests/*.test.mjs`; read `docs/PRIVACY-AND-THREAT-MODEL.md` and inspect Chrome's extension service worker / popup Network panel and page Network panel separately. A network capture is contextual evidence, not a universal guarantee.

## Source layout
- `manifest.json`: permissions, CSP and static content-script registration
- `popup.*`: compact ADMINE-branded controls, theme choice and local rule management
- `content.js`: isolated-world picker and local mutation handling
- `icons/`: standalone ADMINE contour-A mark with Vanish pink spur
- `docs/PRIVACY-AND-THREAT-MODEL.md`: explicit data-flow and limitations
- `SECURITY.md`: private vulnerability disclosure and support boundaries
- `LICENSE`: **source-available personal/noncommercial permission; commercial rights reserved**

## Licensing and owner protection
Copyright © 2026 0xdx-au. **Source-available is not open-source (OSI).** Individuals may inspect, install, run and adapt Vanish privately for non-commercial personal use under the accompanying license. **No other person may sell, sublicense, bundle for sale, redistribute or commercially exploit Vanish without written permission from the copyright holder.** The copyright holder retains the right to license or sell it commercially at their discretion. Public visibility does not cancel these conditions; it also does not technically prevent cloning or infringement. ADMINE marks remain reserved.

This repository accepts **no public support commitments or discussions**. See `SECURITY.md` for private disclosure.

**ADMINE — Less noise. More signal.** · https://admine.au/projects/vanish/
