# Open Paywall agent skill

Read this before creating a paywall with Open Paywall from an AI assistant, coding agent, or autonomous runtime.

## What this service does
Open Paywall creates an **embeddable paywall** for long-form articles. You get paste-ready HTML (`<open-paywall>`; legacy `<mon-unlock>` still works). Readers pay per article with **MON on Monad** or **card / Apple Pay / Google Pay**.

## Quick setup
- LLM overview: `https://openpaywall.app/llms.txt`
- Agent guide: `https://openpaywall.app/agents.md`
- OpenAPI: `https://openpaywall.app/openapi.json`
- Cursor skill: `https://openpaywall.app/.well-known/skills/mon-unlock/SKILL.md`
- Bankr / x402 skill: `https://openpaywall.app/.well-known/skills/open-paywall-x402/SKILL.md`
- Human generator: `https://openpaywall.app/generator.html`
- OpenClaw plugin: install from `skills/mon-unlock-embed` in the GitHub repo

## Preferred agent path (HTTP / MPP or x402)

### Bankr / x402 (USDC on Base)

Bankr wallets pay **USDC on Base**, not Monad. Use these routes (MPP PathUSD still works on `/api/agents/publish`):

1. Validate (free): `POST /api/agents/publish/validate`
2. Publish: `POST /api/x402/publish` — unpaid → HTTP **402** with `accepts[]` (**$0.05** USDC on Base). Pay once (`bankr x402 call` / `X-PAYMENT`), retry.
3. After paid publish: return `finishRegistrationUrl`. The publisher still registers on Monad and **Copy signed embed**.
4. Unlock/read: `GET /api/x402/articles/{slug}` — unpaid → 402 at the listing price (default **$0.50** USDC on Base). Paid retry returns the body. Existing `reader` / `fiat_session` entitlement skips the charge.

```bash
bankr x402 call https://openpaywall.app/api/x402/publish \
  -X POST -d '{"title":"Demo","articleId":"agent-demo-1","teaser":"preview","body":"full text","publisher":"0x…"}' \
  --max-payment 0.05

bankr x402 call https://openpaywall.app/api/x402/articles/SLUG \
  --max-payment 0.50
```

Show the price and get approval before paying. Human widget unlock remains **USDC on Monad**.

### Human paste (recommended on mobile)

**Messy is OK** — labels, order, and `---` are optional. You interpret.

**Always confirm first:** after they send the article, reply with Title / Price / Teaser / Slug (you'll generate) / body summary. Wait for **looks good** or edits. **Then** validate and publish.

Ideal template if they ask:

```
Title: July rain walk
Price: 0.50
Teaser: Walking home in the rain…
---
Full article text…
```

You add a fresh `Slug:` on publish. `POST /api/agents/publish/parse` is optional — use it on the **confirmed** draft, not on first messy paste.

### API fields (after parsing)

Collect: `title`, `articleId` (slug), `teaser`, `body`, `publisher` (0x wallet), optional `paymentAsset` (`"usdc"` default), optional `price` (default `"0.50"` USDC), optional `author`.

1. Validate (free): `POST /api/agents/publish/validate` with that JSON.
2. Publish (paid): `POST /api/agents/publish` with the same JSON (MPP) **or** `POST /api/x402/publish` (Bankr USDC on Base).
   - MPP unpaid → HTTP **402** + `WWW-Authenticate: Payment …` (default **$0.05** PathUSD on Tempo mainnet; Stripe SPT may also be offered).
   - x402 unpaid → HTTP **402** + `accepts[]` (default **$0.05** USDC on Base).
   - **If you already have a funded payer** (`MPPX_PRIVATE_KEY` with mainnet PathUSD, Bankr USDC on Base, or working Stripe/Link): pay once, retry with the matching proof header, continue.
   - **If you do not:** **STOP after this first unpaid 402.** Tell the human they must pay $0.05 (or provide a funded payer), then retry publish. Do **not** install keyrings, chase faucets, create Tempo/AgentCash accounts, or invent workarounds.
3. After a **paid** publish succeeds: return `finishRegistrationUrl` (and mention the unsigned `embed` is not for the site).
4. Tell them to open `finishRegistrationUrl` → register on Monad → approve the embed signature → **Copy signed embed** → paste that HTML. Readers cannot pay until the signed HTML is on the site.

## Hard stop on unpaid 402 (required)

After **one** unpaid publish → 402 (`/api/agents/publish` or `/api/x402/publish`):

1. Report: validate succeeded; publish needs **$0.05** (MPP PathUSD **or** x402 USDC on Base).
2. Ask the human to either pay (funded `mppx` / Tempo mainnet PathUSD / Stripe Link) **or** provide a prefunded `MPPX_PRIVATE_KEY`, then ask you to retry.
3. **Stop.** Do not spend time on:
   - Linux keyring / `secret-tool` / gnome-keyring
   - Tempo or other **testnet** faucets (production publish needs **mainnet**)
   - AgentCash / OAuth / social bonuses
   - Calling Supabase `register-article` or other bypasses to skip paid publish
   - Building site pages as a substitute for a successful paid publish response

Testnet funds will not satisfy the production 402. A correct unpaid run ends in under a minute with a clear ask to the human.

## OpenClaw path (phone / chat)
Install `skills/mon-unlock-embed`, paste `AGENT.md` into the workspace, configure `publisher` (Option B) or `privateKey` (Option A). Call tool `generate_mon_unlock_embed` — never hand-write embed HTML. (OpenClaw does not use the MPP 402 publish fee.)

## Do not
- Invent contract addresses or skip on-chain registration.
- Charge the user/publisher without showing price and getting approval when using MPP payers.
- Hunt for funding after an unpaid 402 — ask the human instead.
- Promise Directory listing without a public Stripe profile + crawlable site (see `/llms.txt`).
