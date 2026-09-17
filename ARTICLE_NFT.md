# Article edition NFT (optional collectible)

Open Paywall’s access gate stays **USDC / MON unlock**. This is a writer-optional **1/1 edition NFT** on **Base** after publish — a receipt / provenance collectible, not a second paywall. Readers can still unlock and read with no NFT.

## What it is

| Piece | Role |
|-------|------|
| Unlock contract (Monad) | Price + `hasUnlocked` — **required to read paid body** |
| `ArticleEditionNFT` (Base) | Optional 1/1 ERC-721 the **author** mints after publish |
| `/api/nft/{tokenId}` | `tokenURI` JSON: title, teaser, article URL, OG image |
| Hosted article page | Shows **Collectible minted** + token link **only if** a row exists |

The writer mints from **/write** (wallet already connected). The platform does **not** mint from a Railway private key.

## Contract

Foundry, same `contracts/` tree as `ArticleUnlock`.

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
export ARTICLE_NFT_BASE_URI=https://mon-unlock-widget-production.up.railway.app/api/nft/
forge script script/DeployArticleNft.s.sol \
  --rpc-url https://sepolia.base.org \
  --broadcast -vvvv
```

Base mainnet: same script with `--rpc-url https://mainnet.base.org` (or `$BASE_RPC_URL`).

Copy the printed address into `contracts/deployments/base-sepolia.json` or `base.json`, then set Railway env below.

Gas on Base is typically a fraction of a cent. The writer needs a little **ETH on Base** (not MON). Unlock stays on Monad.

## Railway env (after deploy)

Set on the production service — **no private key**:

```env
# Required to show "Mint edition NFT" on /write
ARTICLE_NFT_CONTRACT=0xYourDeployedAddress

# 8453 Base (default) or 84532 Base Sepolia
ARTICLE_NFT_CHAIN_ID=8453

# Optional public RPC for the Write page to wait on the mint tx
# ARTICLE_NFT_RPC_URL=https://mainnet.base.org

# Used at deploy time (contract constructor). Change later with setBaseURI as owner.
# ARTICLE_NFT_BASE_URI=https://mon-unlock-widget-production.up.railway.app/api/nft/
```

Also apply the mapping migration (token id ↔ article slug):

```bash
# supabase/migrations/0011_article_edition_nft.sql
# Adds nft_token_id, nft_contract, nft_chain_id, nft_tx_hash, nft_owner, nft_minted_at
# and GRANTs those columns to anon (body stays revoked).
```

Until `ARTICLE_NFT_CONTRACT` is set, Publish still redirects to the article as today. Mint UI is hidden. Read path is unchanged.

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
