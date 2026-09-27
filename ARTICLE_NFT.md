# Article NFTs on Monad

Optional **writer editions** and **reader receipts** for Open Paywall. One ERC-1155 contract on **Monad**. Unlock stays the access gate — holding an NFT is never required to read, and token metadata never includes the paid body.

Both mint paths share `ArticleNFT.sol`. The **minter’s wallet pays gas**. There is no server minting key.

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

Mint auth is **user-wallet signed**: `mintEdition` / `mintReceipt` from the connected wallet. Do **not** add a hot server key as the only mint path. `RELAYER_PRIVATE_KEY` stays unlock-registration / gas-drip only. A later gas relayer could call the same functions on behalf of users; it is not required to ship this.

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
export NFT_BASE_URI=https://openpaywall.app/api/article-nfts/metadata/

forge script script/DeployArticleNft.s.sol \
  --rpc-url monad_mainnet \
  --broadcast \
  -vvvv
```

Live: [`0xFe467952918F744606e70876b2af0C083D269f92`](https://monadvision.com/address/0xFe467952918F744606e70876b2af0C083D269f92) (see `deployments/monad-mainnet-article-nft.json`). If `baseURI()` still uses the old Railway host, the owner calls `setBaseURI("https://openpaywall.app/api/article-nfts/metadata/")`. This repo does not send that transaction.

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

- **Write** — after a successful publish, optional “Mint edition on Monad” (skipped when the contract env is empty; then Write still jumps to the article).
- **Dashboard → Listing** — same writer mint when a wallet is connected.
- **Article widget / crypto checkout** — optional “Mint receipt” after an on-chain unlock.
- Card / Apple Pay — copy that receipts need a crypto unlock; reading is unchanged.
