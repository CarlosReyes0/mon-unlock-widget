# MiroShark preview + x402aff affiliate (spike)

Optional Write helper: **Simulate how this lands with MiroShark** runs a [MiroShark](https://www.miroshark.xyz/) 25-agent social sim on the draft. The control is in the write bar, in the Drafts list, and under the piece. **Publish does not wait on it** and does not fail if the sim errors.

Open Paywall is the **affiliate / builder**. When we (or a client wallet) pay MiroShark’s x402 `POST /run` (~$1 USDC), we attach Carlos’s **Base Builder Code** so MiroShark’s first-party [x402aff](https://github.com/MiroShark/x402aff) / 0xSplits path can pay the documented cut (default **~10% of the $1 run**, about **$0.10 USDC**) to the registered builder payout wallet.

Affiliate settlement is **USDC on Base** even though the sim itself can be paid on Base, Monad, or Solana. This spike always prefers the Base (`eip155:8453`) accept from the 402.

This is not NFT gating, not a change to article unlock pricing, and not a rewrite of x402 publish/unlock.

## Get a Builder Code (required)

Do **not** invent a code. Do **not** reuse the homepage `base:app_id` meta (`6aab87b69b238d5ecd11e976`) — that tag is only for Base **domain verification** on `articles.html`. A Builder Code looks like `bc_b7k3p9da` (pattern `^[a-z0-9_]{1,32}$`).

1. Open [dashboard.base.org](https://dashboard.base.org) or [base.dev](https://base.dev) and sign in.
2. Register the Open Paywall app if it is not already registered.
3. Add and verify the production domain `mon-unlock-widget-production.up.railway.app`. The articles homepage already ships:

   ```html
   <meta name="base:app_id" content="6aab87b69b238d5ecd11e976" />
   ```

4. Open **Settings → Builder Codes** and copy the code.
5. Register the payout wallet you want the affiliate share sent to (the x402aff split pays that registered owner).

## Railway env

| Variable | Required | Purpose |
| --- | --- | --- |
| `BASE_BUILDER_CODE` | **Yes** to enable the panel | Sent as `X-Builder-Code` on every MiroShark `/run` request (unpaid **and** paid). If missing or malformed, Write shows disabled copy and the API returns `missing_builder_code`. |
| `MIROSHARK_BASE_URL` | No | Default `https://x402.miroshark.xyz`. |
| `MIROSHARK_X402_PRIVATE_KEY` | No | Optional **server-side** Base wallet that pays the $1 USDC x402 v2 challenge (`PAYMENT-SIGNATURE`). Spike / documented-dev path only. Production can omit this and return the 402 to a client wallet instead. |

Set them on the Railway **web** service (same service as `npm start`), then redeploy. Never commit the payer key. Never put it in `VITE_*`.

If `BASE_BUILDER_CODE` is unset, the feature stays off. We will not fall back to `base:app_id` or any hardcoded `bc_…`.

## What we send (buyer attachment)

MiroShark’s seller kit routes `payTo` from the **request-time** header, not only from on-chain `s`:

1. `X-Builder-Code: <BASE_BUILDER_CODE>` on `POST /run` (required for the split; a plain x402 client that only sets `s` pays MiroShark unsplit).
2. On a paid retry, the x402 v2 envelope stamps `extensions["builder-code"].info.s` as `[<code>, "x402aff"]`, matching `x402aff.buyer_client.BuilderCodeClientExtension` / `@x402/extensions/builder-code` plus the kit’s shared discovery marker.

Equivalent official client wiring (if you pay from a browser/agent instead of `MIROSHARK_X402_PRIVATE_KEY`):

```ts
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { BuilderCodeClientExtension } from "@x402/extensions/builder-code";

client.registerExtension(new BuilderCodeClientExtension(process.env.BASE_BUILDER_CODE));
// also send header X-Builder-Code on the unpaid POST /run
```

## Payout caveat

- Price: **$1.00 USDC / run**. Default builder share is **~10%** (~$0.10), 90% to MiroShark, via an ownerless 0xSplits PushSplit.
- **Unregistered codes** (or RPC lookup failure) **fail open**: `payTo` stays MiroShark’s wallet, so the payment works but **is not split**. The code must be registered at Base.
- Funds sit in the split until someone calls `distribute` (permissionless; gas is a few cents). The payment itself is gasless EIP-3009 via the CDP facilitator.
- `s` is self-asserted metadata. The split ratio is enforced on-chain; routing to the split is a client opt-in (`X-Builder-Code`).
- CI never spends mainnet: tests mock 402 / `/run` / `/status`.

## API (Write calls these)

- `GET /api/miroshark/status` — enabled flag, whether a server payer is set (boolean only).
- `POST /api/miroshark/preview` `{ title, body }` — seed from title + teaser + body snippet. Always HTTP 200 with `ok: false` on sim errors (fail soft).
- `GET /api/miroshark/runs/run_<12 hex>` — poll status; when `completed`, includes a short report summary.

Public contract: [x402.miroshark.xyz/openapi.json](https://x402.miroshark.xyz/openapi.json) (`POST /run`, then poll `/status/{run_id}`). Typical wall-clock **10–25 minutes**.
