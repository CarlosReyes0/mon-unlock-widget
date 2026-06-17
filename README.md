# MON unlock widget

Embeddable paywall for **non-technical publishers**. Paste HTML on WordPress, Webflow, Notion export, or any site — **no JavaScript required**.

Readers connect a wallet and unlock the full article with **MON** on Monad testnet.

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
- `/demo.html` – Full interactive testnet demo (real MON payments)
- `/embed-example.html` – Clean copy-paste embed reference

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
| `unlock-contract` | Contract address on Monad testnet (enables real payments) |
| `slot="teaser"` | Free preview |
| `slot="body"` | Paid content |

Build the widget files:

```bash
npm run build
```

Output: `dist/mon-unlock.js` and `dist/mon-unlock.css`.

## Behavior

- **Connect wallet to unlock** — real MON payment on Monad testnet when `unlock-contract` is provided.
- Without `unlock-contract` the widget falls back to demo mode (localStorage only).
- No MetaMask in dev? Falls back to a demo wallet for local testing.

## Events (optional, for developers)

```javascript
document.querySelector("mon-unlock").addEventListener("mon:unlocked", (e) => {
  console.log("Reader unlocked:", e.detail);
});
```

## Roadmap

- Real MON payments on Monad
- Hosted dashboard to create articles without HTML

## License

MIT
