# Article NFTs (optional collectibles)

Unlock stays the access gate — **USDC / MON** is how readers pay to read. NFTs are souvenirs / provenance only. Holding one is never required to read, and token metadata never includes the paid body.

Two optional contracts can be enabled independently:

| Contract | Chain | Token | Who mints |
|----------|-------|--------|-----------|
| `ArticleNFT.sol` | Monad | ERC-1155 writer edition + reader receipt | Writer after publish; reader after a **crypto** unlock |
| `ArticleEditionNFT.sol` | Base | ERC-721 1/1 edition | Writer after publish |

The **minter’s wallet pays gas**. There is no server minting key. `RELAYER_PRIVATE_KEY` stays unlock-registration / gas-drip only.

`ARTICLE_NFT_CONTRACT` is the **Monad** ERC-1155 (already used in production). The Base 1/1 uses **`ARTICLE_EDITION_NFT_CONTRACT`** so the two addresses cannot collide.

---

# Article NFTs on Monad

Optional **writer editions** and **reader receipts**. One ERC-1155 on **Monad**.

## What mints

| Path | Who | Token | Auth on-chain |
|------|-----|--------|----------------|
| Writer edition | Publisher after publish (Write or Dashboard) | 1/1 or small edition (max 25) they own | `getArticle` publisher on ArticleUnlock / ArticleUnlockUsdc |
| Reader receipt | Unlocker after a **crypto** unlock | One receipt per wallet per article | `hasUnlocked` on either unlock contract |

Apple Pay / card unlocks still grant access. The UI skips the receipt mint and explains that receipts need a wallet unlock.

## Env

| Variable | Where | Purpose |
|----------|--------|---------|
| `ARTICLE_NFT_CONTRACT` | Railway server | ERC-1155 address. Empty = mint UI hidden. |
| `VITE_ARTICLE_NFT_CONTRACT` | optional browser build | Same address if you rebuild the widget without relying on `/api/article-nfts/config`. |
| `MONAD_RPC_URL` | server | Defaults to `https://rpc.monad.xyz` (chain id **143**), same as the USDC relayer. |

Mint auth is **user-wallet signed**: `mintEdition` / `mintReceipt` from the connected wallet. Do **not** add a hot server key as the only mint path.

After mint, the app records `tokenId ↔ articleSlug ↔ role` in Postgres (`article_nfts`). Apply `supabase/migrations/0011_article_nfts.sql`.

## Deploy (Foundry)

Install Foundry, then from `contracts/`:

```bash
forge install foundry-rs/forge-std --no-commit
forge test
```

CI runs `forge test` only (local / Anvil). It does **not** mint on Monad mainnet.

### Testnet (optional, docs / CI dry-run)

Match the existing MON testnet unlock if you want a sandbox:

```bash
cd contracts
export PRIVATE_KEY=...          # deployer; becomes owner (setBaseURI only)
export UNLOCK_MON=0x1E03AE1C88B26C0bcbdE57e26e97fdaFb61A356D
export UNLOCK_USDC=0x...        # if you have a testnet USDC unlock
export NFT_BASE_URI=https://your-host/api/article-nfts/metadata/
export MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz

forge script script/DeployArticleNft.s.sol \
  --rpc-url monad_testnet \
  --broadcast \
  -vvvv
```

Copy the address into `deployments/monad-testnet-article-nft.json`.

### Mainnet (production)

USDC unlocks already use Monad **mainnet** (chain id 143, RPC `MONAD_RPC_URL` / `https://rpc.monad.xyz`).

```bash
cd contracts
export PRIVATE_KEY=...
export MONAD_RPC_URL=https://rpc.monad.xyz
# defaults: mainnet ArticleUnlock + ArticleUnlockUsdc
export NFT_BASE_URI=https://mon-unlock-widget-production.up.railway.app/api/article-nfts/metadata/

forge script script/DeployArticleNft.s.sol \
  --rpc-url monad_mainnet \
  --broadcast \
  -vvvv
```

