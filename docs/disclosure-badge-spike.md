# Disclosure badge spike

**Status: SPIKE. Do not merge. Do not apply the migration. Do not ship.**

Checked 2026-10-07 against spec v0.1 (2026-10-06). This note covers the ticker-map draft, a SIWE sketch, and a backfill recommendation. It does not add endpoints, a worker, or badge UI.

The draft migration is `supabase/migrations/0014_disclosure_instruments.sql`. It is valid SQL for a scratch database. It has not been applied to Supabase project `flczjqljgntmkanipugo`.

## Locked rules this spike keeps

- Three states, and one of them always renders: `Holds TSLAx · 142 days`, `Short TSLAx · self-attested`, `No position disclosed`. Long and short together are two stacked lines, not a fourth state.
- Duration is the exact number of days since the aggregate balance last hit zero. Partial sells do not reset the count. A full exit after publish becomes `Held at publish · sold <date>`. The badge does not go blank.
- Opt-in is off by default. The short declaration is part of the same toggle, not a separate feature that defaults on.
- Public copy says USDC. MON stays in internal notes about gas.
- v1 is xStocks issued by Backed, on Monad only.

The $100 holds floor is still the open question in spec section 8.1. The spec leans toward a $100 floor for both "holds" and "sold". This spike does not pick a different floor and does not store one.

## Verified facts

### Chain id 143

`eth_chainId` on `https://rpc.monad.xyz` and `https://rpc1.monad.xyz` returned `0x8f` (143). That matches `monadMainnet.id` in `src/core/chains.ts` and `MONAD_CHAIN_ID` in `src/core/publish-auth.ts`.

While checking, `eth_blockNumber` on `rpc.monad.xyz` was about 111,229,000. `eth_getBlockByNumber` for block 1 returned timestamp `1747232689` (2025-05-14T14:24:49Z). From block 1 to that head the average is about 2.52 blocks/sec. The most recent 1,000,000 blocks (timestamps 1791045243 → 1791347468) ran at about 3.31 blocks/sec. The spec's "~2 blocks/sec" is the right order of magnitude; capacity math below uses the recent ~3.3 figure.

### TSLAx base is an EIP-1967 proxy

Contract `0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0` on `https://rpc.monad.xyz` (`eth_call` / `eth_getStorageAt` / `eth_getCode`, block tag `latest`):

| Call | Result |
|---|---|
| `symbol()` | `TSLAx` |
| `name()` | `Tesla xStock` |
| `decimals()` | 18 |
| bytecode size | 2,138 bytes |
| EIP-1967 implementation slot | `0x65c40d624af3b18c109fbf87b7deff34cdc5f19b` (15,981 bytes of code) |
| EIP-1967 admin slot | `0x696c685a02a1fc6e2aacbe26cd6695f4f4a6a085` |
| beacon slot | zero |

`symbol()` on the implementation address itself returned `BTI`, not `TSLAx`. The implementation's storage is not the token. Always call the proxy. Never identify a token by implementation address or by a symbol read from an unknown contract.

The same seven base tokens checked below all share that one implementation.

### Wrapper V2 is a different token, and it points at the base

Contract `0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171`:

| Call | Result |
|---|---|
| `symbol()` | `wTSLAx` |
| `name()` | `Wrapped Tesla xStock` |
| `decimals()` | 18 |
| EIP-1967 implementation | `0x76c6851ea0b2741eedcbbed240715e8817e85583` |
| `asset()` | `0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0` (the TSLAx base) |
| `multiplier()` / `underlying()` / `token()` | revert |

**Wrapper = sale, if base and wrapper are not aggregated.** Wrapping moves the base token out of the wallet and leaves `wTSLAx` behind. An indexer that only watches the base sees the balance hit zero, ends the holding segment, and the badge flips to `Held at publish · sold <date>`. The spec's rule is the one to build: sum base + wrapper for the instrument, and apply every Transfer leg in a transaction before testing for zero. This spike did not watch a live wrap, so the "two Transfer legs in one tx" shape is still unchecked. The `asset()` link is checked.

All seven wrappers share implementation `0x76c6851ea0b2741eedcbbed240715e8817e85583`, and each wrapper's `asset()` returns its own base.

### Seven launch names on Monad

