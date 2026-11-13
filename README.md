# VANISH.
**ADMINE / LOCAL BROWSER CONTROL** · Less noise. More signal.

Vanish v1.3 is a source-available Chrome Manifest V3 extension. Select an unwanted popup or visual layer, hide it locally, and restore it later. It cannot bypass authentication, DRM, server-enforced subscriptions or content that a website never delivered.

> **OPSEC boundary:** No authored telemetry, remote assets or extension-initiated HTTP requests. Website, Chrome and other software traffic is **not controlled**. No page text or selected element label is persisted. Store only structural selectors and locally approved origins. Source review and CI do **not** constitute an independent security certification.

## Install (source-first)

1. Verify the source at https://github.com/0xdx-au/vanish ; download this repository as a ZIP and extract it.
2. In Chrome open `chrome://extensions`, enable **Developer mode**, select **Load unpacked** and choose the directory containing `manifest.json`.
3. On an HTTP(S) page, open Vanish and choose **Select & Vanish**. Chrome asks for host permission. Grant it only if you trust the page and want persistent rules. Hover to preview, click to hide, hold **Shift** to target an exact element, or press **Esc** to cancel.
4. Use **Restore**, **Pause**, **Forget hostname** or **Purge all sites**. Forget hostname removes all of that hostname's saved origins (including ports and schemes), revokes matching Chrome host grants and unregisters its scripts. Purge all removes every Vanish grant, rule and preference.

**Chrome host permissions cannot distinguish TCP ports.** Vanish's internal broker checks the full origin, including port, before allowing any storage or rule operation. A content script may technically be injected into another port on a permitted host, but it cannot activate or read rules there without separate origin approval.

**Incognito is disabled entirely.** Vanish cannot be enabled for private browsing; Chrome extension-local storage is shared with the profile and is not an encrypted vault. No file URLs, browser internal pages or Chrome Web Store pages are supported.

### Important upgrade notice — v1.2 → v1.3

Version 1.2 could save up to 64 characters of selected webpage text as a rule label. **The v1.3 upgrade intentionally deletes every old `vanish.site.*` record, existing permission and old injected script registration** to remove this data. Users must approve sites and reselect elements. Reload tabs already open during the upgrade to unload previously injected scripts. **Do not distribute the old v1.2.0 extension ZIP.**

## Architecture

| Layer | Authority | Stored information |
|---|---|---|
| Popup | User-initiated Chrome host permission, per-origin management | Generic UI text, optional theme |
| Isolated content script | User picker, page CSS, best-effort scroll recovery | **No direct storage access**, no copied page text |
| Privileged `background.js` service worker | Validates origin approvals, storage schema and permissions; enforces revocation | Origin list, structural CSS paths and rule IDs |
| Chrome `storage.local` | Not synced by Vanish; access restricted to trusted extension contexts | Origin-scoped rules, approved origins; local profile only |
| Network | No Vanish application-level network API | Nothing intentionally sent to ADMINE |

Selector paths only contain structural HTML tags and `:nth-of-type` positions. Site layout structure and approved origins can still be sensitive browsing metadata, accessible to someone with control of the Chrome profile. Rules are limited to 24 per origin, with bounded matching, mutation debounce and a fail-safe pause on hostile page activity. If no safe selector exists, Vanish refuses to save it.

The extension changes DOM visibility, not HTTP routing or website access permissions. The site can observe and reverse those changes.

## Security testing and release

- `node --test tests/security-contract.test.mjs`: static policy tests for permissions, persistence, origin handling, no network APIs, and read-only publishing.
- `python tests/browser-acceptance.py` (with Playwright Chromium installed): genuine unpacked extension runtime checks on loopback fixtures, including denied access, Incognito prohibition, Chrome grant, DOM selection, origin isolation, unsafe CSS rejection, mutation storm fail-safe, revocation and request observations.
- `.github/workflows/verify.yml`: pinned GitHub Actions, read-only token, real Chromium test.
- `.github/workflows/store-assets.yml`: produces **reviewable build artifacts only**, with a read-only GitHub token. It cannot commit or push unreviewed media or extension packages to `main`.

**Do not confuse the store demonstration with proof.** The existing ten-second promotional video uses a synthetic page and mocked extension messages for presentation. The separate real-browser tests are the acceptance evidence. No single source scan or network test can prove universal absence of browser/network egress or resistance to every malicious webpage.

## Public assets and provenance

The historical `store-assets/` directory includes exact-size store icons and imagery. The **v1.2.0 ZIP in that directory is obsolete**. Obtain the current v1.3 source from a verified GitHub commit; review the release workflow artifact before publishing a Chrome Web Store package.

Detailed boundaries: [Privacy & threat model](docs/PRIVACY-AND-THREAT-MODEL.md) · [Security policy](SECURITY.md) · [ADMINE project page](https://admine.au/projects/vanish/).

The ADMINE page has no comments. GitHub Discussions are disabled, while Issues and Wiki require owner-side GitHub repository setting changes; disabling blank issue templates alone does not switch them off. Do not post sensitive security findings publicly.

## Licensing and owner protection

Copyright © 2026 0xdx-au. **Source-available is not open-source (OSI).** The accompanying [Personal Use Licence 1.0](LICENSE) permits individual, private, non-commercial use and inspection. Third parties cannot sell, sublicense, commercially redistribute, or otherwise commercially exploit Vanish without separate written permission from the rights holder. The owner reserves the right to license or sell the product commercially at their discretion. Public visibility cannot technically prevent unauthorised copying; enforcement is a legal matter. ADMINE marks are reserved.

**ADMINE — Less noise. More signal.**