Live: [`0xFe467952918F744606e70876b2af0C083D269f92`](https://monadvision.com/address/0xFe467952918F744606e70876b2af0C083D269f92) (see `deployments/monad-mainnet-article-nft.json`).

Then:

1. Set Railway `ARTICLE_NFT_CONTRACT=0xFe467952918F744606e70876b2af0C083D269f92` (and optional `VITE_ARTICLE_NFT_CONTRACT` if you rebuild the widget).
2. Apply the Supabase migration `0011_article_nfts.sql`.
3. Confirm `GET /api/article-nfts/config` returns `"configured": true`.

Owner can later `setBaseURI` / `setUnlockContracts` if the metadata host or unlock addresses change. No minting key lives on the server.

## tokenURI

`GET /api/article-nfts/metadata/{tokenId}`:

- `name`, `description` (title + **teaser** only)
- `external_url` — hosted article `/articles/{slug}`
- `image` — existing OG card `/og/{slug}.jpg`
- attributes: `role=edition|receipt`, `articleSlug`, optional `price`

Paid body is never selected from the database and is stripped if a caller tries to pass it.

## Product surfaces

- **Write** — after a successful publish, optional “Mint edition on Monad” (skipped when the contract env is empty; then Write still jumps to the article unless the Base edition is configured).
- **Dashboard → Listing** — same writer mint when a wallet is connected.
- **Article widget / crypto checkout** — optional “Mint receipt” after an on-chain unlock.
- Card / Apple Pay — copy that receipts need a crypto unlock; reading is unchanged.

---

# Article edition NFT on Base

A writer-optional **1/1 ERC-721** on **Base** after publish — a second collectible, not a second paywall. Independent of the Monad ERC-1155.

## What it is

| Piece | Role |
|-------|------|
| Unlock contract (Monad) | Price + `hasUnlocked` — **required to read paid body** |
| `ArticleEditionNFT` (Base) | Optional 1/1 ERC-721 the **author** mints after publish |
| `/api/nft/{tokenId}` | `tokenURI` JSON: title, teaser, article URL, OG image |
| Hosted article page | Shows **Collectible minted** + token link **only if** a row exists |

The writer mints from **/write** (wallet already connected). The platform does **not** mint from a Railway private key.

## Contract

```bash
cd contracts
forge install foundry-rs/forge-std --no-commit   # first time
forge test --match-contract ArticleEditionNFTTest
```

`mint(bytes32 articleId)` — `articleId = keccak256(bytes(slug))`, same encoding as the unlock widget. One token per article. Token goes to `msg.sender`. `tokenURI` is `baseURI + tokenId` (e.g. `https://your-host/api/nft/1`).

### Testnet vs mainnet

| Network | Chain ID | RPC | Explorer | Deployments file |
|---------|----------|-----|----------|------------------|
| Base Sepolia | `84532` | `https://sepolia.base.org` | [sepolia.basescan.org](https://sepolia.basescan.org) | `contracts/deployments/base-sepolia.json` |
| Base | `8453` | `https://mainnet.base.org` | [basescan.org](https://basescan.org) | `contracts/deployments/base.json` |

**CI never broadcasts.** Do not put a funded mainnet key in GitHub Actions.

### Deploy (you run this once)

Deployer key is **only** for `forge script`. It is not a Railway runtime secret. The writer pays Base gas to mint.

```bash
cd contracts
# Base Sepolia
export PRIVATE_KEY=your_deployer_key_without_or_with_0x
export ARTICLE_EDITION_NFT_BASE_URI=https://mon-unlock-widget-production.up.railway.app/api/nft/
forge script script/DeployArticleEditionNft.s.sol \
  --rpc-url https://sepolia.base.org \
  --broadcast -vvvv
```

Base mainnet: same script with `--rpc-url https://mainnet.base.org` (or `$BASE_RPC_URL`).

Copy the printed address into `contracts/deployments/base-sepolia.json` or `base.json`, then set Railway env below.

Gas on Base is typically a fraction of a cent. The writer needs a little **ETH on Base** (not MON). Unlock stays on Monad.

## Railway env (after deploy)

Set on the production service — **no private key**. Do **not** reuse `ARTICLE_NFT_CONTRACT` (that is the Monad ERC-1155).

```env
# Required to show "Mint edition NFT" on /write (Base 1/1)
ARTICLE_EDITION_NFT_CONTRACT=0xYourDeployedAddress

# 8453 Base (default) or 84532 Base Sepolia
ARTICLE_EDITION_NFT_CHAIN_ID=8453

# Optional public RPC for the Write page to wait on the mint tx
# ARTICLE_EDITION_NFT_RPC_URL=https://mainnet.base.org

# Used at deploy time (contract constructor). Change later with setBaseURI as owner.
# ARTICLE_EDITION_NFT_BASE_URI=https://mon-unlock-widget-production.up.railway.app/api/nft/
```

Also apply the mapping migration (token id ↔ article slug):

```bash
# supabase/migrations/0012_article_edition_nft.sql
# Adds nft_token_id, nft_contract, nft_chain_id, nft_tx_hash, nft_owner, nft_minted_at
# and GRANTs those columns to anon (body stays revoked).
```

Until `ARTICLE_EDITION_NFT_CONTRACT` is set, the Base mint UI is hidden. If the Monad contract is also unset, Publish still redirects to the article as today. Read path is unchanged.

## Metadata (`tokenURI`)

`GET /api/nft/{tokenId}` returns OpenSea-style JSON:

- `name` — article title
- `description` — teaser (plain text)
- `external_url` — `https://host/articles/{slug}`
- `image` — generated OG card `/og/{slug}.jpg`
- attributes: price, `1/1`, and an Access trait that the NFT is **not** required to read

`GET /api/nft/health` is public config for the Write page (contract, chain, RPC). `GET /api/articles/{slug}/nft` returns minted flag + the same metadata.

`POST /api/articles/{slug}/nft` stores the mapping after the author mints. The body must include the article **publisher** wallet. No chain tx is sent from the server.

## Out of scope

- Replacing USDC unlock with NFT-gated access
- Marketplace / royalties UI
- Cross-chain bridges
- Generative art
- Voice drafts / MiroShark / autopost
