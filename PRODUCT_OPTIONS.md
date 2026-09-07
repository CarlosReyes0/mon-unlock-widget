# Product options (from Aug 2026 planning chat)

Saved so these ideas aren’t lost. Not a commitment to build all of them.  
Check off or delete items as you decide.

---

## Already done

- [x] **One-click Copy signed embed** after agent registration (`/register.html`)
- [x] **Skill/docs: stop after first unpaid 402** — ask the human; don’t chase faucets

---

## Agent publish / payment

- [ ] **Publisher free-publish path** — your agent publishes with your API key or wallet proof (no $0.05 MPP fee)
- [ ] **Clearer unpaid 402 response** — plain JSON: pay $0.05 + how, not only `WWW-Authenticate` headers
- [ ] **Optional staging after 402** — save body + return finish URL, marked incomplete (so agents don’t bypass via raw Supabase)
- [ ] **Prefund checklist / payer docs** — `MPPX_PRIVATE_KEY` + mainnet PathUSD, or Stripe/Link
- [ ] **Don’t advertise Stripe SPT** when cloud agents can’t use it (or document exact setup)
- [ ] Keep **$0.05 for outside/public agents**; don’t make your own dogfood depend on it

**Suggested order:** free-publish for you first; clearer 402 / docs as polish.

---

## Edit articles without re-pasting HTML

(You liked this direction.)

- [ ] **Dashboard edit + save** — best default
- [ ] **Draft → Publish**
- [ ] **Reopen in generator and save** (update instead of create)
- [ ] **API / CMS-style updates**
- [ ] **In-place edit on the live site** — nicest UX, more work

---

## Embed security

- [ ] **Store `embed-sig` on the server** — public embed stays a short tag; server checks the stamp at pay time

---

## Other product options

- [x] **Article aggregator** — opt-out list on Open Paywall (`/articles`) + hosted page + optional external URL; listed by default + hide later; one unlock everywhere
- [ ] **Clearer reader pay errors** (wrong network, no funds, bad/missing sig)
- [ ] **Richer writer dashboard** (revenue, unlock counts, recent payments)
- [ ] **Faster reader unlock** (fewer steps to pay)
- [ ] **WordPress / Webflow plugin** — only if someone asks

---

## Explicitly skip for now

- Dynamic pricing / `$READ` / ERC-20 — gated on Monad/DeltaV feedback (see `FOCUS.md`)

---

## Related docs

- `FOCUS.md` — phase roadmap and out-of-scope rules
- `WEEKLY_UPDATE_2026-08-01.md` — latest DeltaV-style progress writeup
- `agents.md` / `skill.md` — agent publish + 402 hard-stop
