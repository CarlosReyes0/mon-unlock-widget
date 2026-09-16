# Open Paywall — Agents guide

Open Paywall (formerly MON Unlock) lets agents create embeddable paywalls for long-form content. Give your agent this page (or `/llms.txt` / `/skill.md`) so it can publish paste-ready HTML and complete payments programmatically.

## On the go — no JSON

**Messy input is fine.** Humans don't need perfect labels, order, or a `---` line. You interpret what they meant.

**Ideal** paste (if they want a template):

```
Title: July rain walk
Price: 0.50
Teaser: Walking home in the rain…
---
Full article text. Keep going as long as you want.
```

**Also fine:** a rambling message, title on line 1, article below, no `Price:` (default **$0.50 USDC**), teaser mixed into the first paragraph, etc. Use judgment.

### Confirm before you publish (required)

After they send the article, **do not validate or publish yet.** Reply with your interpretation:

```
Here's what I'll publish:

Title: July rain walk
Price: 0.50
Teaser: Walking home in the rain…
Slug: july-rain-walk-k3m9x2   ← I'll generate a fresh one on publish
---
[first ~2 lines of body, or "Full article (N words)"]

Reply with changes, or say "looks good" to publish.
```

Wait for **looks good** (or edits). Then validate → publish. Regenerate slug on the actual publish call.

Completed block (all fields — you add `Slug:`):

```
Title: July rain walk
Price: 0.50
Teaser: Walking home in the rain…
Slug: july-rain-walk-k3m9x2
---
Full article text…
```

(`k3m9x2` is an example — yours differs every time. Never ask them to write Slug.)

**Agent behavior:**
1. Ask for the **publisher wallet once** (`0x…`) and reuse it.
2. Interpret messy paste → show interpretation → **wait for confirmation**.
3. On publish: **always** auto-generate a new slug. Ignore any `Slug:` they included.
4. Optional: `POST /api/agents/publish/parse` only after they confirm (strict checker for the final shape).
5. `POST /api/agents/publish/validate` (free), then `POST /api/agents/publish` (MPP ~$0.05) **or** `POST /api/x402/publish` (x402 USDC on Base ~$0.05).
6. Return `finishRegistrationUrl` — register + **Copy signed embed** once.

Optional: `Author:`. `Asset: mon` (default USDC).

## Discovery surfaces
- LLM overview: `https://mon-unlock-widget-production.up.railway.app/llms.txt`
- Agent skill: `https://mon-unlock-widget-production.up.railway.app/skill.md`
- Cursor / skills: `https://mon-unlock-widget-production.up.railway.app/.well-known/skills/mon-unlock/SKILL.md`
- Bankr / x402 skill: `https://mon-unlock-widget-production.up.railway.app/.well-known/skills/open-paywall-x402/SKILL.md`
- OpenAPI: `https://mon-unlock-widget-production.up.railway.app/openapi.json`
- Health: `GET /api/agents/health`

## What publishing needs
| Step | What it does | Agent can do it? |
|------|----------------|------------------|
| 1. Embed HTML | `<open-paywall>` block (legacy `<mon-unlock>` still works) | Draft only (unsigned) |
| 2. Supabase body | Stores teaser + paid body | Yes (`/api/agents/publish`) |
| 3. On-chain register + signed embed | Registers on Monad and produces payment-ready HTML with `embed-sig` | Manual wallet click on `finishRegistrationUrl` (recommended) or OpenClaw Option A with `privateKey` |

## HTTP API (recommended for any agent)

### Validate (free)
`POST /api/agents/publish/validate`

```json
{
  "title": "July rain walk",
  "articleId": "july-rain-walk",
  "teaser": "Walking home in the rain…",
  "body": "Full article text…",
  "publisher": "0xYourPublisherWallet",
  "paymentAsset": "usdc",
  "price": "0.50",
  "author": "Carlos"
}
```

`paymentAsset` is optional: `"usdc"` (default) or `"mon"`. `price` is a string — USD for USDC (defaults to `"0.50"`), MON for MON (defaults to `"1"`). Omit both for the default USDC embed at $0.50.

Returns quote amount, fingerprint, and whether the payload is valid.

### Publish (MPP paid)
`POST /api/agents/publish` — same JSON body.

1. First request without payment → **402** + `WWW-Authenticate: Payment …`
2. **Only if a payer is already funded:** pay the challenge (`npx mppx <url>` with mainnet PathUSD, or Stripe/Link), then retry with `Authorization: Payment …`.
3. **If not funded:** **stop after this 402.** Tell the human publish costs **$0.05** and they must fund a payer or pay, then ask you to retry. Do not chase faucets, keyrings, or OAuth. Testnet PathUSD does **not** pay production publish.
4. After paid success: response includes an unsigned `embed`, `finishRegistrationUrl`, and `needsManualOnChainRegistration`.
5. Open `finishRegistrationUrl` → register on Monad → sign → **Copy signed embed** (includes `embed-sig`). Paste that HTML on the site — not the unsigned `embed` from step 4.

