# Open Paywall — Agents guide

Open Paywall (formerly MON Unlock) lets agents create embeddable paywalls for long-form content. Give your agent this page (or `/llms.txt` / `/skill.md`) so it can publish paste-ready HTML and complete payments programmatically.

## Discovery surfaces
- LLM overview: `https://mon-unlock-widget-production.up.railway.app/llms.txt`
- Agent skill: `https://mon-unlock-widget-production.up.railway.app/skill.md`
- Cursor / skills: `https://mon-unlock-widget-production.up.railway.app/.well-known/skills/mon-unlock/SKILL.md`
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
  "price": "1",
  "author": "Carlos"
}
```

Returns quote amount, fingerprint, and whether the payload is valid.

### Publish (MPP paid)
`POST /api/agents/publish` — same JSON body.

1. First request without payment → **402** + `WWW-Authenticate: Payment …`
2. **Only if a payer is already funded:** pay the challenge (`npx mppx <url>` with mainnet PathUSD, or Stripe/Link), then retry with `Authorization: Payment …`.
3. **If not funded:** **stop after this 402.** Tell the human publish costs **$0.05** and they must fund a payer or pay, then ask you to retry. Do not chase faucets, keyrings, or OAuth. Testnet PathUSD does **not** pay production publish.
4. After paid success: response includes an unsigned `embed`, `finishRegistrationUrl`, and `needsManualOnChainRegistration`.
5. Open `finishRegistrationUrl` → register on Monad → sign → **Copy signed embed** (includes `embed-sig`). Paste that HTML on the site — not the unsigned `embed` from step 4.

Default charge: **0.05** pathUSD (env `MPP_PUBLISH_AMOUNT`). Tempo pathUSD is always offered when MPP is configured; Stripe SPT card may also be offered if `STRIPE_SECRET_KEY` is set.

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
  -d '{"title":"Demo","articleId":"agent-demo-1","teaser":"…","body":"…","publisher":"0x…","price":"1"}'

# Pay + fetch (after mppx account create)
npx mppx https://mon-unlock-widget-production.up.railway.app/api/agents/publish \
  --method POST --header 'content-type: application/json' \
  --data '{"title":"Demo","articleId":"agent-demo-1","teaser":"preview","body":"full text","publisher":"0x…","price":"1"}'
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
