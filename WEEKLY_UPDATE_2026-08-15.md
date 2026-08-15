# Weekly Update – MON Unlock Widget (Open Paywall) 🧠 Week #33

**Period:** August 2 – August 15, 2026  
**Live:** https://mon-unlock-widget-production.up.railway.app

Let’s go👇

### 1. TL;DR

Quick wins ✅  
• Shipped **Open Paywall** rename with dual-support for legacy `<mon-unlock>` embeds  
• Hardened article IDs (on-chain guard + Supabase reserve) and cut over to a new ArticleUnlock contract  
• Redesigned the homepage into a compact brand → scroll-to-live-demo surface  

Challenges 😤  
• Homepage polish took longer than expected (slot bleed, optical type alignment)  
• Still light on published hard metrics for this reporting cycle  

What’s next 🔮  
• Dashboard edit/save so publishers can change articles without re-pasting HTML  
• Tighten Core Metrics tracking week-to-week  

---

### 2. Highlights

• 🧪 **Open Paywall branding (#34)** — product surfaces, docs, and custom element `<open-paywall>` live; legacy `<mon-unlock>` still works so existing embeds don’t break  
• 🔐 **Article ID protection (#35)** — on-chain `ArticleTaken`-style guard + reserve-on-create in Supabase; production defaults pointed at the new ArticleUnlock contract  
• 🎨 **Homepage Option B** — compact hero (brand + one lede), original product nav, live unlock demo below the fold; marketing copy uses Monad / fiat; widget teaser left-aligned and light-DOM slot bleed fixed  
• 📋 **Product options backlog** — agent free-publish, dashboard edit, server-side `embed-sig`, and related ideas saved in `PRODUCT_OPTIONS.md` so planning doesn’t evaporate  
• 📝 **DeltaV ritual** — Pareen weekly template + agent rule checked in so updates stay scannable for the program  

---

### 3. Lowlights

• 😓 Homepage iteration burned many cycles on visual alignment (Open / Unlock first-glyph optics, padding, slot bleed) before it felt shippable — motion was real, but not the highest leverage hour-for-hour  
• 😓 Core Metrics still mostly qualitative this week; need a fixed unlock / article / publisher snapshot each Friday  
• 😓 Hosted article editing (top ask from prior weeks) did not ship this period  

Being transparent so we can fix fast.

---

### 4. Core Metrics

*(Stage-appropriate set — fill from production when available; keep the same three next week.)*

• Registered articles (indexer / Supabase): _[TBD]_  
• Unlock txs (MON + fiat, period): _[TBD]_  
• Active publishers (connected wallets with ≥1 article): _[TBD]_  

Live demo + generator remain the primary dogfood surfaces: https://mon-unlock-widget-production.up.railway.app

---

### 5. This Week’s Focus

→ **Dashboard edit + save** — change title / body / price without re-pasting embed HTML on the publisher site  
→ **Metrics cadence** — pull the three Core Metrics above for next week’s update  
→ Optional polish: clearer reader pay errors; server-stored `embed-sig` so public embeds can stay short  

---

### 6. Asks

• Feedback welcome on the new homepage / Open Paywall brand — does the scroll-to-demo make the product obvious in one pass?  
• Intros to **writers / publishers shipping long-form on Monad** who want a pay-per-article embed (MON + fiat)  
• If you have a preferred dashboard edit UX (inline vs generator reopen vs draft→publish), say which you’d dogfood first  

---

### 7. Shoutouts

🙏 DeltaV / Monad program for the weekly ritual format (Pareen’s guide) — it forced a cleaner TL;DR this cycle instead of another engineering dump alone.

Credit where it’s due.

---

### Appendix — PRs this period (detail)

| PR | What |
|----|------|
| [#34](https://github.com/CarlosReyes0/mon-unlock-widget/pull/34) | Open Paywall rename + dual-support for legacy embeds |
| [#35](https://github.com/CarlosReyes0/mon-unlock-widget/pull/35) | Article ID protection + new ArticleUnlock cutover |
| Main follow-ups | Homepage compact scroll-to-demo, slot bleed fix, optical brand/lede align |

Supporting docs: `PRODUCT_OPTIONS.md`, `DELTA_V_WEEKLY_TEMPLATE.md`, prior deep dive `WEEKLY_UPDATE_2026-08-01.md`.
