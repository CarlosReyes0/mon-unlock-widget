# Cutover: unlock contracts with an owner and a relayer

Ordered steps for moving Monad mainnet from the current unlock contracts to a pair that has two-step ownership and a separate relayer. Do not broadcast from CI. Placeholders below are not real wallets.

Current contracts, left in place for past unlocks:

| Role | Address |
| --- | --- |
| ArticleUnlock (MON) | `0x27cA0c23835328e2Ab1424b66330be86fe177FA6` |
| ArticleUnlockUsdc | `0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f` |
| ArticleNFT | `0xFe467952918F744606e70876b2af0C083D269f92` |

New wallets (fill in after you create them; do not commit the keys):

| Name | Placeholder |
| --- | --- |
| Cold owner (`OWNER_ADDRESS`) | `0xYOUR_COLD_OWNER` |
| Relayer (`RELAYER_ADDRESS`) | `0xYOUR_RELAYER` |
| New ArticleUnlock | `0xYOUR_NEW_MON_UNLOCK` |
| New ArticleUnlockUsdc | `0xYOUR_NEW_USDC_UNLOCK` |

Deploy block of the new pair (the earlier of the two transactions): `<NEW_DEPLOY_BLOCK>`.

## What the new contracts change

- `transferOwnership` then `acceptOwnership`. The owner does not change until the new owner accepts.
- `setRelayer` is owner-only and emits `RelayerUpdated`.
- `registerArticleFor` is relayer-only. That is the server's only contract write.
- `updatePrice` stays with the publisher or the owner. The server never sends it, so the relayer cannot reprice an article.
- `setActive` stays with the publisher. The owner can also call it, which is the emergency pause. The relayer cannot.
- `unlock`, `hasUnlocked`, `getArticle`, `registerArticle`, and the existing events keep the same selectors. The widget and the indexer do not need a new ABI for reads or payments.

`RELAYER_PRIVATE_KEY` is the relayer wallet. It is read from the environment only. It is not the owner.

Until the server is pointed at the new contracts, set Railway `UNLOCK_LEGACY_OWNER_RELAYER=1`. The previous contracts have no `relayer()`. With that flag, a reverted `relayer()` read falls back to `owner()` matching the key. After cutover, unset the flag. A contract that returns `relayer()` is checked against that address even if the flag is still set.

## 1. Deploy both contracts

From `contracts/`, with `OWNER_ADDRESS` and `RELAYER_ADDRESS` set to the placeholders above (addresses only). The signer is `DEPLOYER_PRIVATE_KEY`, or `PRIVATE_KEY`, or an interactive forge account. Do not commit the signer key. `USDC_TOKEN` defaults to Circle USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`.

```bash
cd contracts
forge script script/DeployUnlock.s.sol --rpc-url monad_mainnet --broadcast -vv
```

The constructor sets `owner` and `relayer`. Record both addresses and the deploy block. `script/Deploy.s.sol` and `script/DeployUsdc.s.sol` deploy one contract with the same env if you need to redo only one.

## 2. setRelayer

Skip this when the constructor already set `RELAYER_ADDRESS` and you are not rotating it.

To rotate, the **owner** broadcasts `contracts/script/SetRelayer.s.sol`:

```bash
export UNLOCK_MON=0xYOUR_NEW_MON_UNLOCK
export UNLOCK_USDC=0xYOUR_NEW_USDC_UNLOCK
export RELAYER_ADDRESS=0xYOUR_RELAYER
forge script script/SetRelayer.s.sol --rpc-url monad_mainnet --broadcast -vv
```

Confirm `relayer()` on both contracts equals `0xYOUR_RELAYER`, and `owner()` equals `0xYOUR_COLD_OWNER`.

## 3. Migration dry-run, then confirm

`scripts/migrate-unlock-registrations.mjs` re-registers each article with `registerArticleFor`, using the original publisher and the current price (`getArticle` on the old contract, which includes later `updatePrice` calls). Inactive articles are skipped and listed. If the new contract already has the same publisher, the confirm pass skips it. A different publisher already on the new contract is reported as a conflict and not overwritten.

Dry-run is the default. It does not sign.

```bash
node scripts/migrate-unlock-registrations.mjs --source=both
node scripts/migrate-unlock-registrations.mjs --confirm --source=both
```

`--source=chain` (default) reads `ArticleRegistered` logs, then `getArticle`. `--source=db` reads the Supabase `articles` table (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`). `--source=both` unions them and lets the chain row win. `MIGRATE_FROM_BLOCK` or `--from-block=` limits the log scan. `OLD_MON_UNLOCK_CONTRACT` and `OLD_USDC_UNLOCK_CONTRACT` default to the current mainnet addresses. `NEW_MON_UNLOCK_CONTRACT` and `NEW_USDC_UNLOCK_CONTRACT` are required before `--confirm`.