`GET https://api.backed.fi/api/v2/public/assets?page=N` (no auth), pages 1–12 on 2026-10-07: 1,172 assets, 1,171 with a Monad deployment, 895 of those whose `underlying.exchange.mic` is a US venue (`XNAS`, `XNYS`, `ARCX`, `BATS`, `XASE`, `XNMS`). The curated table should stay a small US subset. This seed is the seven names the spec starts with. `verified_at` is null on every row.

`GOOGLx` tracks **GOOGL** (class A, ISIN `US02079K3059`, MIC `XNAS`), not GOOG. GOOG is not seeded. Both share SEC CIK `1652044`. A later GOOG instrument would be its own row.

On-chain `symbol()`, `decimals()`, proxy slot, and wrapper `asset()` were read for each pair. `decimals()` is 18 on all fourteen contracts.

| Token | Underlying | MIC | Base | Wrapper | On-chain names |
|---|---|---|---|---|---|
| TSLAx | TSLA `US88160R1014` | XNAS | `0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0` | `0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171` | TSLAx / wTSLAx |
| AAPLx | AAPL `US0378331005` | XNAS | `0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a` | `0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f` | AAPLx / wAAPLx |
| NVDAx | NVDA `US67066G1040` | XNAS | `0xc845b2894dbddd03858fd2d643b4ef725fe0849d` | `0xa8ddb5cd96b5222afe198316e9a57caa642850d5` | NVDAx / wNVDAx |
| METAx | META `US30303M1027` | XNAS | `0x96702be57cd9777f835117a809c7124fe4ec989a` | `0xe840946ffebcd66b7c4e95095effafadfa0d0e56` | METAx / wMETAx |
| GOOGLx | GOOGL `US02079K3059` | XNAS | `0xe92f673ca36c5e2efd2de7628f815f84807e803f` | `0xf8c5308f80e459bb53d9ebe689854d9cbb2caa6f` | GOOGLx / wGOOGLx |
| SPYx | SPY `US78462F1030` | ARCX | `0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48` | `0xe7e553cd128f0011777323a0b44a7b96ea1cb540` | SPYx / wSPYx |
| QQQx | QQQ `US46090E1038` | XNAS | `0xa753a7395cae905cd615da0b82a53e0560f250af` | `0x4c1ae29c159838fc1b224636e28e086eb69101f7` | QQQx / wQQQx |

Names and CIKs in the seed come from `https://www.sec.gov/files/company_tickers.json` (User-Agent set, fetched 2026-10-07), except QQQ, which is not in that file. QQQ's name in the seed is a placeholder (`Invesco QQQ Trust, Series 1`) and its `cik` is null. SPY and QQQ are seeded as `type = 'etf'`. Backed's `underlying.type` was null for every row, so that classification is not from the issuer payload. FIGI was not looked up. `instrument_history` is created and left empty.

AAPLx's Monad deployment in the Backed payload had an empty `stablecoins` array. The other six listed Monad USDC at `0x754704bc059f8c67012fed69bc8a327a5aafb603` (6 decimals). The AAPLx contracts still answered `symbol()` and `asset()`, so the row stays in the seed.

### `multiplier()` exists on the base, and it is not always 1

`multiplier()` on the base proxy returned a uint256. Scaled by 1e18:

| Token | `multiplier() / 1e18` |
|---|---|
| TSLAx | 1.000000000000 |
| NVDAx | 1.001701196801 |
| GOOGLx | 1.002377250060 |
| METAx | 1.002851543327 |
| AAPLx | 1.003269012540 |
| QQQx | 1.003456075897 |
| SPYx | 1.005714560286 |

`multiplier()` reverts on the wrapper. The seed leaves `shares_per_token = 1`. Whether `balanceOf` already includes this factor is still open. It matters for size bands, not for "did the balance hit zero".

### Backfill providers

**Envio HyperSync supports Monad mainnet.** The supported-networks doc lists chain 143 at `https://monad.hypersync.xyz` and `https://143.hypersync.xyz` (RPC host `https://143.rpc.hypersync.xyz`). `GET https://monad.hypersync.xyz/height` with no token returned `{"height":111229070}`, in line with `eth_blockNumber` at the same time. `POST /query` and the HyperSync RPC both returned 401: `Your token is malformed. API Tokens can be created at https://app.envio.dev/api-tokens.` Support is real. A token and a price were not checked.

