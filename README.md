# MON Unlock

**Embeddable paywall** for independent publishers — **pay-per-article content monetization**. Paste one HTML block on WordPress, Webflow, Notion export, or any site.

Readers unlock the full article with **MON** on Monad, or with **card / Apple Pay / Google Pay** (Stripe). AI agents can create paywalls over **MPP (HTTP 402)** or OpenClaw.

**Agent discovery:** [/llms.txt](./llms.txt) · [/agents.md](./agents.md) · [/skill.md](./skill.md) · [/openapi.json](./openapi.json)

**What to build next:** see **[FOCUS.md](./FOCUS.md)** (Phase 1: onchain MON → Phase 2: embed generator).

**Smart contract:** [`contracts/`](./contracts/) — `ArticleUnlock.sol` (Foundry). Run `forge test` in `contracts/`.

## Try the demo locally

```bash
npm install
npm run dev
```

Open the URL shown in the terminal.

## Live testnet demo

https://mon-unlock-widget-production.up.railway.app

Pages:
- `/` – Homepage
- `/generator.html` – Create embed
- `/account.html` – Publisher account (email / Google / wallet)
- `/dashboard.html` – Writer dashboard + Stripe payouts
- `/agents` · `/agents.md` · `/llms.txt` · `/skill.md` – Agent discovery
- `/openapi.json` – Machine-readable agent API
- `/embed-example.html` – Clean copy-paste embed reference
- `/connect-demo.html` – Dev: Stripe Connect sample (not in main nav)
- `/connect-store.html` – Dev: sample storefront

Product nav is shared via `site-nav.js`: **Home · Create embed · Account · Dashboard · Agents**.

## Agents & Stripe Directory

Agents can create paywalls without cloning this repo:

1. `POST /api/agents/publish/validate` — free quote
2. `POST /api/agents/publish` — MPP-paid publish (HTTP **402** until paid)
3. Open `finishRegistrationUrl` → register + sign → **Copy signed embed** (do not paste the unsigned API `embed`)

See **[agents.md](./agents.md)** for the full flow. OpenClaw plugin: [`skills/mon-unlock-embed`](./skills/mon-unlock-embed).

### Make yourself findable (manual Stripe step)

Code alone cannot list you in Stripe Directory. After deploy:

