Weekly Update – Open Paywall (MON Unlock Widget) 🧠 Week #Aug 8

Let’s go👇

1. TL;DR
Quick wins ✅ Renamed to **Open Paywall** without breaking live embeds. Shipped global article-id protection (Supabase reserve + on-chain `ArticleTaken`). Deployed new Monad mainnet `ArticleUnlock` and cut production over.
Challenges 😤 Article IDs were a silent takeover risk (same slug → overwrite). Deploy key briefly exposed in terminal logs — funds moved; treat that key as burned for ownership.
What’s next 🔮 Smoke-test new contract end-to-end, land more publishers on Open Paywall, decide homepage / Phase 3 domain when ready.

2. Highlights
• 🏷️ **Open Paywall** brand live — dual-support for legacy `<mon-unlock>` / `mon-unlock.js` so existing embeds keep working (#34)
• 🔐 **Article ID safety** — reserve-on-create in Supabase + `ArticleTaken` on a new mainnet contract so writers can’t steal each other’s slugs (#35)
• ⛓️ New contract: `0x27cA0c23835328e2Ab1424b66330be86fe177FA6` (Monad mainnet) — Railway `UNLOCK_CONTRACT` + Supabase `CONTRACT_ADDRESS` updated
• 🤖 Agent publish path still the wedge: validate → MPP pay → finish registration → signed embed → paste

3. Lowlights
• 😓 Slugs were globally unique in practice but the old contract **silently overwrote** on re-register — fixed only after cutover to the new bytecode
• 😓 Deploy tooling friction (wrong directory, `.env` format, key ≠ funded wallet) slowed the mainnet deploy
• 😓 Private key appeared in shell output during `.env` debugging — mitigated by moving funds; prefer a fresh owner key long-term
• 😓 Old articles remain on `0x038446b1…` — no automatic migrate; new publishes use the new contract

Being transparent so we can fix fast.

4. Core Metrics
• Registered articles (Supabase): **~53**
• Distinct publishers: _(see dashboard)_
• Succeeded fiat unlocks: **7**
• On-chain unlocks: _(indexer on new contract — re-baseline after cutover)_
(Pick the same 3 next week for trend.)

5. This Week’s Focus
→ Production smoke test on the new contract (register → sign → unlock MON + card)
→ Get 1–2 more independent writers live with Open Paywall embeds
→ Homepage / positioning pass (Open Paywall) without breaking embed CDN URLs (Phase 3 domain still later)

6. Asks
• Intros to **independent writers / newsletters** who want pay-per-article (not Substack lock-in) on Monad
• Feedback from anyone who’s pasted an embed: is “article id must be unique” clear enough in the generator?
• Eyes on the agent publish flow (`/agents.md`) — where do agents still get stuck after the unpaid-402 hard stop?

7. Shoutouts
🙏 DeltaV / Monad for the runway to ship real mainnet contract upgrades
🙏 Anyone who dogfooded the agent → `/register.html` → signed embed path
Credit where it’s due.

---

### Supporting detail (engineering)

| Ship | Why it matters |
|------|----------------|
| Dual-support rename | Brand → Open Paywall; protocol strings (`MON Unlock v1` sigs, checkout source) stay stable |
| Supabase `registration_status` + unique slug | Claim id before chain tx; `409 slug_taken` for conflicts |
| `ArticleTaken` | Hard stop on-chain if another publisher owns the id |
| Contract cutover | Live address `0x27cA0c23835328e2Ab1424b66330be86fe177FA6` |

**Live:** https://mon-unlock-widget-production.up.railway.app  
**Agents:** `/llms.txt` · `/agents.md` · `/skill.md` · `/openapi.json`
