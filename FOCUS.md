# FOCUS — what we build and what we ignore

**Product:** Embeddable `<mon-unlock>` paywall. Readers pay **MON** on **Monad testnet** to read the full article.

**Current state:** MVP works — HTML paste, wallet connect, **simulated** unlock (localStorage).

**Rule:** Do not start Phase 2 until Phase 1 exit criteria are checked off.

---

## Out of scope (do not work on)

- IPFS, Filecoin, decentralized storage, CIDs
- Custom tokens, **USDC**, or other payment assets for v1 — **MON only**
- NFT passes, complex tokenomics
- WordPress / Webflow plugins before Phase 2
- Publisher dashboard / CMS before Phase 1 is done
- Mobile apps

---

## Phase 1 — Real pay → read onchain

**Goal:** A reader pays MON on Monad testnet, gets the article, and anyone can verify the payment onchain. Same HTML embed for publishers.

### 1.1 Unlock contract (Monad testnet)

- [x] Solidity contract: `unlock(bytes32 articleId)` **payable** — reader sends **MON** via `msg.value`
- [x] Require `msg.value >= price[articleId]` (price in wei); refund overpay optional for MVP
- [x] Emit `ArticleUnlocked(address reader, bytes32 articleId, uint256 amount, address publisher)`
- [x] Forward MON to publisher address (or treasury + split later)
- [x] `hasUnlocked(reader, articleId)` view for Phase 1.3
- [x] Deploy to Monad testnet; document contract address in repo

**Done when:** You can call `unlock` from cast/wallet and see the event on explorer.

### 1.2 Widget → contract

- [ ] Add viem; connect to Monad testnet RPC
- [ ] Widget reads `unlock-contract` + `price` (and optional `publisher` address) from HTML attributes
- [ ] Replace demo unlock with: connect wallet → send tx → wait for confirmation
- [ ] On success: show full article + **“Paid X MON”** + link to tx on explorer
- [ ] On reject/fail: clear error message, keep teaser visible

**Done when:** End-to-end on testnet without localStorage fake unlock.

### 1.3 Verify unlock (cross-device)

- [ ] Contract view: `hasUnlocked(address reader, bytes32 articleId) → bool` (or mapping + events indexer)
- [ ] On load: if wallet connected, call `hasUnlocked` — show body without paying again
- [ ] Remove reliance on localStorage as source of truth (cache OK, chain is authority)

**Done when:** Pay on laptop, connect same wallet on phone → article already unlocked.

### 1.4 Ship testnet demo

- [x] Host `mon-unlock.js` + `.css` on stable URL (CDN)
- [ ] One public demo page with real testnet MON instructions (faucet link)
- [ ] Update `examples/embed.html` with real contract URL + testnet attrs

**Phase 1 exit criteria (all required):**

1. Real MON tx on Monad testnet unlocks an article in the widget  
2. UI shows amount paid + explorer link  
3. Same wallet unlocked on a second browser/device without paying again  
4. Publisher embed HTML unchanged except contract address / network attrs  

---

## Phase 2 — Non-technical publishers (after Phase 1)

**Goal:** They never touch HTML if they don’t want to. Wedge stays **paste one block**; tools generate that block.

**Do not start until Phase 1 exit criteria are met.**

### 2.1 Hosted embed generator

- [ ] Simple web form: title, author, teaser, body, price (MON), article-id
- [ ] Output: copy-paste `<mon-unlock …>` block + site-wide script tags
- [ ] Pre-fill `unlock-contract` and network from our config
- [ ] No account required for v1 (optional: save drafts in localStorage)

**Done when:** Non-dev can create an embed block in under 2 minutes.

### 2.2 Optional CMS / API

- [ ] POST article metadata + body to API; returns `article-id`
- [ ] Embed mode: `source="api"` + `article-id` only (no body in HTML)
- [ ] API returns teaser always; body only if `hasUnlocked(wallet)` onchain **or** after tx proof

**Done when:** Edit article in admin; embed snippet stays a single line.

### 2.3 Distribution plugins (only if demand)

- [ ] WordPress shortcode / block → generates same `<mon-unlock>` markup
- [ ] Webflow embed code export

**Phase 2 exit criteria:**

1. Embed generator used by at least one external publisher (not you)  
2. Same onchain unlock flow as Phase 1 — no second payment stack  

---

## What to build next (single task)

If unsure what to do today, pick **one**:

| Priority | Task |
|----------|------|
| **Now** | 1.1 — Deploy `ArticleUnlock` to Monad testnet (see `contracts/README.md`) |
| Then | 1.2 — Wire widget to send tx and show explorer link |
| Then | 1.3 — `hasUnlocked` on page load |
| Then | 1.4 — CDN + public testnet demo |
| Later | Phase 2 embed generator |

---

## Repo map (Phase 1 touchpoints)

```
contracts/          ← 1.1 Unlock.sol (create)
src/core/wallet.ts  ← 1.2 viem + Monad testnet
src/core/unlock.ts  ← 1.2 onchain tx; 1.3 hasUnlocked
src/widget/mon-unlock.ts ← 1.2 UI: Paid X MON, tx link
examples/embed.html ← 1.4 publisher template
```

---

## Decisions locked in

| Decision | Choice |
|----------|--------|
| Payment asset | **Native MON only** (payable `unlock`; `msg.value` in wei) |
| Not using | USDC, custom READ token, or multi-token support in v1 |
| Chain | **Monad testnet** first |
| Publisher UX v1 | HTML paste (`<mon-unlock>`) |
| Source of unlock truth | **Onchain**, not localStorage |
| Storage | Your HTML / API / CMS — **not** IPFS |

**Why MON (not USDC):** Ecosystem alignment with Monad; single asset for payment + gas; simpler Phase 1 contract. Revisit USDC only if publishers demand dollar-stable pricing after testnet validation.

---

*Update checkboxes as tasks ship. If a task isn’t in Phase 1 or 2 above, don’t build it.*
