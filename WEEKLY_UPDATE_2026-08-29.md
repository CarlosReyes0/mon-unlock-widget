# Weekly Update – Open Paywall 🧠 Week #35

**Project:** Open Paywall (MON Unlock Widget)  
**Period:** August 22 – August 29, 2026  
**Live:** https://openpaywall.app

Let's go 👇

---

## 1. TL;DR

**Quick wins ✅**  
Shipped **USDC unlock** on Monad mainnet (generator defaults → `ArticleUnlockUsdc`). Replaced the homepage interactive demo with an **autoplay screen recording** of the real Continue → checkout flow — no payments on `/`. Fixed **iOS Safari video playback** (`video/mp4` + byte-range).

**Challenges 😤**  
Homepage demo was confusing (looked live but couldn’t pay on mobile; then video showed `00:00` until we fixed static serving). Getting a clip from Drive into the repo on mobile Cursor was awkward.

**What's next 🔮**  
First real publisher embed on USDC + fiat; tighten unsigned homepage embed path if we want live checkout on `/` again; dashboard `payment_asset` parity.

---

## 2. Highlights

- 🧪 **USDC path live** — `ArticleUnlockUsdc` deployed (`0xd66D…`), wired into generator + defaults; legacy MON embeds unchanged (path A).
- 📱 **Homepage = video, not wallet** — `/` loops a ~13s publisher recording (Continue → $0.50 checkout). Visitors can't accidentally pay from the marketing page.
- 🍎 **Safari fix shipped** — MP4 served as `video/mp4` with `Accept-Ranges` / 206 responses; duration + autoplay now work on iPhone.
- 🎨 **Product polish** — USDC/MON labels simplified; hero padding + Open/Unlock optical alignment landed earlier in the week.
- 🤝 **Rename continuity** — `<open-paywall>` + Open Paywall branding hold while `mon-unlock` stays supported.

**Why this matters for DeltaV / Monad:**  
Writers can now default to **USDC settlement** (fiat in, USDC to publisher) on the same embed primitive that already drove MON micropayments. The homepage finally **shows** that flow without forcing a wallet or Stripe session on casual visitors.

---

## 3. Lowlights

- 😓 **Demo UX debt** — Production homepage widget still required MetaMask for “simulated” unlock before we switched to video-only.
- 😓 **Video infra gap** — First deploy served MP4 as `application/octet-stream` with no range support; iOS showed black `00:00` until patched same day.
- 😓 **Scope creep on demo PRs** — Explored live unsigned USDC on `/`; correctly simplified to video-only for safety and clarity.

Being transparent so we can fix fast.

---

## 4. Core Metrics

| Metric | This week | Notes |
|--------|-----------|--------|
| **Unlock contracts on mainnet** | 2 | MON (`0x27cA…`) + USDC (`0xd66D…`) |
| **Homepage payment paths** | 0 | Video-only demo; live checkout via generator |
| **Default generator asset** | USDC @ $0.50 | MON path still available |

*(Publisher count / unlock tx volume — still early; will track consistently from next week.)*

---

## 5. This Week's Focus

→ **Dogfood USDC embed** on a real article (signed embed from generator, fiat + crypto).  
→ **Dashboard / register-article** — persist `payment_asset` end-to-end.  
→ **One-line homepage CTA** to generator after video (optional A/B on conversion).

---

## 6. Asks

- **Intros** to indie writers or Substacks on Monad who'd try a **$0.50 USDC** per-article embed (we'll help register + sign).
- **Feedback** on the homepage video demo — does Continue → checkout read clearly in 13 seconds?
- **Monad/DeltaV** — any preference on promoting USDC vs MON as the default wedge for consumer paywalls?

---

## 7. Shoutouts

🙏 **Cursor Cloud Agents** — homepage video iteration, Safari serving fix, USDC wiring.  
🙏 **Carlos** — publisher screen recording used on `/`.  
🙏 **Pareen / DeltaV format** — keeping updates scannable.

---

## Appendix: Technical notes (optional deep dive)

### A. USDC unlock (path B)

- Contract: `ArticleUnlockUsdc` on Monad mainnet — publishers receive **USDC**; MON only for gas on crypto path.
- Generator defaults: `payment-asset="usdc"`, `price="0.50"`, USDC contract in embed output.
- Legacy MON embeds + `ArticleUnlock` contract unchanged.

### B. Homepage demo architecture

- **Before:** `<open-paywall>` without contract → localStorage “demo”; on production still demanded a wallet.
- **After:** `<video autoplay muted loop playsinline>` → `/assets/unlock-demo.mp4` (publisher clip).
- **Server fix:** `server/index.mjs` — `.mp4` → `video/mp4`, streaming + `Range: bytes=`.

### C. Shipped commits (main, Aug 22–29)

- USDC unlock path + generator defaults (#38, #39)
- Homepage demo → autoplay video (#41)
- iOS video playback fix (`6f86666`)

**Agent / API docs:** `/agents.md` · `/skill.md` · `/openapi.json`