**Etherscan API V2 lists Monad.** `GET https://api.etherscan.io/v2/chainlist` includes `{ "chainname": "Monad Mainnet", "chainid": "143", "blockexplorer": "https://monadscan.com/", "apiurl": "https://api.etherscan.io/v2/api?chainid=143", "status": 1 }`. A keyless call to that API returns `Missing/Invalid API Key`, which means the chain is registered. It does not mean `tokentx` or `txlist` was pulled. `https://api.monadscan.com/api` (V1) responds that V1 is deprecated and to use Etherscan API V2. Routescan's Etherscan-compatible API for chain 143 returned `chain not supported`.

**Public Monad RPC cannot backfill.** `eth_getLogs` for TSLAx Transfers on `https://rpc.monad.xyz`: a 100-block range returned HTTP 200 (0 logs in that window); a 200-block range returned HTTP 413 with `{"code":-32614,"message":"eth_getLogs is limited to a 100 range"}`. The same cap is already what `supabase/functions/indexer/index.ts` uses (`CHUNK_SIZE = 100n`). `eth_getCode` at block 100,000,000 failed with historical state unavailable; `eth_getCode` about 1,000,000 blocks behind head succeeded. Header lookups (`eth_getBlockByNumber`) still work back to block 1. So this RPC can tail near the head and cannot binary-search a deploy block.

`deploy_block` is null in the seed. Also tried, and not useful without a key or a token: Sourcify v2 for chain 143 / TSLAx returned 404; Routescan as above; Etherscan V2 and HyperSync `/query` need credentials.

## Recommendation

**Backfill with HyperSync, from a Railway worker. Tail with the existing small-chunk RPC pattern. Do not backfill inside the Supabase edge function.**

1. **Backfill provider: Envio HyperSync** (`https://monad.hypersync.xyz`, chain 143). It is the only option checked here that is both indexed to the chain head and built for historical logs. Create an API token before writing the worker. Treat pricing as still open (spec question 8.9).
2. **Where it runs: a new Railway worker** in this repo, same shape as `cron/` (Deno or Node), service-role key only in the service env. It pulls pending wallet-link jobs and writes `token_transfer`. The current Railway cron (`cron/railway.toml`, `*/5 * * * *`) only POSTs at the unlock indexer and should stay that way.
3. **Tail: keep `eth_getLogs` in 100-block chunks**, on the public RPC or a paid RPC later. Five minutes at ~3.3 blocks/sec is about 1,000 blocks, about 10 calls per token set. That fits the edge function's current budget (`MAX_BLOCKS_PER_RUN = 2000`). A paid RPC is for a wider tail and for `balanceOf` spot checks, not for replaying 100 million blocks.
4. **Etherscan V2 is the later convenience for wallet age and funding source** (`txlist` / `tokentx`), once a key exists. Cross-check the latest holding segment against HyperSync or RPC. It is not the backfill source.
5. **Aggregate base + wrapper** before deciding that a position ended. Index both contracts in `instrument_token`. A wrap that is indexed as a base-only exit will publish `Held at publish · sold <date>` for someone who still holds the wrapper.

Edge-function wall-clock on this Supabase plan was not measured. It does not change the split: backfill is unbounded, the edge function is for a short tail.

## How this fits the indexer we have

| Piece | Today | Disclosure use |
|---|---|---|
| `cron/indexer.ts` | One POST to `/functions/v1/indexer` with the anon key and `x-indexer-secret` | Leave it on the unlock contracts. A later change can POST a second function; do not fold backfill into this process. |
| `cron/railway.toml` | `cronSchedule = "*/5 * * * *"` | Unlock fallback only. |
| `pg_cron` job `mon-unlock-indexer` | Every 2 minutes (`20260928143000_indexer_cron_secret.sql`), README calls this the primary | Same: unlock events only, until a separate job exists. |
| Edge function `indexer` | Service role, viem, chain 143, `CHUNK_SIZE = 100`, max 2,000 blocks per run, cursor in `indexer_state(contract_address)` | The 100-block chunk matches the public RPC cap measured above. Do not reuse `indexer_state` as-is for xStocks: the unique key is `contract_address` alone, and the same Backed address exists on many chains. A position cursor wants `(chain_id, contract)` or the spec's `(wallet_link_id, token_id)`. |
| Writes | Service role bypasses RLS | The backfill worker uses the service role the same way. The anon key stays in the cron caller only. |

`indexer_state` is not altered in this spike.

## SIWE sketch (not built)

Writer identity today is the publisher wallet, not a user id.

