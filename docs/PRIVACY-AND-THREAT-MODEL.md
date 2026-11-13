# Vanish — data flow, privacy and threat model

## Execution path
1. At installation Vanish has **no default website content-script access**. Clicking the popup picker requests a Chrome optional host permission for the **current HTTP(S) origin** only. If approved, Chrome registers a persistent isolated-world content script for that origin; other sites remain untouched. The content script reads the current hostname to compute a local storage key.
2. Chrome extension-local storage returns saved rules for that hostname and an enabled flag. These are never synced by the extension. The **Forget site** command removes the local hostname rules, unregisters the current origin's dynamic script and asks Chrome to revoke that origin's permission. Already loaded tabs require a reload to unload the injected script.
3. If rules are active, the content script installs a private CSS stylesheet and a *local* MutationObserver to reapply rules to recreated DOM elements. The observer is disconnected when no active rule remains.
4. User gesture in the popup starts an isolated-world picker. While active, the script examines visible element ancestry, position, classes, role and text (for a short label). Click creates CSS selectors for the chosen element and optional backdrop.
5. Chrome stores selectors, label and timestamp locally. The page applies CSS to hide matching elements. A best-effort scroll repair applies only to overlay selections and preserves/reinstates modified inline style properties on restore.
6. All site data remains in the browser profile under `chrome.storage.local`; there is no app server, account, backend, remote diagnostics or telemetry.

## Trust boundaries
- **Extension boundary** — the popup/content scripts are isolated-world JavaScript, but are still privileged to view and alter webpage DOM; the selected element's short label is local browser data.
- **Webpage boundary** — the site can observe visible DOM changes and can dynamically rebuild overlays, disable content delivery, or enforce server-side access controls; Vanish cannot override those.
- **Browser boundary** — browser extensions, Chrome Sync settings, profile backups, security products, browsing history and native browser services have independent behaviour. Vanish cannot assert they transmit no data.
- **Local user boundary** — someone with access to the Chrome profile can inspect saved rules. Do not treat storage as encryption.

## Egress inventory
| Component | Extension-initiated network requests | Note |
|---|---|---|
| popup JS/CSS | None | Packaged assets only; extension-page CSP denies `connect-src` |
| content script | None | Packaged script, injected only on approved origin, DOM operations, local storage API |
| service worker | N/A | No background/service worker registered |
| remote assets or analytics | None | No CDN, fonts, images, tracking pixels or SDKs |
| the visited webpage / Chrome | Uncontrolled by Vanish | Normal browser/site connections continue and may react to DOM changes |

This is **zero application-level outbound data transmission**, not a guarantee of zero device network egress. "No monitoring" means no developer/operator tracking or off-device surveillance. Local DOM observation for applying a saved user rule is disclosed, limited in purpose and disabled when no enabled rules exist.

## STRIDE-style scenarios
| Risk | Boundaries and mitigation | Residual |
|---|---|---|
| Spoofed UI | Isolated shadow UI, explicit user gesture, no remote content | Pages can imitate the branding |
| Stored-selector manipulation | Bounded selectors, grammar validation, local-only storage | Local malware / compromised extension profile |
| Accidental content hiding | Highlight preview, reversible rules, pause/restore controls | Wrong click still changes page |
| Sensitive metadata | Rules scoped to hostname; short local label; no sync or egress | Profile backups or local administrators |
| DOM thrash / denial of service | 100-rule cap, debounced observer, bounded selectors | Complex pages can still degrade |
| Misleading access claim | Explicit visual-only limitation | Website may immediately recreate gates |
| Vendor monetisation | Source-available terms reserve commercial exploitation | Technical ability to fork cannot be eliminated |

## Verifiable evidence and limitations
Review the exact published source: `manifest.json`, `content.js`, `popup.js`, `popup.css` and packaged icons. Run the included Node test suite, then perform manual Chrome testing on a synthetic page (not sensitive third-party content). For egress, inspect extension context Network panels, not the entire tab, and compare with a baseline without the extension. Repeat after reload, selection, restore and tab navigation. Static source audits and captured traffic establish evidence only for the tested version and environment, not absolute future claims.

**Privacy default:** No website access before approval, no auto-enabled website-specific prewritten rules, no cloud backup, no lists downloaded, no telemetry and no third-party integrations.
