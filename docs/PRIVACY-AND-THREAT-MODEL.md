# VANISH v1.3 — privacy, boundaries and threat model

**Chrome Web Store policy for users:** https://admine.au/vanish-privacy.html

This document is the technical supplement; the public HTML policy is the address entered into the Chrome Web Store Privacy tab.

**Status:** inspectable source and automated tests, not independently certified. Visual page cleanup only; not an authentication, subscription or server-side access bypass.

## 1 / Minimal data model

A user-activated permission prompt grants Chrome access to an HTTP(S) **hostname + scheme**. Chrome host match patterns **cannot differentiate ports**, so permission applies across those ports; the trusted broker independently authorises the exact **origin**, including port, before allowing a rule read/write. It uses the key `vanish.rules.v3.` + `encodeURIComponent(origin)`.

Stored rule schema: `{enabled:boolean,rules:[{id,selectors,unlockScroll}]}`, with a maximum of 24 rules and three selectors per rule. **No captured page text, arbitrary element label, form value, timestamp, URL path, query string or page contents are persisted.** Structural tag paths and nth-of-type values still reveal some page structure, and the locally retained origin list reveals site origins. Storage is not encrypted.

The content script cannot directly access extension storage. The `background.js` Manifest V3 service worker calls `chrome.storage.local.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"})`, validates sender identity and frame, checks origin-specific approval plus Chrome host permission, and permits only approved rule operations. The service worker contains no network API.

On first v1.3 startup/upgrade, a fail-closed migration **deletes all legacy v1.2 hostname rules and their page-derived text labels**, drops existing dynamic Vanish scripts and host permissions, and requires user re-approval. Old already-injected tabs must be reloaded: Chrome cannot forcibly remove an extension script from an existing page.

## 2 / Interaction and revocation

- Select & Vanish: ask permission on the current site. Approval is deliberately stored for this exact origin, while Chrome's host grant is scheme/hostname-scoped.
- Content script: only starts the picker when the broker verifies origin approval, builds a bounded structural-only selector, and sends it to the broker. It does not inspect or store the popup's text.
- Local observer: only while active rules exist; a 24-rule cap, bounded match count, 240ms debounce, execution budget and mutation-storm fail-safe pause prevent unattended CPU thrash. On failure, restore the page and disconnect.
- Forget hostname: delete all origin-specific rules for **every port and scheme** on the hostname, notify already-running content scripts to stop, unregister matching dynamic scripts, request removal of Chrome host permissions, then verify the removal.
- Purge all: delete all Vanish site rules, approvals and preferences, unregister every Vanish dynamic content script and revoke all optional HTTP(S) host grants.
- Incognito: `"incognito":"not_allowed"` in manifest. No Incognito permission can be enabled.

A hostile page can recreate the overlay, replace DOM nodes, spoof the appearance of the picker, or observe changes that Vanish makes. A non-cooperative website can prevent scrolling or refuse to deliver content. The user should treat an extension with DOM access as sensitive code.

## 3 / Network and egress truth

| Component | Deliberate outbound requests | Qualification |
|---|---|---|
| Popup | None | Assets local, extension-page `connect-src 'none'` |
| Content script | None | DOM, messaging to browser internal extension broker only |
| Service worker | None | Storage and Chrome permissions APIs only; no fetch/network use |
| CDN, fonts, analytics, telemetry | None | No remote assets or developer endpoint |
| Chrome / host website / other extensions | Outside Vanish control | They can continue to make ordinary requests |

**"No extension-initiated application-level egress" is not "zero network traffic from the device."** DOM modifications may be observable by the website, which can transmit its own telemetry. The browser may communicate with vendors for updates, diagnostics and other reasons. Test coverage captures fixture traffic and extension behaviour in Chromium; it cannot see all operating-system or browser service traffic. No source review proves an absolute future guarantee.

## 4 / CI supply chain

The media-generation workflow no longer receives a write-capable GitHub token and cannot commit or push generated binaries to `main`. Its build and extension ZIP are uploaded as **untrusted reviewable CI artifacts** for manual release approval. The security workflow runs source policy assertions and a real, unpacked MV3 Chromium fixture. Both jobs use read-only repository tokens and pin their GitHub Actions to commit SHAs. The package install dependencies are version-pinned, though external package mirrors and runners remain trust dependencies.

The 10-second promotional video still uses a mocked Chrome messaging layer to demonstrate the DOM picker. It is not presented as equivalent to the separate full installed-extension test.

## 5 / Tests and limitations

`node --test tests/security-contract.test.mjs` checks manifest, privacy invariants and CI policy.

`python tests/browser-acceptance.py` uses real Chrome extension APIs in a persistent Chromium profile and locally hosted fixture pages to check install, Incognito denial, unapproved-origin rejection, genuine host permission granting, origin isolation across ports, actual picking, safe persistence, abusive CSS rejection, DOM mutation fail-safe, complete revocation and an HTTP(S) request observer.

Chrome’s own permission prompt automation and the browser’s headless implementation are test-environment dependencies. A test failure is an **inconclusive release gate**, not proof the mechanism is safe. A pass is evidence for the tested browser/version only.

**Trusted boundaries:** installed extension package, browser extension APIs, Chrome profile, GitHub release process. **Untrusted:** websites, page DOM, page script, scraped text, remotely downloaded binaries, arbitrary copied release files.

**Release discipline:** review source, install from a verified build, inspect extension permissions, and test network behaviour independently before claiming operational security.
