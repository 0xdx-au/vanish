# VANISH security policy

Vanish has privileged access to approved webpages. It is a **visual-cleanup tool**, not a paywall bypass or independently audited security product. Do not submit sensitive URLs, page contents, private browser data or vulnerabilities through public comments or GitHub issues. Use the ADMINE private contact route at https://admine.au/security/ .

## Supported stable releases and reports

The current supported package is the latest source-verified stable Vanish build. Test dependencies are pinned to released versions, and changes require real Chromium acceptance checks before producing an installable package. Nightly, beta and development snapshots are not published as stable builds.

We welcome reproducible bug reports and commit to reviewing and attempting feasible fixes, prioritising security and privacy. Reports requiring account authentication on GitHub are not fully anonymous; avoid sharing secrets or identifying browsing content. A fix or response time cannot be guaranteed.

Public [Vanish terms](https://admine.au/vanish-terms) and [privacy policy](https://admine.au/vanish-privacy) describe the current user-facing position; these do not override statutory consumer rights.

## Security boundaries

Version 1.5.0 enforces:
- **Incognito prohibited** using a manifest declaration.
- **No page text persistence:** only validated structural selectors, generic UI labels and exact origin identifiers are stored locally.
- **Origin approval via trusted worker:** all content-script storage goes through `background.js`, with exact origin checks. Chrome host permission itself cannot isolate ports.
- **Fail-closed legacy migration:** v1.2 stored rules and permissions are purged on upgrade; open tabs must be reloaded to remove already-injected scripts.
- **One-click revocation:** Forget hostname removes all matching origin records, scripts and grants; Purge all removes every Vanish site record and grant. Check for errors rather than assuming success.
- **Performance budget:** busy DOM mutation bursts temporarily back off observer scans while retaining active CSS rules. Expensive scans yield rather than permanently disabling hiding; overbroad selectors can still trigger a fail-closed pause and restore.
- **Local Signal telemetry:** disabled by default, stored only as 14 days of fixed-name UTC daily aggregate counters. No hostnames, paths, selectors, page text, error messages or event-by-event timestamps are stored. Dashboard-only read/toggle/clear messages require an exact trusted extension URL; content events are approved-origin-only and rate-limited.
- **Local reset:** the dashboard clears counters independently; the extension's global clear erases the telemetry key along with local rules and approvals.
- **No app egress:** no authored network APIs, remotely transmitted telemetry or remote assets. Browser/site traffic is not controlled.

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
