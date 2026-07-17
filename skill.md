# MON Unlock agent skill

Read this before creating a paywall with MON Unlock from an AI assistant, coding agent, or autonomous runtime.

## What this service does
MON Unlock creates an **embeddable paywall** for long-form articles. You get paste-ready HTML (`<mon-unlock>`). Readers pay per article with **MON on Monad** or **card / Apple Pay / Google Pay**.

## Quick setup
- LLM overview: `https://mon-unlock-widget-production.up.railway.app/llms.txt`
- Agent guide: `https://mon-unlock-widget-production.up.railway.app/agents.md`
- OpenAPI: `https://mon-unlock-widget-production.up.railway.app/openapi.json`
- Cursor skill: `https://mon-unlock-widget-production.up.railway.app/.well-known/skills/mon-unlock/SKILL.md`
- Human generator: `https://mon-unlock-widget-production.up.railway.app/generator.html`
- OpenClaw plugin: install from `skills/mon-unlock-embed` in the GitHub repo

## Preferred agent path (HTTP / MPP)
1. Collect: `title`, `articleId` (slug), `teaser`, `body`, `publisher` (0x wallet), optional `price` (MON) and `author`.
2. Validate (free): `POST /api/agents/publish/validate` with that JSON.
3. Publish (paid): `POST /api/agents/publish` with the same JSON.
   - Unpaid → HTTP **402** + `WWW-Authenticate: Payment …`
   - Pay with `mppx` / Link CLI / Tempo / Privy, then retry with `Authorization: Payment …`
4. Return the `embed` HTML to the user.
5. If `needsManualOnChainRegistration` is true, send them `finishRegistrationUrl` so they approve one MetaMask transaction. Readers cannot pay until that step is done.

## OpenClaw path (phone / chat)
Install `skills/mon-unlock-embed`, paste `AGENT.md` into the workspace, configure `publisher` (Option B) or `privateKey` (Option A). Call tool `generate_mon_unlock_embed` — never hand-write embed HTML.

## Do not
- Invent contract addresses or skip on-chain registration.
- Charge the user/publisher without showing price and getting approval when using MPP payers.
- Promise Directory listing without a public Stripe profile + crawlable site (see `/llms.txt`).
