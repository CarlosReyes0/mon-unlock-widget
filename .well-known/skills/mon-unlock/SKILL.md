---
name: mon-unlock
description: >-
  Create embeddable paywalls for long-form articles with MON Unlock. Use when the
  user wants to monetize a post, generate a pay-per-article embed, publish paid
  content on Monad, or have an agent create a `<mon-unlock>` paywall via HTTP/MPP
  or OpenClaw.
---

# MON Unlock — create an embeddable paywall

## Product
MON Unlock turns an article into a paste-ready `<mon-unlock>` HTML block. Readers unlock with MON on Monad or card / Apple Pay / Google Pay. Live site: https://mon-unlock-widget-production.up.railway.app

## When to use
- User asks to create a paywall, paid article embed, or monetize writing.
- User wants pay-per-article (not a full newsletter SaaS).

## Agent workflow (HTTP)
1. Read https://mon-unlock-widget-production.up.railway.app/llms.txt and /agents.md if you need details.
2. Collect fields: `title`, `articleId` (slug), `teaser`, `body`, `publisher` (0x), optional `price`, `author`.
3. `POST /api/agents/publish/validate` (free) to confirm the payload and quote.
4. `POST /api/agents/publish` with the same JSON.
   - Expect HTTP 402 + Payment challenge if unpaid.
   - Present payment methods and get user approval before paying.
   - Retry with `Authorization: Payment …` (or use `npx mppx`).
5. Give the user the returned `embed` HTML.
6. If `needsManualOnChainRegistration`, send `finishRegistrationUrl` and explain readers cannot pay until they complete that MetaMask step.

## OpenClaw workflow
If OpenClaw is available, install `skills/mon-unlock-embed`, paste `AGENT.md`, configure `publisher` or `privateKey`, and call `generate_mon_unlock_embed`.

## Never
- Hand-write embed HTML when the API/tool is available.
- Skip explaining the on-chain registration step when it was not completed.
- Move money without showing the price and getting explicit approval.