1. Stripe Dashboard → public business profile → **keep profile public**
2. Website URL = this production host; description uses *embeddable paywall*, *pay per article*, *content monetization*
3. Set Railway env `MPP_SECRET_KEY` + `MPP_TEMPO_RECIPIENT` (see `.env.example`)
4. Register the MPP endpoint on [mpp.dev](https://mpp.dev)
5. `stripe directory me` / `stripe directory search "embeddable paywall"`

## Stripe Connect sample (Accounts v2)

Self-contained demo of marketplace Connect: platform creates **recipient** connected accounts, onboard via V2 Account Links, create platform Products mapped to sellers, and sell via Checkout **destination charges** + application fee.

1. Set `STRIPE_SECRET_KEY` (and optionally `STRIPE_PLATFORM_FEE_BPS`, default 10%).
2. Open `/connect-demo.html` → create account → **Onboard to collect payments** → create a product.
3. Open `/connect-store.html` → buy with hosted Checkout.
4. Thin webhooks (optional): Dashboard → Developers → Webhooks → destination for **Connected accounts**, payload **Thin**, events `v2.core.account[requirements].updated` and `v2.core.account[configuration.recipient].capability_status_updated`. Set `STRIPE_CONNECT_WEBHOOK_SECRET` and point the destination at `/api/connect-sample/webhook`.

Local CLI:

```bash
stripe listen --thin-events 'v2.core.account[requirements].updated,v2.core.account[configuration.recipient].capability_status_updated' --forward-thin-to localhost:8080/api/connect-sample/webhook
```

Implementation: `server/connect-sample.mjs` (commented step-by-step).

Or run locally:

```bash
npm run build
# serve the root folder
```

## Embed on your site (copy & paste)

### Once per website

Upload `dist/mon-unlock.js` and `dist/mon-unlock.css` to your host (or CDN). Then add to every page header:

```html
<link rel="stylesheet" href="https://mon-unlock-widget-production.up.railway.app/dist/mon-unlock.css" />
<script type="module" src="https://mon-unlock-widget-production.up.railway.app/dist/mon-unlock.js"></script>
```

Or self-host from your own domain.

**CORS for third-party embeds:** The production CDN at https://mon-unlock-widget-production.up.railway.app serves `/dist/*` (including the main `mon-unlock.js` and its hashed import chunks) with `Access-Control-Allow-Origin: *`. This allows any origin (localhost:* or production consumer sites) to load the ES module scripts cross-origin. No credentials are used, so `*` is safe and simple. If you need an allowlist later, set `EMBED_ALLOWED_ORIGINS` and replace the static server with origin-aware middleware.

### For each paid article

Copy `examples/embed.html` or use this block. **Only edit the parts in ALL CAPS:**

```html
<mon-unlock
  article-id="UNIQUE-ID-FOR-THIS-POST"
  title="Your headline"
  author="Your name"
  price="5"
  theme="light"
  unlock-contract="0x038446b1F736e254cC0E256B20D74823c41EeADB"
  walletconnect-project-id="c2a289e11ad2998f8ea4633db536334c"
>
  <div slot="teaser">
    Free preview text everyone can read…
  </div>
  <div slot="body">
    Full article text — only shown after unlock…
  </div>
</mon-unlock>
```

| Field | What to put |
|-------|-------------|
| `article-id` | Unique ID per post (e.g. `launch-day-2026`) |
| `title` | Headline |
| `author` | Your name or publication |
| `price` | MON price (e.g. `5` or `0.25`) |
| `unlock-contract` | Contract address on Monad mainnet (enables real MON payments) |
| `walletconnect-project-id` | WalletConnect Project ID (enables mobile readers via QR / app) |
| `slot="teaser"` | Free preview |
| `slot="body"` | Paid content |

Build the widget files:

```bash
npm run build
```

Output: `dist/mon-unlock.js` and `dist/mon-unlock.css`.

## Media cookbook (pictures + videos)

The body supports safe HTML for rich content. Common examples:

### Image

```html
<img src="https://picsum.photos/id/1016/800/600" alt="Describe the image" loading="lazy" />
```

### YouTube / Loom / Vimeo embed

```html
<iframe
  src="https://www.youtube.com/embed/VIDEO_ID"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowfullscreen
  loading="lazy"
></iframe>
```

### Self-hosted MP4

```html
<video controls preload="metadata" src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"></video>
```

### What is allowed

- Body HTML allows: text tags, links, images, video/audio tags, and iframe embeds.
- Iframes are allowlisted to trusted hosts (`youtube.com`, `youtu.be`, `player.vimeo.com`, `loom.com`).
- Unsafe tags/scripts/event handlers are stripped.

### Troubleshooting media

- Image not showing: confirm the URL is a *direct* link to the image binary (e.g. `https://i.postimg.cc/.../photo.jpg` or `https://picsum.photos/...`), not a web page like `postimg.cc/...` or an HTML gallery. The sanitizer keeps http/https but the browser can only decode real image responses.
- Video (self-hosted) not playing: must be a direct `.mp4`/`.webm` URL. YouTube/Vimeo share or watch URLs do not work in `<video src>` — use an `<iframe>` embed instead (or paste a YouTube link and the widget will auto-convert it to an embed).
- Iframe not showing: use an allowlisted host and embed URL format (not watch/share page URL).
- Works in generator preview but not production: deploy latest widget bundle and refresh cache.

## Behavior

- **Continue** (default) — opens hosted checkout on this CDN (`/unlock.html`): Apple Pay / Google Pay / card (Stripe) when configured, or Privy email/Google crypto checkout. No MetaMask required for readers.
- **Use MetaMask** — existing injected-wallet path (desktop extension or MetaMask in-app browser).
- Without `unlock-contract` the widget falls back to demo mode (localStorage only).
- **Publishers** can create an account with email or Google on `/account.html` (or the generator/dashboard sign-in row). That creates an embedded wallet for on-chain registration — MetaMask is optional. Fiat unlocks pay out via **Stripe Connect** (publisher onboards themselves; you do not manually send them money).

### Stripe fiat payouts (publishers)

1. Reader pays with card / Apple Pay / Google Pay → funds hit **your platform** Stripe account.
2. Server records `fiat_unlocks` and queues `payout_jobs`.
3. Publisher clicks **Set up Stripe payouts** on `/dashboard.html` or `/account.html` → Stripe Connect Express onboarding.
4. A cron (or ops) call to `POST /api/stripe/payouts/process` with `Authorization: Bearer $STRIPE_PAYOUT_CRON_SECRET` transfers pending jobs to the publisher’s Connect account.

Set `STRIPE_PAYOUT_CRON_SECRET` on Railway. Without Connect onboarding, jobs stay `pending` with `publisher_not_onboarded`.

### Privy checkout setup

1. Create an app at [dashboard.privy.io](https://dashboard.privy.io).
2. Allowlist `https://mon-unlock-widget-production.up.railway.app` (and `http://localhost:5173` for local `vite`).
3. Enable embedded wallets + funding for **MON** and **USDC** on Monad (chain id `143`).
4. In **Account Funding**, enable **Coinbase** (and optionally MoonPay). Checkout opens **Coinbase Onramp** via a server session token (required since mid-2025) — this is what works in Texas. Ramp remains as a fallback for other regions; MoonPay is unavailable in Texas.
5. Create a **Secret API Key** in [Coinbase Developer Platform](https://portal.cdp.coinbase.com) (API Keys → Secret API Keys). On Railway, set runtime env:
   - `CDP_API_KEY_ID` — Key ID (UUID)
   - `CDP_API_KEY_SECRET` — Key secret (Ed25519 or EC)
   These power `POST /api/coinbase/session-token` on the CDN. Never use `VITE_` for these.
6. (Optional) Set `VITE_RAMP_HOST_API_KEY` from [Ramp Network](https://docs.rampnetwork.com/web/quick-start-hosted) for partner branding / higher limits outside Texas.
7. Set Railway build arg / env `VITE_PRIVY_APP_ID` (and optionally `VITE_RAMP_HOST_API_KEY`) and redeploy (baked into `/unlock.html` at build time). Also set the CDP secrets above on the **runtime** service (not only build).

Requires `@privy-io/react-auth` **≥ 3.x** (Monad funding). Privy 2.x falls back to Receive-only for Monad.

**USDC without a new contract:** checkout can buy USDC, swap USDC→WMON on PancakeSwap V3, unwrap to MON, then call the existing `unlock()`. Existing articles keep working. A tiny MON balance is still needed for gas.

**Texas note:** Ramp does not work in Texas — leave Ramp configured; Coinbase is the path that must succeed. Mapping Project ID / Key ID / Secret in the Privy dashboard alone is not enough after Coinbase’s session-token requirement; the Railway `CDP_*` secrets + `/api/coinbase/session-token` are what open `pay.coinbase.com`.

See `.env.example`.

## Events (optional, for developers)

```javascript
document.querySelector("mon-unlock").addEventListener("mon:unlocked", (e) => {
  console.log("Reader unlocked:", e.detail);
});
```

## Roadmap

- Real MON payments on Monad
- Hosted dashboard to create articles without HTML

## Indexer (dashboard revenue)

Production indexes `ArticleRegistered` / `ArticleUnlocked` via the Supabase Edge Function `indexer`:

1. **Primary:** Supabase `pg_cron` every 2 minutes (`supabase/migrations/0005_schedule_indexer_cron.sql`)
2. **Fallback:** Railway cron service in `cron/` — set that service’s config path to **`/cron/railway.toml`** (not the root `railway.toml`, which forces Dockerfile builds)
3. **Manual:** Dashboard → **Run indexer now**

The Writer Dashboard reads `articles` + `unlocks` from Supabase after wallet connect.

## Embed signatures

Generator (and `/register.html` after agent publish) produce an `embed-sig` attribute. The widget and Stripe `create-intent` both reject missing or tampered signatures before payment. Old embeds without `embed-sig` must be regenerated.

## Current limitations & recommended next steps

### 1. Passive wallet detection only works after first explicit connect on that origin

The widget’s silent `eth_accounts` check only works after the reader has approved the site once on that origin. First visit still needs an explicit connect (or Continue checkout); later visits auto-detect.

### 2. Agent-published embeds need a signed `embed-sig`

`POST /api/agents/publish` returns HTML without `embed-sig` (agents cannot sign as the publisher wallet). Open `finishRegistrationUrl` (`/register.html`), register on Monad, approve the signature prompt, then use **Copy signed embed** and paste that full HTML on your site.

## License

MIT
