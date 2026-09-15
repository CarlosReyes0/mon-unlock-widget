# Posting — keep it as simple as Substack

Product note only. No implementation in this change.

Open Paywall already hosts articles (`/` feed, `/articles/{slug}`). Posting still behaves like a developer form that outputs HTML. That is the gap.

**Rule:** A writer who is signed in writes a title and a piece, hits **Publish**, and the post is live. Everything else is a default or a later setting.

---

## How people actually post on Substack

They do not fill a CMS.

1. **New post** — one blank page.
2. **Title** (big). Optional subtitle. Then they type or paste the essay.
3. It **autosaves** as a draft. They can leave and come back.
4. The paywall is a **break in the same document** (“this far is free”). Not a Teaser field and a Body field.
5. **Publish** (or Continue → who gets it → Send). The post is on their site at an auto slug. Email is extra, not the writing surface.

What they never see while writing: slugs, HTML, scripts, wallets, contracts, signatures, price rails, “copy this block.” Author name and publication already exist from the account. Price lives on the publication (subscription), not on every post.

**Notes** is even thinner: type, post. Same lesson — the button is Post, not Generate.

---

## What we ask today

`/generator.html` is labeled **Create embed**. The primary button is **Copy full embed block**.

Before anything is live, a writer is asked for: title, author, USDC vs MON, price, article id, list-on-feed, external URL, teaser, body, media-as-HTML, account/wallet, then copy code, then often register + sign.

That is how you ship a widget. It is not how a person posts.

Hosted pages and the public feed already exist. The embed can stay as an optional “put this on my own site” after publish. It should not be the posting flow.

---

## The posting surface

Signed in (email / Google — already on Account). One screen:

```
                    [Publish]

Title

Write, or paste…
```

On **Publish**:

| Hidden job | Default |
|---|---|
| Author | Account |
| Slug | From title; suffix if taken. Writer never types an article id |
| Price | **$0.50 USDC** |
| List on Open Paywall | **Yes** |
| Teaser | First stretch of the piece (or above a `---` / paywall break if they used one) |
| Body | The rest |
| Live URL | `/articles/{slug}` — land there after publish |
| On-chain register + `embed-sig` | Done with the signed-in embedded wallet, or the server. Not a writer step |

**Not on this screen:** payment asset, article id, listing checkbox, external URL, generated HTML, live preview pane, media cookbook.

After it is live, show the post. Optional next: copy embed, change price, unlist, add your-site URL. Dashboard / Account already cover payouts and identity.

Drafts: autosave. Publish is what makes it public. Matches the existing “Draft → Publish” item in `PRODUCT_OPTIONS.md`.

---

## Paywall as a fold, not two boxes

Substack: one essay, a divider, free above / paid below.

We should treat **one document** the same way.

- Default: first couple of paragraphs are the preview; the rest is paid. Good enough for paste-from-Notes / paste-from-email.
- If they type `---` (or later, an “Insert paywall” control), that is the fold.
- Do not make Teaser and Body two required form fields. Writers do not think in slots.

Chat/agent paste in `agents.md` already accepts messy input. The human web flow should be at least that casual: dump the piece, publish.

---

## Copy from Substack / leave behind

**Copy**

- Writing is the product. Publish is one word.
- Identity is settled before you write.
- Slug, hosting, and distribution are automatic.
- Advanced stuff lives after publish, or in Account.

**Do not copy**

- Email-everyone as the main event (our wedge is pay-per-article + a public feed).
- Subscription as the only way to unlock (keep $0.50 a la carte as the default).
- Notes/social, publication design, SEO panels, scheduling — later, if ever.

Embed-for-WordPress remains a power path. It is not how posting starts.

---

## Done when

A signed-in writer can go from a blank page to a live `/articles/…` URL without choosing a slug, an asset, a listing flag, or copying HTML.

If the next mock still needs “Create embed” as the main writer action, it is not this product.
