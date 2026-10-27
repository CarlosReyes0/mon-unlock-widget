#!/usr/bin/env bash
# Local anvil walk-through: deploy, setRelayer, registerArticleFor, unlock.
# Uses anvil unlocked accounts. Does not print keys. Not run from CI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${ANVIL_PORT:-18545}"
RPC="http://127.0.0.1:${PORT}"
OWNER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
FIRST_RELAYER="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
NEXT_RELAYER="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
PUBLISHER="0x90F79bf6EB2c4f870365E785982E1f101E93b906"
READER="0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"

if ! command -v anvil >/dev/null || ! command -v forge >/dev/null || ! command -v cast >/dev/null; then
  echo "foundry (anvil, forge, cast) is required" >&2
  exit 1
fi

anvil --silent --port "$PORT" >/tmp/anvil-unlock-roles.log 2>&1 &
ANVIL_PID=$!
cleanup() {
  kill "$ANVIL_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in $(seq 1 50); do
  if cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

cd "$ROOT/contracts"
if [[ ! -d lib/forge-std ]]; then
  forge install foundry-rs/forge-std --no-commit
fi

export OWNER_ADDRESS="$OWNER"
export RELAYER_ADDRESS="$FIRST_RELAYER"
export USDC_TOKEN="0x0000000000000000000000000000000000000001"

echo "== deploy =="
forge script script/DeployUnlock.s.sol \
  --rpc-url "$RPC" \
  --broadcast \
  --unlocked \
  --sender "$OWNER" \
  -vv

RUN_JSON="broadcast/DeployUnlock.s.sol/31337/run-latest.json"
MON="$(jq -r '.transactions[0].contractAddress' "$RUN_JSON")"
USDC="$(jq -r '.transactions[1].contractAddress' "$RUN_JSON")"
echo "ArticleUnlock ${MON}"
echo "ArticleUnlockUsdc ${USDC}"
echo "owner $(cast call "$MON" 'owner()(address)' --rpc-url "$RPC")"
echo "relayer before rotation $(cast call "$MON" 'relayer()(address)' --rpc-url "$RPC")"

echo "== setRelayer =="
export UNLOCK_MON="$MON"
export UNLOCK_USDC="$USDC"
export RELAYER_ADDRESS="$NEXT_RELAYER"
forge script script/SetRelayer.s.sol \
  --rpc-url "$RPC" \
  --broadcast \
  --unlocked \
  --sender "$OWNER" \
  -vv
echo "relayer after rotation $(cast call "$MON" 'relayer()(address)' --rpc-url "$RPC")"
echo "usdc relayer $(cast call "$USDC" 'relayer()(address)' --rpc-url "$RPC")"

echo "== registerArticleFor =="
ARTICLE_ID="$(cast keccak "founder-manifesto")"
cast send "$MON" \
  "registerArticleFor(bytes32,uint256,address)" \
  "$ARTICLE_ID" \
  1000000000000000000 \
  "$PUBLISHER" \
  --rpc-url "$RPC" \
  --unlocked \
  --from "$NEXT_RELAYER"

echo "== unlock =="
cast send "$MON" \
  "unlock(bytes32)" \
  "$ARTICLE_ID" \
  --value 1000000000000000000 \
  --rpc-url "$RPC" \
  --unlocked \
  --from "$READER"

echo "== hasUnlocked =="
cast call "$MON" \
  "hasUnlocked(address,bytes32)(bool)" \
  "$READER" \
  "$ARTICLE_ID" \
  --rpc-url "$RPC"
echo "publisher $(cast call "$MON" 'getArticle(bytes32)(uint256,address,bool)' "$ARTICLE_ID" --rpc-url "$RPC")"
