# Security policy and private disclosure

Vanish is a browser extension with access to page DOMs and therefore has a sensitive trust boundary. The source is published for independent review, not as evidence of a completed external security audit.

**Do not post vulnerabilities, affected URLs, exploit payloads, browser profiles, cookies, screenshots or private website content to a public GitHub Issue or Discussion.** Use ADMINE's current private contact channel documented at https://admine.au/security/ . Do not assume a particular email address is configured without checking the website.

## Scope
- Manifest V3 permissions and whether a permission can be removed
- Picker integrity, selector persistence, DOM mutation safety and scrolling restoration
- Privacy claims, accidental extension-initiated egress and package contamination
- Host isolation, stored labels, and extension UI content injection

## Non-goals / caveats
- This is a visual-only element remover, **not** a paywall or authentication bypass.
- Page JavaScript can observe DOM changes. A malicious page, another extension, or compromised browser can interfere with selection or infer interaction.
- No promise is made to support every DOM structure, closed shadow root, iframe, hostile site, or browser build.
- No external pen-test or independent security certification is claimed.

The GitHub repository is intended as a code reference, not a public support channel. Public Issues, Discussions and Wiki should be disabled in repository settings by the maintainer. The site project page provides no comments form. If a public issue or PR thread exists, do not disclose sensitive material there.

## Operator release checklist
1. Confirm `manifest.json` has exactly `storage`, `activeTab`, `scripting`, and the intentionally broad static HTTP(S) content-script scope.
2. Review code for new `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, dynamic `import()`, externally hosted assets, or analytics SDKs.
3. Verify `chrome.storage.local` only; never sync page-derived data.
4. Inspect the Chrome Extensions page to verify all loaded unpacked files came from this repository.
5. Exercise install, first-open tab, select, pause, undo, restore, refresh, SPA DOM recreation and unsupported-page errors.
6. Verify the popup's Network panel shows no extension-originated network requests. Distinguish website/Chrome traffic and document uncertainty.
7. Confirm public repository metadata, licence status and no accidental secrets or personal information before releasing.

Any future network-capable feature must be a separate, explicitly reviewed security/privacy change; it cannot silently weaken the local-only claim.
