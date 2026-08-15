# Weekly Update – MON Unlock Widget (Open Paywall) 🧠 Week #33

**Period:** August 15, 2026 (today — first session this week)  
**Live:** https://mon-unlock-widget-production.up.railway.app

Let’s go👇

### 1. TL;DR

Quick wins ✅  
• Redesigned the homepage into a compact **Open Paywall** hero that scrolls into the live unlock demo  
• Fixed widget light-DOM slot bleed and left-aligned the teaser  
• Landed optical brand/lede alignment + side padding after iteration; shipped to production  

Challenges 😤  
• Quiet week until today — no earlier Week #33 shipping before this session  
• Type alignment (Open / Unlock) took more passes than the layout redesign itself  

What’s next 🔮  
• Dashboard edit/save so publishers change articles without re-pasting HTML  
• Resume a real metrics cadence next update  

---

### 2. Highlights

• 🎨 **Homepage Option B shipped** — brand-first compact hero (“Open Paywall” + “Unlock premium content with Monad or fiat”), original product nav, no hero CTA / SCROLL chrome; live `<open-paywall>` demo is the reveal below the fold  
• 🐛 **Slot bleed fixed** — teaser/body were leaking as page text for `open-paywall` / `mon-unlock`; light-DOM slots hidden in page + widget styles; teaser left-aligned  
• ✨ **Polish approved and pushed** — plain white hero (dropped tacky header photo/gradient), **2rem** side padding, mild JS optical align so **Unlock…** tracks **Open Paywall** without over-pulling left  

---

### 3. Lowlights

• 😓 No project work earlier this week — this update is a same-day session, not a full-week arc  
• 😓 Optical alignment chewed time (first-glyph boxes, bias tweaks) before the approved look stuck  
• 😓 Core product backlog items (dashboard edit, clearer pay errors) untouched today  

Being transparent so we can fix fast.

---

### 4. Core Metrics

*(Not pulled today — carry the same three next time.)*

• Registered articles: _[TBD]_  
• Unlock txs (MON + fiat): _[TBD]_  
• Active publishers: _[TBD]_  

---

### 5. This Week’s Focus

→ **Dashboard edit + save** — title / body / price without re-pasting embed HTML  
→ **Metrics snapshot** for the next weekly  
→ Optional: clearer reader pay errors  

---

### 6. Asks

• Feedback on the new homepage — is brand → scroll-to-demo obvious in one pass?  
• Intros to writers / publishers on Monad who want pay-per-article (Monad + fiat) embeds  

---

### 7. Shoutouts

🙏 Anyone who gave visual feedback on the homepage drafts — the approved inset + Open/Unlock align came from that loop.

Credit where it’s due.

---

### Appendix — What shipped today

| Change | Notes |
|--------|--------|
| Compact scroll-to-demo homepage | `index.html` — brand + lede, live widget below |
| Slot bleed + teaser align | page CSS + `src/widget/styles.css` |
| Optical Open / Unlock align | post-font-load first-glyph nudge |
| Production | pushed to `main` / live Railway |

**Not this session** (prior weeks): Open Paywall rename (#34), article ID protection / new ArticleUnlock (#35).
