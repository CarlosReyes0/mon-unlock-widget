# ArticleUnlock — MON paywall contract

Native **MON** unlock on **Monad testnet**. Matches [FOCUS.md](../FOCUS.md) Phase 1.1.

## Contract

| Function | Purpose |
|----------|---------|
| `registerArticle(articleId, priceWei)` | Publisher registers their article |
| `registerArticleFor(...)` | Owner bootstrap (deploy script) |
| `unlock(articleId)` payable | Reader pays MON → publisher receives MON |
| `hasUnlocked(reader, articleId)` | Cross-device unlock check (Phase 1.3) |
| `articleIdFromString(slug)` | Must match widget `article-id` attribute |

**Article ID encoding:** `bytes32 = keccak256(bytes("founder-manifesto"))`  
Widget (viem): `keccak256(toBytes("founder-manifesto"))`

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
