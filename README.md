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
<img src="https://example.com/photo.jpg" alt="Describe the image" loading="lazy" />
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
<video controls preload="metadata" src="https://example.com/video.mp4"></video>
```

### What is allowed

- Body HTML allows: text tags, links, images, video/audio tags, and iframe embeds.
- Iframes are allowlisted to trusted hosts (`youtube.com`, `youtu.be`, `player.vimeo.com`, `loom.com`).
- Unsafe tags/scripts/event handlers are stripped.

### Troubleshooting media

- Image not showing: confirm the URL is public (not private/auth-protected).
- Iframe not showing: use an allowlisted host and embed URL format (not watch/share page URL).
- Works in generator preview but not production: deploy latest widget bundle and refresh cache.

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

## Current limitations & recommended next steps

This section captures the main gaps that were identified during the latest round of testing (as of 2026-06-17). Each item is described first in technical detail, then restated simply, followed by the concrete recommended action.

### 1. Passive wallet detection only works after first explicit connect on that origin

**Technical explanation**  
The widget performs a silent `eth_accounts` call in `attemptSilentOnchainCheck()` (see `src/widget/mon-unlock.ts:158`) to discover an already-authorized account without triggering a MetaMask popup. This only returns a non-empty list once the user has previously called `eth_requestAccounts` and approved the site on that specific origin. Consequently, the very first visit to a new domain (localhost, a fresh production deployment, etc.) will still show the "Connect wallet to unlock" button even if the article was already paid for on-chain with the same wallet on another domain. Subsequent visits to the same origin will auto-detect the account and run `hasUnlocked` immediately.

**Simple version**  
You still have to click "Connect wallet to unlock" the first time you visit the page from a new browser / new domain. After that one click, the unlock appears automatically everywhere else.

**Recommended next step**  
No code change required for correctness. If a smoother UX is desired, we can surface a non-blocking "Check unlock status" button instead of the full payment CTA on first visit. Document the current behaviour so publishers understand the one-time connect requirement.

### 2. Writer Dashboard shows only locally-registered articles; real payments are invisible

**Technical explanation**  
`dashboard.html` stores registered articles exclusively in `localStorage` under the key `mon-unlock-writer-articles:<lowercase-wallet>`. It never calls `getArticle`, never subscribes to `ArticleUnlocked` events, and never reads `hasUnlocked` for any articleId. Therefore an article registered via the generator (or via any other means) will not appear in the dashboard for wallet `0x5594d76928c4974AE77387882Cf9099c375e307b` even when readers have successfully paid MON on-chain. Revenue and unlock counts remain at zero until the dashboard is augmented with on-chain reads.

**Simple version**  
Right now the Writer Dashboard only shows articles you registered in that same browser tab. Payments that actually happened on-chain do not show up.

**Recommended next step**  
Add a "Load from chain" button (or automatic fetch on connect) that calls `getArticle` + optionally indexes past `ArticleUnlocked` events for the connected publisher. This will make the dashboard reflect real usage for wallets such as `0x5594…307b`.

### 3. Embed tampering / payment redirection risk

**Technical explanation**  
The `<mon-unlock>` element accepts an arbitrary `unlock-contract` attribute. The on-chain `unlock(bytes32)` function in `ArticleUnlock.sol` forwards `msg.value` to whatever address is stored in `articles[articleId].publisher` at registration time. An attacker can copy a legitimate embed snippet, change only the `unlock-contract` value (or the `article-id`), register the same slug under their own address on the same or a different contract, and host the modified snippet. Readers using the tampered embed will send MON to the attacker instead of the original publisher. There is currently no cryptographic binding between the published embed HTML and the registered `(articleId, publisher)` tuple.

**Simple version**  
Anyone can take your embed code, swap the contract address, and steal the payments. The system trusts whatever HTML the publisher pastes.

**Recommended next step**  
Short-term: add a clear warning in the generator output and in this README.  
Medium-term: have the generator produce a signed claim (articleId + contract + publisher signature) that the widget can verify before accepting a payment, or host a lightweight verification endpoint. This is the main remaining trust issue before a public launch.

## License

MIT
