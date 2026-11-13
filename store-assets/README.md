# Vanish — Chrome Web Store listing assets

These images are ready for the Chrome Web Store **Store listing** form. They are not uploaded just because they appear on GitHub or the ADMINE site.

## To clear the two publication errors

### 1. At least one screenshot or video is required

Open your extension in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/) and choose **Store listing → Screenshots**. Download a PNG below to your computer, then upload that **file** into the screenshot field. Check that a thumbnail appears and save your draft.

| Screenshot | Direct PNG | Use |
|---|---|---|
| 01 — Before | [1280×800 PNG](screenshots/01-before.png) | A controlled test page before visual cleanup |
| 02 — Select | [1280×800 PNG](screenshots/02-target-selected.png) | Highlighting the selected element |
| 03 — After | [1280×800 PNG](screenshots/03-vanished.png) | Page after hiding an interruption |
| 04 — Rules | [1280×800 PNG](screenshots/04-local-rule.png) | **Illustrative composite**, not a live popup capture |

Use **01, 02 and 03** as a short sequence. All three are RGB PNGs captured on a synthetic local test site. Avoid presenting the fourth as an unmodified Chrome extension screenshot.

Google requires at least one screenshot of **1280×800** or **640×400**, full bleed, and supports up to five. Screenshot images in the repository are **not automatically attached** to a Chrome Web Store listing.

### 2. Privacy policy link is not valid

Under the extension's **Privacy** tab, enter this complete URL in the **Privacy policy** field:

**https://admine.au/vanish-privacy.html**

The policy is a standalone public HTTPS HTML document specifically describing Vanish's local rule storage, website permissions, data sharing, deletion options, and Chrome Web Store Limited Use compliance. Do **not** use the generic `https://admine.au/privacy/` page, GitHub README, or an image URL for the extension's privacy policy.

Also complete the Privacy tab's own required disclosures and certification. They must agree with the policy and the installed extension's actual behaviour. A live website page is not a substitute for putting its URL in the Dashboard field.

### Save your draft

After the screenshot thumbnail appears and the privacy policy URL is accepted, choose **Save draft**, then check **Publish** again. A separate developer-dashboard upload is required; the website repository cannot populate those private listing fields.

## Other media

- [Store icon — 128×128 PNG](store-icon-128x128.png)
- [Small promo — 440×280 PNG](small-promo-440x280.png)
- [Marquee — 1400×560 PNG](marquee-promo-1400x560.png)
- [Vanish video — 10s MP4](vanish-working-demo-10s.mp4) — **not** a YouTube URL. The optional video field expects an actual YouTube link; don't paste the MP4 or GitHub URL.

The 128×128 icon has a centered 96×96 mark with 16px transparent padding. The video demonstrates `content.js` on a controlled local Chromium page with mocked message/storage APIs. The [installed-extension security tests](../tests/browser-acceptance.py) separately exercise real Manifest V3 permissions and storage; the promo video is not equivalent to those tests.

All graphics are generated locally by [`scripts/generate_assets.py`](../scripts/generate_assets.py). Images never contain real user browsing information.
