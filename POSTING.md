# Posting

Go to **/write**. Title, the piece, **Publish**. Then it’s live on `/articles/…`.

Paste a public photo, audio, or video URL (or **Add image, audio, or video**) — Write turns it into HTML. Media above the fold is free; everything below stays paid until unlock.

Optional **Preview how this might land** (MiroShark sim, ~$1 USDC on Base) sits under the draft. It never gates Publish. Needs `BASE_BUILDER_CODE` on Railway — see [docs/MIROSHARK.md](docs/MIROSHARK.md).

Share that URL on X or iMessage: the page ships Open Graph / Twitter Card tags so the preview shows the title, teaser, and a photo. Articles do not have a cover-image field yet, so every post uses the default Open Paywall card (`/assets/og-default.jpg`) until that lands.

Price is $0.50. The start of the piece is free; the rest is paid. Embed HTML is optional after, from the generator.

Optional on the same page: **Draft posts in your voice** (paste samples → 2–3 editable cards). Copy or use as a reply seed. **Nothing posts from /write.** See [VOICE_DRAFTS.md](./VOICE_DRAFTS.md). Autopost is future / gated, not this flow.

After Publish, if `ARTICLE_NFT_CONTRACT` is set, **Mint edition on Monad** is offered. If `ARTICLE_EDITION_NFT_CONTRACT` is set, **Mint edition NFT** (1/1 on Base) is offered. Neither is required to read. See [ARTICLE_NFT.md](./ARTICLE_NFT.md).

Articles are still registered on Monad (so readers can pay on-chain). You only **sign** — the platform pays gas when `RELAYER_PRIVATE_KEY` is set. If the relayer is off, Publish falls back to a wallet transaction.

<video src="docs/posting/posting_flow.mp4" controls playsinline></video>

## New post

<img alt="Blank Write page: Title, Write or paste, Publish" src="docs/posting/posting-new-post-desktop.png" />

## Writing

<img alt="Draft of July rain walk with Publish and a free/paid break" src="docs/posting/posting-draft-desktop.png" />

## After Publish

<img alt="Live article with Continue at $0.50" src="docs/posting/posting-live-article.png" />

## Phone

<img alt="Mobile Write page" src="docs/posting/posting-new-post-mobile.png" />
