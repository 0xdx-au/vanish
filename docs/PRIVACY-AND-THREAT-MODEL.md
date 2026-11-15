# VANISH v1.5 — privacy, boundaries and threat model

**Chrome Web Store policy for users:** https://admine.au/vanish-privacy

This document is the technical supplement; the public HTML policy is the address entered into the Chrome Web Store Privacy tab.

**Status:** inspectable source and automated tests, not independently certified. Visual page cleanup only; not an authentication, subscription or server-side access bypass.

## 1 / Minimal data model

A user-activated permission prompt grants Chrome access to an HTTP(S) **hostname + scheme**. Chrome host match patterns **cannot differentiate ports**, so permission applies across those ports; the trusted broker independently authorises the exact **origin**, including port, before allowing a rule read/write. It uses the key `vanish.rules.v3.` + `encodeURIComponent(origin)`.

Stored rule schema: `{enabled:boolean,rules:[{id,selectors,unlockScroll}]}`, with a maximum of 24 rules and three selectors per rule. **Rule records contain no page text, arbitrary element label, form value, per-rule timestamp, URL path, query string or page contents.** Structural tag paths and nth-of-type values still reveal some page structure, and the locally retained origin list reveals site origins. Storage is not encrypted.

The content script cannot directly access extension storage. The `background.js` Manifest V3 service worker calls `chrome.storage.local.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"})`, validates sender identity and frame, checks origin-specific approval plus Chrome host permission, and permits only approved rule operations. The service worker contains no network API.

On the original v1.3 startup/upgrade, a fail-closed migration **deletes all legacy v1.2 hostname rules and their page-derived text labels**, drops existing dynamic Vanish scripts and host permissions, and requires user re-approval. Old already-injected tabs must be reloaded: Chrome cannot forcibly remove an extension script from an existing page.

### Optional Local Signal telemetry

Version 1.5 adds an extension-owned, **off-by-default** activity dashboard under `dashboard.html`. Its `vanish.telemetry.v1` entry has the shape `{version:1,enabled:boolean,days:[{day:'YYYY-MM-DD',counts:{fixedName:integer}}]}`. It retains at most 14 UTC calendar-day buckets, not individual events. The broker whitelists each counter name, limits counts, and serialises updates. It does **not** include an origin, hostname, URL, path, structural selector, page content, error string or persistent analytics identifier. The date bucket itself reveals a coarse day of extension usage, so users should not mistake it for anonymity from someone with local profile access.

Only `dashboard.html` may read, toggle or clear telemetry. An approved top-level content script may submit an enumerated, rate-limited `CONTENT_SIGNAL`; unapproved origins and cross-frame senders remain denied. No page-supplied text is persisted. Clicking **Clear telemetry** clears daily buckets. Global **Clear all sites** removes the telemetry key. Disabling collection keeps existing buckets until explicitly cleared; it does not affect saved hiding rules. No extension code implements an analytics endpoint or network request.

## 2 / Interaction and revocation

- Select & Vanish: ask permission on the current site. Approval is deliberately stored for this exact origin, while Chrome's host grant is scheme/hostname-scoped.
- Content script: only starts the picker when the broker verifies origin approval, builds a bounded structural-only selector, and sends it to the broker. It does not inspect or store the popup's text.
- Local observer: only while active rules exist; a 24-rule cap, bounded match count, 240ms debounce and execution budget limit work. Mutation storms temporarily pause observation and retry without dropping rules; overbroad selectors trigger fail-closed restoration.
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
| Remote analytics, fonts or telemetry endpoint | None | No remote assets, publisher server or network sink |\n| Local Signal dashboard | None | Opt-in daily aggregate counters stored only in trusted extension-local storage |
| Chrome / host website / other extensions | Outside Vanish control | They can continue to make ordinary requests |

**"No extension-initiated application-level egress" is not "zero network traffic from the device."** DOM modifications may be observable by the website, which can transmit its own telemetry. The browser may communicate with vendors for updates, diagnostics and other reasons. Test coverage captures fixture traffic and extension behaviour in Chromium; it cannot see all operating-system or browser service traffic. No source review proves an absolute future guarantee. Local telemetry is not a claim of network anonymity.

## 4 / CI supply chain

The media-generation workflow no longer receives a write-capable GitHub token and cannot commit or push generated binaries to `main`. Its build and extension ZIP are uploaded as **untrusted reviewable CI artifacts** for manual release approval. The security workflow runs source policy assertions and a real, unpacked MV3 Chromium fixture. Both jobs use read-only repository tokens and pin their GitHub Actions to commit SHAs. The package install dependencies are version-pinned, though external package mirrors and runners remain trust dependencies.

The 10-second promotional video still uses a mocked Chrome messaging layer to demonstrate the DOM picker. It is not presented as equivalent to the separate full installed-extension test.

## 5 / Tests and limitations

`node --test tests/security-contract.test.mjs` checks manifest, privacy invariants and CI policy.

`python tests/browser-acceptance.py` uses real Chrome extension APIs in a persistent Chromium profile and locally hosted fixture pages to check install, Incognito denial, unapproved-origin rejection, genuine host permission granting, origin isolation across ports, actual picking, safe persistence, abusive CSS rejection, DOM mutation fail-safe, complete revocation and an HTTP(S) request observer.

Chrome’s own permission prompt automation and the browser’s headless implementation are test-environment dependencies. A test failure is an **inconclusive release gate**, not proof the mechanism is safe. A pass is evidence for the tested browser/version only.

**Trusted boundaries:** installed extension package, browser extension APIs, Chrome profile, GitHub release process. **Untrusted:** websites, page DOM, page script, scraped text, remotely downloaded binaries, arbitrary copied release files.

**Release discipline:** review source, install from a verified build, inspect extension permissions, and test network behaviour independently before claiming operational security.
