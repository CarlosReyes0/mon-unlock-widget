# ArticleUnlock — MON paywall contract

Native **MON** unlock on **Monad testnet**. Matches [FOCUS.md](../FOCUS.md) Phase 1.1.

## Contract

| Function | Purpose |
|----------|---------|
| `registerArticle(articleId, priceWei)` | Publisher registers their article (reverts `ArticleTaken` if another publisher owns the id) |
| `registerArticleFor(...)` | Relayer only — registers on behalf of a publisher (same `ArticleTaken` guard). The server's only write. |
| `unlock(articleId)` payable | Reader pays MON → publisher receives MON |
| `hasUnlocked(reader, articleId)` | Cross-device unlock check (Phase 1.3) |
| `articleIdFromString(slug)` | Must match widget `article-id` attribute |

**Article ID encoding:** `bytes32 = keccak256(bytes("founder-manifesto"))`  
Widget (viem): `keccak256(toBytes("founder-manifesto"))`

**Uniqueness:** Article ids are **global**. `registerArticle` / `registerArticleFor` revert with `ArticleTaken(publisher)` if another address already owns the id. Same publisher may re-register to update price. Product DB also reserves the slug via Supabase `register-article` before the chain tx.

**Roles:** `owner` is a cold wallet (two-step `transferOwnership` / `acceptOwnership`). `relayer` is the hot wallet, set with `setRelayer`. The relayer may call `registerArticleFor` only. `updatePrice` is the publisher or the owner — the server never sends it, so the relayer cannot. `setActive` is the publisher, or the owner for an emergency pause. Reader calls (`unlock`, `hasUnlocked`, `getArticle`) are unchanged.

**Writer gas:** `/write` and the generator call `POST /api/relay/register`. The server verifies the writer’s embed signature, checks the slug is reserved to them, then the contract **relayer** submits `registerArticleFor`. Payments still go to the writer. Set `RELAYER_PRIVATE_KEY` to the relayer wallet and fund it with MON. On the previous contracts, which have no `relayer()`, set `UNLOCK_LEGACY_OWNER_RELAYER=1` so the server still accepts the owner key. Without the key, writers pay gas themselves. Cutover steps: [docs/cutover-unlock-contracts.md](../docs/cutover-unlock-contracts.md).

> Deploy note: the live mainnet contract must be **redeployed** for `ArticleTaken` to enforce on-chain. Until then, generator/register clients + Supabase reservation still block takeovers in the product path.

## Setup

Install [Foundry](https://book.getfoundry.sh/getting-started/installation):

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Install deps and test:

```bash
cd contracts
forge install foundry-rs/forge-std --no-commit
forge test
```

## Deploy

Deploy both unlock contracts with a cold owner and a separate relayer. `OWNER_ADDRESS` and `RELAYER_ADDRESS` are addresses, not keys. The deployer key is `DEPLOYER_PRIVATE_KEY` or `PRIVATE_KEY` in the environment, or an interactive signer (`forge script --account` / `--interactives`). Do not commit the key. CI does not broadcast.

```bash
cd contracts
export OWNER_ADDRESS=0xYourColdWallet
export RELAYER_ADDRESS=0xYourRelayer
# optional: export USDC_TOKEN=0x754704Bc059F8C67012fEd69BC8A327a5aafb603
forge script script/DeployUnlock.s.sol --rpc-url monad_mainnet --broadcast -vv
```

The constructor sets `owner` and `relayer`. To rotate the relayer later, the owner broadcasts `script/SetRelayer.s.sol` (`UNLOCK_MON`, `UNLOCK_USDC`, `RELAYER_ADDRESS`).

`script/Deploy.s.sol` and `script/DeployUsdc.s.sol` deploy one contract with the same env.

## Verify unlock (cast)

```bash
# Article id for "founder-manifesto"
ARTICLE_ID=$(cast keccak "founder-manifesto")

cast send $CONTRACT "unlock(bytes32)" $ARTICLE_ID \
  --value 5ether \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key $READER_PRIVATE_KEY

cast call $CONTRACT "hasUnlocked(address,bytes32)(bool)" $READER $ARTICLE_ID \
  --rpc-url https://testnet-rpc.monad.xyz
```

## ABI for widget (Phase 1.2)

After `forge build`, ABI is at:

```
contracts/out/ArticleUnlock.sol/ArticleUnlock.json
```

Copy to `src/abi/ArticleUnlock.json` when wiring the widget.

## Events

```solidity
event ArticleUnlocked(
    address indexed reader,
    bytes32 indexed articleId,
    uint256 amount,
    address indexed publisher
);
```

Use explorer link + this event for “Paid X MON” proof in the UI.

## USDC unlock (ArticleUnlockUsdc)

Path A: keep the native MON `ArticleUnlock` live for existing embeds. Deploy `ArticleUnlockUsdc` for new USD-priced articles.

Use `script/DeployUnlock.s.sol` (see Deploy above). `USDC_TOKEN` defaults to Circle USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`.

Mainnet deploy: `0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f` (wired as the app/indexer default).
Override with `VITE_USDC_UNLOCK_CONTRACT` / `USDC_CONTRACT_ADDRESS` for forks.
Publishers receive USDC; readers only need a tiny MON balance for gas.

## Article NFTs (optional)

Writer editions and reader receipts share one ERC-1155: `ArticleNFT.sol`. Unlock is still access. Deploy with `script/DeployArticleNft.s.sol`, then set `ARTICLE_NFT_CONTRACT`. Full steps: [ARTICLE_NFT.md](../ARTICLE_NFT.md).
