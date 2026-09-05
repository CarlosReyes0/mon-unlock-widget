# Weekly Update – Open Paywall 🧠 Week #36

**Project:** Open Paywall (MON Unlock Widget)  
**Period:** August 30 – September 5, 2026  
**Live:** https://mon-unlock-widget-production.up.railway.app

Let's go 👇

---

## 1. TL;DR

**Quick wins ✅**  
**11 PRs merged.** Agent publish now defaults to **USDC $0.50**. Writers can paste a title/price/teaser from a phone. **`/articles`** is live (opt-in feed + hosted paywall). Pay button shows the real amount before checkout.

**Challenges 😤**  
Aggregator shipped then broke three times the same day: pages 404'd in Docker, hosted checkout demanded a missing `embed-sig`, and listed articles looked free. Hid `founder-manifesto` after an unexpected charge.

**What's next 🔮**  
Seed real listed articles; dogfood a signed USDC embed on a live site; persist `payment_asset` on the dashboard.

---

## 2. Highlights

One line per PR merged this week:

- **#42** — Agent `POST /publish` defaults to **USDC $0.50** (`paymentAsset`); MON still works if you ask.
- **#43** — Casual paste format: `Title` / `Price` / `Teaser` + body; agent auto-slugs. No JSON from a phone.
- **#44** — Generator Author field starts blank and stops Safari autofill of the publisher’s real name.
- **#45** — Account email / Google / wallet buttons work on mobile Safari (redirect OAuth + WalletConnect).
- **#46** — Validate photo/video URLs before insert; **Save content** updates teaser/body without re-registering.
- **#47** — “Add media from URL” sheet keeps Cancel / Insert visible when the iPhone keyboard is open.
- **#48** — Opt-in aggregator: `/articles` feed + `/articles/{slug}` hosted page; same `article-id` unlocks everywhere.
- **#49** — Fixed production `/articles` 404 — new HTML pages were never copied into the Docker image.
- **#50** — Hosted listed articles can checkout without `embed-sig`; third-party embeds still need the stamp.
- **#51** — Paywall CTA is `Pay 0.50 USDC` before checkout; `Paid {price}` after card / Apple Pay too.
- **#52** — Removed leftover “Connect sellers” / “Storefront” tabs from the Stripe sample pages.

**Why this matters for DeltaV / Monad:**  
The agent path and the writer path now both settle **USDC on Monad** by default, and listed articles are a public discovery surface — not just a paste-on-your-own-site embed.

---

## 3. Lowlights

- 😓 **#49** — `/articles` launched as `Not found` because the Dockerfile allowlist missed the new HTML.
- 😓 **#50** — Hosted checkout returned `missing_embed_sig` until listed rows were treated as authorized.
- 😓 **#51** — Readers thought listed pieces were free/demo; one unexpected charge. Hid `founder-manifesto`.
- 😓 **#45 / #47** — iOS still the tax: dead Account buttons, then media-sheet actions behind the keyboard.
- 😓 **Metrics still thin** — publisher count / unlock volume not tracked week-to-week yet (same gap as #35).

Being transparent so we can fix fast.

---

## 4. Core Metrics

| Metric | This week | Notes |
|--------|-----------|--------|
| **PRs merged** | 11 | #42–#52 (Aug 30 – Sep 3) |
| **Unlock contracts on mainnet** | 2 | MON (`0x27cA…`) + USDC (`0xd66D…`) |
| **Public surfaces** | `/` + `/articles` | Opt-in feed; manifesto hidden after #51 |
| **Default generator / agent asset** | USDC @ $0.50 | MON via `paymentAsset: "mon"` |

*(Publisher count / unlock tx volume — still early; same promise as last week.)*

---

## 5. This Week's Focus

→ **List 2–3 real articles** on `/articles` (not hidden demos) and unlock one end-to-end.  
→ **Dogfood a signed USDC embed** on an external site (carryover from Week #35).  
→ **Dashboard `payment_asset`** — persist what the generator already defaults.

---

## 6. Asks

- **Intros** to indie writers who’d list one $0.50 USDC piece on `/articles` this week.
- **Feedback** on the hosted feed vs embed-only — is `/articles` a useful discovery surface?
- **Monad/DeltaV** — still want a call on promoting USDC vs MON as the default consumer wedge?

---

## 7. Shoutouts

🙏 **Cursor Cloud Agents** — 11 PRs, including the same-day #48 → #49 → #50 firefight.  
🙏 **Anyone who hit a listed article and paid by surprise** — sorry; price is on the button now.  
🙏 **Pareen / DeltaV format** — keeping updates scannable.

---

## Appendix: Merged PRs (Aug 30 – Sep 5)

| PR | Merged | Title |
|----|--------|--------|
| [#42](https://github.com/CarlosReyes0/mon-unlock-widget/pull/42) | Aug 31 | Default agent publish to USDC $0.50 with paymentAsset support |
| [#43](https://github.com/CarlosReyes0/mon-unlock-widget/pull/43) | Aug 31 | Casual paste format for on-the-go agent publishing |
| [#44](https://github.com/CarlosReyes0/mon-unlock-widget/pull/44) | Sep 1 | Leave Author blank by default in embed generator |
| [#45](https://github.com/CarlosReyes0/mon-unlock-widget/pull/45) | Sep 1 | Fix publisher account connect buttons on mobile Safari |
| [#46](https://github.com/CarlosReyes0/mon-unlock-widget/pull/46) | Sep 1 | Generator: validate media URLs + save content without re-register |
| [#47](https://github.com/CarlosReyes0/mon-unlock-widget/pull/47) | Sep 2 | Fix Add media from URL sheet on mobile when keyboard is open |
| [#48](https://github.com/CarlosReyes0/mon-unlock-widget/pull/48) | Sep 3 | Add opt-in article aggregator (feed + hosted pages) |
| [#49](https://github.com/CarlosReyes0/mon-unlock-widget/pull/49) | Sep 3 | Fix production /articles 404 (copy HTML into Docker image) |
| [#50](https://github.com/CarlosReyes0/mon-unlock-widget/pull/50) | Sep 3 | Fix hosted article checkout missing embed-sig |
| [#51](https://github.com/CarlosReyes0/mon-unlock-widget/pull/51) | Sep 3 | Show article price on the paywall before checkout |
| [#52](https://github.com/CarlosReyes0/mon-unlock-widget/pull/52) | Sep 3 | Remove Connect sellers and Storefront tabs |

**Agent / API docs:** `/agents.md` · `/skill.md` · `/openapi.json`  
**Feed:** https://mon-unlock-widget-production.up.railway.app/articles
