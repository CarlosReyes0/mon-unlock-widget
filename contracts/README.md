# ArticleUnlock — MON paywall contract

Native **MON** unlock on **Monad testnet**. Matches [FOCUS.md](../FOCUS.md) Phase 1.1.

## Contract

| Function | Purpose |
|----------|---------|
| `registerArticle(articleId, priceWei)` | Publisher registers their article (reverts `ArticleTaken` if another publisher owns the id) |
| `registerArticleFor(...)` | Owner bootstrap **and gas relayer** — registers on behalf of a publisher (same `ArticleTaken` guard) |
| `unlock(articleId)` payable | Reader pays MON → publisher receives MON |
| `hasUnlocked(reader, articleId)` | Cross-device unlock check (Phase 1.3) |
| `articleIdFromString(slug)` | Must match widget `article-id` attribute |

**Article ID encoding:** `bytes32 = keccak256(bytes("founder-manifesto"))`  
Widget (viem): `keccak256(toBytes("founder-manifesto"))`

**Uniqueness:** Article ids are **global**. `registerArticle` / `registerArticleFor` revert with `ArticleTaken(publisher)` if another address already owns the id. Same publisher may re-register to update price. Product DB also reserves the slug via Supabase `register-article` before the chain tx.

**Writer gas:** `/write` and the generator call `POST /api/relay/register`. The server verifies the writer’s embed signature, checks the slug is reserved to them, then the contract **owner** submits `registerArticleFor`. Payments still go to the writer. Set `RELAYER_PRIVATE_KEY` (must be `owner()`) and fund that wallet with MON. Without the key, writers pay gas themselves.

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

## Deploy (Monad testnet)

1. Get testnet MON from a Monad faucet.
2. Create `contracts/.env`:

```env
PRIVATE_KEY=your_deployer_private_key_without_0x
PUBLISHER_ADDRESS=0xYourPublisherWallet
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
```

3. Deploy:

```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url monad_testnet \
  --broadcast \
  -vvvv
```

4. Copy deployed address into `deployments/monad-testnet.json` and widget `unlock-contract` attribute.

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

```bash
export PRIVATE_KEY=...
export USDC_TOKEN=0x754704Bc059F8C67012fEd69BC8A327a5aafb603
# optional demo publisher
export PUBLISHER_ADDRESS=0x...

forge script script/DeployUsdc.s.sol --rpc-url https://rpc.monad.xyz --broadcast -vvvv
```

Mainnet deploy: `0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f` (wired as the app/indexer default).
Override with `VITE_USDC_UNLOCK_CONTRACT` / `USDC_CONTRACT_ADDRESS` for forks.
Publishers receive USDC; readers only need a tiny MON balance for gas.
