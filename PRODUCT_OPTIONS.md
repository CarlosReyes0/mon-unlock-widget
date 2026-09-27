# Product options (from Aug 2026 planning chat)

Saved so these ideas aren’t lost. Not a commitment to build all of them.  
Check off or delete items as you decide.

---

## Already done

- [x] **One-click Copy signed embed** after agent registration (`/register.html`)
- [x] **Skill/docs: stop after first unpaid 402** — ask the human; don’t chase faucets
- [x] **On-chain register + gas relayer** — keep articles on-chain (required for crypto unlock); writers sign, platform pays gas via `registerArticleFor`

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

## On-chain registration (locked)

**Yes, register articles on-chain.** Crypto unlock (`unlock` / `hasUnlocked`) and embed-sig checks read the contract. Skipping that would make card-only posts work and break MON/USDC pay.

**No, writers should not pay gas to publish.** `/write`, generator, and `/register.html` sign the embed (free), then `POST /api/relay/register` calls `registerArticleFor` as the contract owner. If `RELAYER_PRIVATE_KEY` is unset, the writer’s wallet still submits `registerArticle` (old path).

Set `RELAYER_PRIVATE_KEY` on Railway to the **contract owner** wallet, funded with a little MON. That key can also `updatePrice` / `setActive` (owner privileges) — use a dedicated hot wallet, not a cold deployer that holds other funds.

---

## Posting (north star)

See **[POSTING.md](./POSTING.md)** (mockups in `docs/posting/`). Live at **/write**: title, piece, Publish. Generator stays the embed tool.

- [x] **Host a photo, video, or audio on /write** — pick or drop a file (8 / 20 / 45 MB). YouTube links still paste. Public file URL; the paywall hides it in the article. Supabase bucket `article-media` when configured.

## Edit articles without re-pasting HTML

(You liked this direction. Fits posting once Publish exists.)

- [ ] **Dashboard edit + save** — best default
- [x] **Draft → Publish** — local multi-draft on `/write` (device-only; server sync later)
- [ ] **Reopen in generator and save** (update instead of create)
- [ ] **API / CMS-style updates**
- [ ] **In-place edit on the live site** — nicest UX, more work

---

## Embed security

- [ ] **Store `embed-sig` on the server** — public embed stays a short tag; server checks the stamp at pay time

---

## Other product options

- [x] **Article aggregator** — opt-in list on Open Paywall (`/articles`) + hosted page + optional external URL; auto-list + hide later; one unlock everywhere
- [ ] **Clearer reader pay errors** (wrong network, no funds, bad/missing sig)
- [ ] **Richer writer dashboard** (revenue, unlock counts, recent payments)
- [ ] **Faster reader unlock** (fewer steps to pay)
- [ ] **WordPress / Webflow plugin** — only if someone asks

---

## Explicitly skip for now

- Dynamic pricing / `$READ` / ERC-20 — gated on Monad/DeltaV feedback (see `FOCUS.md`)

---

## Related docs

- `POSTING.md` — posting = write + Publish (like Substack)
- `FOCUS.md` — phase roadmap and out-of-scope rules
- `WEEKLY_UPDATE_2026-08-01.md` — latest DeltaV-style progress writeup
- `agents.md` / `skill.md` — agent publish + 402 hard-stop