Default charge: **0.05** pathUSD (env `MPP_PUBLISH_AMOUNT`). Tempo pathUSD is always offered when MPP is configured; Stripe SPT card may also be offered if `STRIPE_SECRET_KEY` is set.

## x402 / Bankr (USDC on Base)

Bankr and other x402 clients pay **USDC on Base**. Open Paywall's human reader unlock remains **USDC on Monad** (default $0.50, no platform fee). The agent HTTP rail is a Base USDC payment to the Open Paywall wallet — not a Monad `unlock()` tx.

| Action | Endpoint | Amount |
|--------|----------|--------|
| Publish listing + store body | `POST /api/x402/publish` | **$0.05** USDC on Base |
| Unlock / fetch paid body | `GET /api/x402/articles/{slug}` or `POST /api/x402/unlock` | Listing price (default **$0.50** USDC on Base) |

Unpaid → HTTP **402** with machine-readable `accepts[]` (`scheme: "exact"`, `network: "base"`, Base USDC, `payTo`, `maxAmountRequired`). Retry with `X-PAYMENT` (v1) or `PAYMENT-SIGNATURE` (v2). Bad/missing payment **fail closed** — `body` is never returned.

If the caller already has entitlement (`reader=0x…` unlocked on-chain/indexed, or Stripe `fiat_session`), the unlock route returns the body **without** charging.

After a **paid x402 publish**, response still includes unsigned `embed`, `finishRegistrationUrl`, and `needsManualOnChainRegistration`. Open that URL, register on Monad, **Copy signed embed**. x402 does not autopilot on-chain register.

Aliases: `POST /api/agents/x402/publish`, `GET /api/agents/x402/unlock`.

```bash
# Inspect challenge (no spend)
curl -sD - -o /dev/null -X POST https://mon-unlock-widget-production.up.railway.app/api/x402/publish \
  -H 'content-type: application/json' \
  -d '{"title":"Demo","articleId":"agent-demo-1","teaser":"…","body":"…","publisher":"0x…"}'

# Bankr pays the 402 and retries
bankr x402 call https://mon-unlock-widget-production.up.railway.app/api/x402/publish \
  -X POST --max-payment 0.05 \
  -d '{"title":"Demo","articleId":"agent-demo-1","teaser":"preview","body":"full text","publisher":"0x…"}'

bankr x402 call https://mon-unlock-widget-production.up.railway.app/api/x402/articles/the-quote-was-a-trap-939i9e \
  --max-payment 0.50
```

MPP on `POST /api/agents/publish` remains fully supported. Do not send x402 headers to the MPP route (and do not send `Authorization: Payment` to the x402 routes).

### Prefund checklist (optional, for autonomous pay)

```
[ ] Tempo mainnet PathUSD ≥ 0.05 on an mppx account, OR Stripe/Link ready
[ ] MPPX_PRIVATE_KEY set if using headless mppx (avoid Linux keyring)
[ ] validate POST
[ ] publish POST with payment
[ ] return finishRegistrationUrl + Copy signed embed instructions
[ ] STOP
```

Without that checklist, a correct agent run ends at the first unpaid 402 with a clear message to the human.

### Example
```bash
# Inspect challenge
curl -sD - -o /dev/null -X POST https://mon-unlock-widget-production.up.railway.app/api/agents/publish \
  -H 'content-type: application/json' \
  -d '{"title":"Demo","articleId":"agent-demo-1","teaser":"…","body":"…","publisher":"0x…"}'

# Pay + fetch (after mppx account create) — defaults to USDC $0.50
npx mppx https://mon-unlock-widget-production.up.railway.app/api/agents/publish \
  --method POST --header 'content-type: application/json' \
  --data '{"title":"Demo","articleId":"agent-demo-1","teaser":"preview","body":"full text","publisher":"0x…"}'
```

## OpenClaw (chat / phone)
See `skills/mon-unlock-embed/OPTIONS.md`:
- **Option B (recommended):** config `publisher` only → agent generates embed + syncs body → user opens `register.html` once.
- **Option A:** config `privateKey` → agent also registers on-chain (gas).

## Human fallback
https://mon-unlock-widget-production.up.railway.app/generator.html

## Stripe Directory findability checklist
1. Create a **public** Stripe profile (Settings → Public details). Do **not** enable “Make your profile private”.
2. Set website to this production URL. Description should use phrases like: *embeddable paywall*, *pay per article*, *content monetization*, *MON unlock*.
3. Allow Stripe crawlers (`/robots.txt` allows `*`).
4. Deploy with `MPP_SECRET_KEY` + `MPP_TEMPO_RECIPIENT`, then register the endpoint on [mpp.dev](https://mpp.dev).
5. Verify with `stripe directory me` (Stripe CLI + directory plugin) and `stripe directory search "embeddable paywall"`.
