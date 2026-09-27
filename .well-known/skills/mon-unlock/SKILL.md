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
card / Apple Pay / Google Pay. Live site: https://openpaywall.app

## When to use
- User asks to create a paywall, paid article embed, or monetize writing.
- User wants pay-per-article (not a full newsletter SaaS).

## Agent workflow (HTTP)

### Human paste (no JSON)

Messy input is fine — interpret loosely. **Before validate/publish:** echo back Title, Price, Teaser, Slug (you'll generate), and body preview; wait for confirmation.

```
Title: July rain walk
Price: 0.50
Teaser: Walking home in the rain…
Slug: july-rain-walk-k3m9x2
---
Full article text…
```

(Example slug — fresh one every publish.)

1. Interpret their message → **show interpretation → wait for OK**.
2. Read /agents.md if needed.
3. `POST /api/agents/publish/validate` (free), then `POST /api/agents/publish` (MPP) **or** `POST /api/x402/publish` (Bankr / x402 USDC on Base).
   - Expect HTTP 402 if unpaid (about **$0.05**). MPP uses `Authorization: Payment …`; x402 uses `X-PAYMENT` / `bankr x402 call` (USDC on **Base**).
   - If a funded payer is already available: show the price, get approval, pay, retry.
   - **If not funded: STOP after this first 402.** Tell the human publish requires $0.05 and ask them to pay or provide a funded payer. Do **not** install keyrings, use testnet faucets, or bypass via Supabase.
4. After **paid** publish: send `finishRegistrationUrl`. Explain: open the link → Register on Monad → approve the embed signature → **Copy signed embed** and paste that HTML. Do not tell them to paste the unsigned API `embed`.
5. To **read** a paid article as an agent: `GET /api/x402/articles/{slug}` (402 → pay listing USDC on Base, default $0.50). Human widget unlock stays USDC on Monad.

See `/.well-known/skills/open-paywall-x402/SKILL.md` for Bankr examples.

## OpenClaw workflow
If OpenClaw is available, install `skills/mon-unlock-embed`, paste `AGENT.md`, configure `publisher` or `privateKey`, and call `generate_mon_unlock_embed`. (No MPP $0.05 fee on this path.)

## Never
- Hand-write embed HTML when the API/tool is available.
- Skip explaining the on-chain registration step when it was not completed.
- Move money without showing the price and getting explicit approval.
- After an unpaid 402, hunt for funding for more than one attempt — ask the human and stop.
