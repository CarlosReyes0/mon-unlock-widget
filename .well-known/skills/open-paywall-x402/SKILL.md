---
name: open-paywall-x402
description: >-
  Publish and unlock Open Paywall articles by paying USDC via x402 (HTTP 402).
  Use for Bankr / bankr x402 call / agent wallets. Settlement is USDC on Base.
  Human readers still unlock USDC on Monad. MPP PathUSD publish still works.
---

# Open Paywall — Bankr / x402

Live: https://openpaywall.app

## What this is
Open Paywall lets agents **publish** a paid article (embed + stored body) and
**unlock/read** a listing's paid body over HTTP 402. No browser, no Stripe, no
`$OPENPAYWALL` token.

## Settlement (read this)
| Who | Asset | Chain |
|-----|--------|--------|
| Bankr / x402 agents | USDC | **Base** (`eip155:8453`) |
| Human readers (widget) | USDC (default $0.50, no platform fee) | **Monad** (143) |
| Legacy agent publish | PathUSD ~$0.05 | Tempo (MPP) |

Bankr wallets pay USDC on Base. Open Paywall maps that settlement to the product
wallet. It is **not** the same tx as a reader `unlock()` on Monad.

## Prices
- Publish (agent listing + body storage): **$0.05** USDC on Base
- Unlock/read body: listing price, default **$0.50** USDC on Base
- After publish, the publisher still opens `finishRegistrationUrl` to register
  on Monad and **Copy signed embed**. x402 does not skip that wallet step.

## Endpoints
- Free validate: `POST /api/agents/publish/validate`
- x402 publish: `POST /api/x402/publish` (alias `POST /api/agents/x402/publish`)
- x402 unlock: `GET /api/x402/articles/{slug}` or `POST /api/x402/unlock`
- MPP publish (still supported): `POST /api/agents/publish`

Unpaid x402 calls return **HTTP 402** with `accepts[]` (`scheme: exact`,
`network: base`, Base USDC, `payTo`, `maxAmountRequired`). Retry with
`X-PAYMENT` (v1) or `PAYMENT-SIGNATURE` (v2). Missing/bad payment **fail closed**
— paid `body` is never returned.

Existing reader entitlement (`reader=0x…` already unlocked, or Stripe
`fiat_session`) returns the body **without** charging again.

## Bankr
```bash
# Inspect challenge (no spend)
curl -sD - -o /tmp/op-x402-body.json -X POST \
  https://openpaywall.app/api/x402/publish \
  -H 'content-type: application/json' \
  -d '{"title":"Demo","articleId":"agent-demo-1","teaser":"preview","body":"full text","publisher":"0xYourPublisherWallet"}'

# Pay + publish (~$0.05). Confirm the 402 amount first.
bankr x402 call https://openpaywall.app/api/x402/publish \
  -X POST \
  -d '{"title":"Demo","articleId":"agent-demo-1","teaser":"preview","body":"full text","publisher":"0xYourPublisherWallet"}' \
  --max-payment 0.05

# Pay + read a listed slug (default $0.50)
bankr x402 call https://openpaywall.app/api/x402/articles/the-quote-was-a-trap-939i9e \
  --max-payment 0.50
```

Always show the human the price and get approval before paying. If the unpaid
402 is all you needed for discovery, **stop** — do not hunt for funding.

## MPP still works
`POST /api/agents/publish` remains PathUSD/Stripe SPT (~$0.05). Use that when
the agent already has `mppx` / Tempo PathUSD. Do not send x402 headers there.

## Do not
- Expect Bankr to pay USDC on Monad (it pays Base).
- Return or scrape `articles.body` from the public Data API.
- Skip `finishRegistrationUrl` after publish.
- Launch or mention an `$OPENPAYWALL` token.