### Publisher remap file

Optional. Not committed. Copy `scripts/publisher-remap.example.json` to `scripts/publisher-remap.json` (gitignored), or pass `--remap=path`.

```json
{
  "publishers": {
    "0x1111111111111111111111111111111111111111": "0x2222222222222222222222222222222222222222"
  }
}
```

Each key is the publisher on the old contract. The value is the address passed to `registerArticleFor`. Publishers that are absent keep their original address. Both values must be `0x` plus 40 hex characters. Put real addresses only in the gitignored file.

`--confirm` checks `relayer()` on the destination equals the address derived from `RELAYER_PRIVATE_KEY` before it sends. The script prints the plan and transaction hashes. It does not print environment values.

## 4. ArticleNFT

The ArticleNFT owner (`0xFe467952918F744606e70876b2af0C083D269f92`) calls:

```solidity
setUnlockContracts(0xYOUR_NEW_MON_UNLOCK, 0xYOUR_NEW_USDC_UNLOCK)
```

That contract stores two addresses. After this call, `mintEdition` / `mintReceipt` read the new pair only. Reading an article does not go through ArticleNFT. Past unlocks stay valid for reading, described in the next sections. A receipt for an unlock that exists only on an old contract can be minted after the reader unlocks on the new contract, or by pointing `setUnlockContracts` back during a rollback.

`ARTICLE_NFT_CONTRACT` and `VITE_ARTICLE_NFT_CONTRACT` do not change.

## 5. Contract address configuration

Update these together, after the migration confirm succeeds. Leave every `LEGACY_*` constant on the addresses in the table at the top of this file. Replacing a primary constant and editing the matching `LEGACY_*` line in the same edit removes the old contract from reads.

### Railway (web service)

| Variable | Set to |
| --- | --- |
| `UNLOCK_CONTRACT` | `0xYOUR_NEW_MON_UNLOCK` |
| `USDC_UNLOCK_CONTRACT` | `0xYOUR_NEW_USDC_UNLOCK` |
| `VITE_USDC_UNLOCK_CONTRACT` | `0xYOUR_NEW_USDC_UNLOCK` (only if you rebuild the browser bundle) |
| `RELAYER_PRIVATE_KEY` | key of `0xYOUR_RELAYER` (environment only, never logged) |
| `UNLOCK_LEGACY_OWNER_RELAYER` | unset after the new contracts are live |

`UNLOCK_CONTRACT` / `USDC_UNLOCK_CONTRACT` are what `server/publish.mjs` embeds, and they are added to the server allowlist at runtime. `CONTRACT_ADDRESS` is not read by the Railway server. It is a Supabase secret, below.

Do not change `ARTICLE_NFT_CONTRACT`.

### Supabase edge function secrets

Set these on the project, then redeploy the `indexer` and `article-body` functions so they pick up the values.

