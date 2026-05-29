# MON unlock widget

Embeddable paywall for **non-technical publishers**. Paste HTML on WordPress, Webflow, Notion export, or any site — **no JavaScript required**.

Readers connect a wallet and unlock the full article with **MON** (demo simulates payment until the token is live).

## Try the demo locally

```bash
npm install
npm run dev
```

Open the URL shown in the terminal.

## Embed on your site (copy & paste)

### Once per website

Upload `dist/mon-unlock.js` and `dist/mon-unlock.css` to your host (or CDN). Then add to every page header:

```html
<link rel="stylesheet" href="https://YOUR-SITE.com/mon-unlock.css" />
<script type="module" src="https://YOUR-SITE.com/mon-unlock.js"></script>
```

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
| `slot="teaser"` | Free preview |
| `slot="body"` | Paid content |

Build the widget files:

```bash
npm run build
```

Output: `dist/mon-unlock.js` and `dist/mon-unlock.css`.

## Demo behavior

- **Connect wallet to unlock** — payment is simulated (no MON transferred yet).
- No MetaMask in dev? Still works with a demo wallet.

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
