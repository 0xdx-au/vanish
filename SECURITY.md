# VANISH security policy

Vanish has privileged access to approved webpages. It is a **visual-cleanup tool**, not a paywall bypass or independently audited security product. Do not submit sensitive URLs, page contents, private browser data or vulnerabilities through public comments or GitHub issues. Use the ADMINE private contact route at https://admine.au/security/ .

## Security boundaries

Version 1.3 enforces:
- **Incognito prohibited** using a manifest declaration.
- **No page text persistence:** only validated structural selectors, generic UI labels and exact origin identifiers are stored locally.
- **Origin approval via trusted worker:** all content-script storage goes through `background.js`, with exact origin checks. Chrome host permission itself cannot isolate ports.
- **Fail-closed legacy migration:** v1.2 stored rules and permissions are purged on upgrade; open tabs must be reloaded to remove already-injected scripts.
- **One-click revocation:** Forget hostname removes all matching origin records, scripts and grants; Purge all removes every Vanish site record and grant. Check for errors rather than assuming success.
- **Performance fail-safe:** mutation flood, too many DOM matches, or expensive scans disconnect observation and restore previously hidden elements.
- **No app egress:** no authored network APIs, telemetry or remote assets. Browser/site traffic is not controlled.

## Release checklist

1. Run the source-policy checks and **real unpacked Chromium tests**, including denied permissions, accepted permissions, different ports, hostile selector rejection, stress activity and revocation.
2. Test an upgrade from v1.2. Verify the legacy `vanish.site.*` keys are gone, Chrome grants and injected scripts removed after tab reload, and users are informed that rules were intentionally reset.
3. Ensure media CI and source CI both have `contents: read`, have no `git push`, and do not distribute generated artifacts without separate review.
4. Confirm `manifest.json` contains only `storage`, `activeTab`, `scripting`, optional HTTP(S) host access, the `background.js` worker, and `incognito: not_allowed`.
5. Test theme, keyboard cancellation, selecting a modal, backdrop hiding, scroll restoration, restore, pause, Forget hostname and Purge all on actual installed Chrome, not only a mocked fixture.
6. Inspect network use in extension service worker and popup separately from website requests. A clean test is evidence, not a universal absence-of-egress proof.
7. Release only a package built from the validated commit. Do not reuse the v1.2 ZIP as a current release.
8. Confirm GitHub Issues/Wiki and public discussion settings with repository ownership. The connected GitHub API may not expose these administration settings.

The source has **not** been independently penetration tested. Chrome, local administrators, a compromised browser/extension profile and malicious extensions remain trusted boundary risks. Existing page changes may persist after extension revocation until a tab reload. All rights not expressly licensed in `LICENSE` remain reserved.