| Secret | Set to |
| --- | --- |
| `CONTRACT_ADDRESS` | `0xYOUR_NEW_MON_UNLOCK` |
| `USDC_CONTRACT_ADDRESS` | `0xYOUR_NEW_USDC_UNLOCK` |
| `LEGACY_CONTRACT_ADDRESS` | `0x27cA0c23835328e2Ab1424b66330be86fe177FA6` |
| `LEGACY_USDC_CONTRACT_ADDRESS` | `0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f` |
| `INDEXER_START_BLOCK` | `<NEW_DEPLOY_BLOCK>` |

`INDEXER_START_BLOCK` applies only when a **primary** contract (`CONTRACT_ADDRESS` / `USDC_CONTRACT_ADDRESS`) has no `indexer_state` row yet. The first scan starts at that block. Legacy addresses ignore it: an existing `indexer_state` row keeps its cursor, and a missing legacy row scans from block 0. Set the start block in the same change as the new primary addresses, and only after the old contracts already have `indexer_state` rows (they do on mainnet).

### Hard-coded addresses

These files ship the current mainnet addresses. Point the **primary** value at the new contract. Do not delete the legacy constants in the TypeScript and server copies.

| File | What to change |
| --- | --- |
| `src/core/publish-auth.ts` | `MON_UNLOCK_CONTRACT`, `USDC_UNLOCK_CONTRACT`. Leave `LEGACY_MON_UNLOCK_CONTRACT` and `LEGACY_USDC_UNLOCK_CONTRACT`. |
| `src/core/payment-asset.ts` | `MAINNET_MON_UNLOCK_CONTRACT`. The USDC fallback next to `VITE_USDC_UNLOCK_CONTRACT`. |
| `src/core/embed-signature.ts` | `MAINNET_UNLOCK_CONTRACT` (MON). USDC comes from `payment-asset.ts`. |
| `server/embed-signature.mjs` | `MAINNET_UNLOCK_CONTRACT`, `MAINNET_USDC_UNLOCK_CONTRACT`. Leave `LEGACY_UNLOCK_CONTRACT` and `LEGACY_USDC_UNLOCK_CONTRACT`. |
| `server/publish.mjs` | Fallback strings for `UNLOCK_CONTRACT` and `USDC_UNLOCK_CONTRACT`. Env overrides these at runtime, so Railway can move first. |
| `server/listings.mjs` | Fallback `unlockContract` when a row has none. |
| `article.html` | `MON_CONTRACT`, `USDC_CONTRACT`. |
| `register.html` | `MAINNET_CONTRACT`, `MAINNET_USDC_CONTRACT`. |
| `generator.html` | `MAINNET_CONTRACT`, `MAINNET_USDC_CONTRACT`. |
| `dashboard.html` | `contract` in the embed sample. |
| `embed-example.html` | `unlock-contract`. |
| `demo-unlock-recording.html` | `unlock-contract`. |
| `README.md` | embed sample `unlock-contract`. |
| `skills/mon-unlock-embed/embed.ts` | `MAINNET_CONTRACT`. |
| `supabase/functions/indexer/index.ts` | USDC fallback used when `USDC_CONTRACT_ADDRESS` is unset. Prefer the secret over editing this before the secret is set. |
| `contracts/script/DeployArticleNft.s.sol` | `MAINNET_UNLOCK_MON` / `MAINNET_UNLOCK_USDC` defaults, if you redeploy the NFT. The live NFT is updated with `setUnlockContracts` instead. |
| `contracts/deployments/monad-mainnet.json` | Record the new MON deployment. Keep the old file contents in git history. |
| `contracts/deployments/monad-mainnet-usdc.json` | Record the new USDC deployment. |
| `contracts/deployments/monad-mainnet-article-nft.json` | `unlockMon` / `unlockUsdc` notes after `setUnlockContracts`. The NFT address stays. |
| `.env.example` | Comments and the `VITE_USDC_UNLOCK_CONTRACT` sample. |

Tests that import those constants follow the edit. Two tests hard-code a live address and need the same edit: `server/register-page.test.mjs`, `src/core/checkout-protocol.test.ts`. `scripts/serve-fiat-test.mjs` has a sample USDC URL.

