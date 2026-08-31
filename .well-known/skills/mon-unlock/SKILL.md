---
name: mon-unlock
description: >-
  Create embeddable paywalls for long-form articles with Open Paywall (legacy
  name: MON Unlock). Use when the user wants to monetize a post, generate a
  pay-per-article embed, publish paid content on Monad, or have an agent create
  an `<open-paywall>` (or legacy `<mon-unlock>`) paywall via HTTP/MPP or OpenClaw.
---

# Open Paywall — create an embeddable paywall

## Product
Open Paywall turns an article into a paste-ready `<open-paywall>` HTML block
(legacy `<mon-unlock>` remains supported). Readers unlock with MON on Monad or
card / Apple Pay / Google Pay. Live site: https://mon-unlock-widget-production.up.railway.app

## When to use
- User asks to create a paywall, paid article embed, or monetize writing.
- User wants pay-per-article (not a full newsletter SaaS).

## Agent workflow (HTTP)

### Human paste (no JSON)

```
Title: July rain walk
Price: 0.50
Teaser: Walking home in the rain…
---
Full article text…
```

Ask for publisher wallet once and reuse. Auto-slug = title + short unique suffix (same title twice is OK). Optional `Slug:` override.

1. Read https://mon-unlock-widget-production.up.railway.app/llms.txt and /agents.md if you need details.
2. Parse the paste (or `POST /api/agents/publish/parse` with `{ paste, publisher }`).
3. `POST /api/agents/publish/validate` (free) to confirm the payload and quote.
4. `POST /api/agents/publish` with the same JSON.
   - Expect HTTP 402 + Payment challenge if unpaid (about **$0.05**).
   - If a funded payer is already available: show the price, get approval, pay, retry with `Authorization: Payment …` (or `npx mppx` with **mainnet** PathUSD).
   - **If not funded: STOP after this first 402.** Tell the human publish requires $0.05 and ask them to pay or provide a funded `MPPX_PRIVATE_KEY`. Do **not** install keyrings, use testnet faucets, or bypass via Supabase.
5. After **paid** publish: send `finishRegistrationUrl`. Explain: open the link → Register on Monad → approve the embed signature → **Copy signed embed** and paste that HTML. Do not tell them to paste the unsigned API `embed`.

## OpenClaw workflow
If OpenClaw is available, install `skills/mon-unlock-embed`, paste `AGENT.md`, configure `publisher` or `privateKey`, and call `generate_mon_unlock_embed`. (No MPP $0.05 fee on this path.)

## Never
- Hand-write embed HTML when the API/tool is available.
- Skip explaining the on-chain registration step when it was not completed.
- Move money without showing the price and getting explicit approval.
- After an unpaid 402, hunt for funding for more than one attempt — ask the human and stop.