- `articles.publisher` is the wallet address (`0x…`). `publisher_accounts.publisher` is that same text key, plus an optional `usdc_wallet` and a Stripe account.
- `src/publisher/PublisherAuth.tsx` signs in with Privy. Email or Google creates an embedded wallet. "Connect wallet" uses an external wallet. "Use a different wallet" switches the address that becomes `publisher`.
- One person can therefore have more than one `publisher` key. Spec question 8.11 stays open. This spike does not add a user table.

Wallet link uses a second signature, SIWE (EIP-4361), aimed at chain 143. It does not replace publish auth.

Message rules from spec 5.2, unchanged:

- Domain `openpaywall.app`. Reject any other domain.
- `Chain ID: 143`. On startup, `eth_chainId` must match or the server fails closed.
- Nonce: at least 96 bits, single use, 10-minute TTL.
- Statement must not mention MON. The spec's statement is the one to use: link the wallet so OpenPaywall can show verified position disclosures; the signature does not allow transactions or spending.
- Resources include `https://openpaywall.app/terms/disclosure`.
- Parse with `siwe` or `viem/siwe`, and support EIP-1271 when we know which smart wallets writers actually use. That usage is still unchecked.

Proposed tables, not in the migration:

```sql
create table siwe_nonce (
  nonce text primary key,
  publisher text not null, -- articles.publisher / publisher_accounts.publisher
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table wallet_link (
  id uuid primary key default gen_random_uuid(),
  publisher text not null,
  chain_id integer not null,          -- 143
  address text not null,               -- lowercase
  siwe_message text not null,
  siwe_signature text not null,
  linked_at timestamptz not null default now(),
  revoked_at timestamptz,
  wallet_first_seen_block bigint,
  wallet_first_seen_at timestamptz,
  funding_tx_hash text,
  funding_from text,
  funding_label text,
  backfill_status text not null default 'pending'
    check (backfill_status in ('pending', 'running', 'done', 'failed')),
  unique (chain_id, address)           -- one writer per wallet
);
```

`unique (chain_id, address)` stops two publisher keys from sharing one wallet. It does not stop one person with two publisher keys from linking two wallets. Revoking a link does not erase a badge already published.

Flow, when it is built: `GET /api/siwe/nonce` → sign → `POST /api/siwe/verify` writes `wallet_link` with `backfill_status = 'pending'` → the Railway worker backfills. RLS: no direct anon read of `wallet_link` or `siwe_nonce`. The verify page reads through a function later.

Opt-in default stays off. The spec's later column is `publisher_accounts.disclosure_default boolean not null default false`. It is not added here. Per-article override and the long / short / both answer land with the badge tables, not in this spike.

## Ticker map draft

`0014_disclosure_instruments.sql` follows the numbered migration style: `create table if not exists`, checks, comments, RLS enabled, public SELECT policies, service role for writes.

| Table | Role |
|---|---|
| `issuer_allowlist` | v1 row: `backed` |
| `instrument` | Share-class row. Unique `(primary_ticker, exchange)` |
| `instrument_history` | Present, empty |
| `instrument_token` | Base and wrapper. Unique `(chain_id, contract)`. `issuer` references `issuer_allowlist`. Wrapper `base_token_id` is required. |
| `article_instrument` | `article_id bigint references articles(id) on delete cascade` |

Anon can read active issuers, instruments, and tokens, plus article links whose article is `active`. No anon writes. A badge is only offered for a token with `verified_at` set; the seed does not set it.

One extra constraint versus the spec sketch: `issuer` is a foreign key to `issuer_allowlist`, and a wrapper row must point at its base. Both match rules the spec already states.

## Still TODO-verify

- `deploy_block` for each contract (needs HyperSync or an Etherscan V2 key).
- A real wrap transaction: both Transfer legs, same tx, and the conversion (1:1 vs share-based). `asset()` is the only wrapper link checked.
- Whether `balanceOf` already reflects `multiplier()`.
- HyperSync price, and an Etherscan V2 key's `tokentx` / `txlist` rate limits.
- Supabase edge-function wall-clock on this plan.
- Which smart wallets (EIP-1271) writers use on Monad.
- **$100 holds floor.** Spec section 8.1 leans $100 for both holds and sold. Unchanged, not encoded.

## Out of scope

SIWE routes, the Railway backfill worker, badge components, the verify page, terms, size-band pricing, and any apply against live Supabase.