There is no `public/` directory. The HTML files at the repo root are the static pages.

## 6. Indexer

- New contracts: `indexer_state` has no row, so `INDEXER_START_BLOCK` is the first block scanned. Do not start them at block 0.
- Old contracts: leave their `indexer_state` rows and their `unlocks` rows. `LEGACY_CONTRACT_ADDRESS` and `LEGACY_USDC_CONTRACT_ADDRESS` keep those contracts in the scan, so events on the old contracts are still indexed.
- `ArticleRegistered` and `ArticleUnlocked` are unchanged, so the same decoder handles both pairs.
- Do not delete or rewind an old `indexer_state` row.

## 7. Existing unlocks

Past unlocks stay valid. Nothing in this cutover clears `unlocked` on the old contracts or deletes `public.unlocks`.

Reads check the old and the new contracts as follows:

1. **`public.unlocks` (and fiat rows).** `/api/access` and `/api/article-body` on Railway treat a row as access. The widget calls `/api/access` before it asks the reader to pay. Rows written by the indexer for the old contracts remain.
2. **Edge `article-body`.** After the table check, it calls `hasUnlocked` on the read set for that article's `payment_asset`: the current MON or USDC constant, the matching `LEGACY_*` constant, and the Supabase secrets (`CONTRACT_ADDRESS` or `USDC_CONTRACT_ADDRESS`, plus `LEGACY_CONTRACT_ADDRESS` or `LEGACY_USDC_CONTRACT_ADDRESS`). A `unlock_contract` query param is added only when it is already on that allowlist. Any other address is ignored.
3. **Widget `hasUnlocked`.** The embed's `unlock-contract` picks the family. A known MON address is checked together with `LEGACY_MON_UNLOCK_CONTRACT`. A known USDC address is checked together with `LEGACY_USDC_UNLOCK_CONTRACT`. The other asset is not checked. Today those legacy constants equal the live contracts, so this is one call. After you change the primary constants and leave `LEGACY_*` alone, the widget checks the new contract and the old one. Payment still goes to the embed's contract.
4. **Old embeds** that still carry `0x27cA…` or `0xd66D…` keep calling `hasUnlocked` on the contract the reader paid. Those flags are unchanged.

MON and USDC are separate. A MON unlock is not treated as a USDC unlock.

## 8. Rollback

If the new contracts are not taking payments yet:

1. Set Railway `UNLOCK_CONTRACT` and `USDC_UNLOCK_CONTRACT` back to `0x27cA0c23835328e2Ab1424b66330be86fe177FA6` and `0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f`.
2. Set Supabase `CONTRACT_ADDRESS` and `USDC_CONTRACT_ADDRESS` back to those same addresses. You can leave `LEGACY_*` set; duplicate addresses are indexed once.
3. Unset `INDEXER_START_BLOCK`, or leave it. It does not move an existing `indexer_state` cursor.
4. Set `UNLOCK_LEGACY_OWNER_RELAYER=1` if `RELAYER_PRIVATE_KEY` is again the owner of the previous contracts. Put the previous relayer key back in the environment the same way you set it (do not paste it into logs or git).
5. ArticleNFT owner calls `setUnlockContracts` with the previous MON and USDC addresses.
6. Redeploy the previous hard-coded primaries if that commit already shipped. Leave `LEGACY_*` as the previous contracts.
7. Do not delete `unlocks` or `indexer_state`.

If readers have already paid the new contracts, keep `0xYOUR_NEW_MON_UNLOCK` and `0xYOUR_NEW_USDC_UNLOCK` in the read set (the `LEGACY_*` secrets, or the primary constants) so those `hasUnlocked` flags still count. The migration does not need to be reversed for old readers: their flags are on the old contracts, which stay deployed.

## Local demo

`scripts/demo-unlock-roles.sh` runs the same sequence on a local anvil: deploy both, `setRelayer`, `registerArticleFor`, `unlock`, `hasUnlocked`. It uses anvil's unlocked accounts and does not print a key. CI does not run it.
