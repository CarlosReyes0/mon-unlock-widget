import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  formatUnits,
  http,
  maxUint256,
  parseAbi,
  parseUnits,
  type Address,
} from "viem";
import { monadMainnet } from "./chains.js";
import type { Eip1193Provider } from "./wallet.js";

/** Circle USDC on Monad mainnet. */
export const MONAD_USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as Address;
/** Wrapped MON (PancakeSwap / Uniswap quote token). */
export const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A" as Address;
/** PancakeSwap V3 SwapRouter (shared address across PCS chains including Monad). */
export const PCS_V3_SWAP_ROUTER = "0x1b81D678ffb9C0263b24A97847620C99d213eB14" as Address;
/** PancakeSwap V3 QuoterV2. */
export const PCS_V3_QUOTER = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" as Address;
/** High-liquidity MON/USDC pool fee tier (0.05%). */
export const MON_USDC_FEE = 500;

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

const swapRouterAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

const wmonAbi = parseAbi(["function withdraw(uint256 wad)"]);

function publicClient() {
  return createPublicClient({
    chain: monadMainnet,
    transport: http(monadMainnet.rpcUrls.default.http[0]),
  });
}

export async function getUsdcBalance(address: Address): Promise<bigint> {
  return publicClient().readContract({
    address: MONAD_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

/** How much USDC (6 decimals) is needed to receive at least `minMonWei` after a 1% slippage buffer. */
export async function estimateUsdcForMon(minMonWei: bigint): Promise<bigint> {
  if (minMonWei <= 0n) return 0n;
  // Binary search sell amount of USDC that yields >= minMonWei WMON.
  let lo = 1n;
  let hi = parseUnits("100000", 6); // $100k cap
  // Seed hi from a 1 USDC quote.
  const oneUsdcOut = await quoteUsdcToWmon(parseUnits("1", 6));
  if (oneUsdcOut > 0n) {
    // rough: need = minMon * 1e6 / oneUsdcOut, then +20% headroom for search upper bound
    const rough = (minMonWei * parseUnits("1", 6)) / oneUsdcOut;
    hi = rough * 2n + parseUnits("1", 6);
  }
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const out = await quoteUsdcToWmon(mid);
    if (out >= minMonWei) hi = mid;
    else lo = mid + 1n;
  }
  // Add 2% buffer for price move between quote and swap.
  return (lo * 102n) / 100n;
}

export async function quoteUsdcToWmon(usdcAmount: bigint): Promise<bigint> {
  if (usdcAmount <= 0n) return 0n;
  const result = (await publicClient().readContract({
    address: PCS_V3_QUOTER,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: MONAD_USDC,
        tokenOut: WMON,
        amountIn: usdcAmount,
        fee: MON_USDC_FEE,
        sqrtPriceLimitX96: 0n,
      },
    ],
  })) as readonly [bigint, bigint, number, bigint];
  return result[0];
}

/**
 * Swap all needed USDC → WMON → unwrap to native MON.
 * Returns native MON received (wei).
 */
export async function swapUsdcToMon(params: {
  provider: Eip1193Provider;
  account: Address;
  usdcAmount: bigint;
  minMonOut: bigint;
}): Promise<bigint> {
  const { provider, account, usdcAmount, minMonOut } = params;
  if (usdcAmount <= 0n) throw new Error("Nothing to swap.");

  const wallet = createWalletClient({
    account,
    chain: monadMainnet,
    transport: custom(provider),
  });
  const pub = createPublicClient({
    chain: monadMainnet,
    transport: custom(provider),
  });

  const allowance = await pub.readContract({
    address: MONAD_USDC,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, PCS_V3_SWAP_ROUTER],
  });
  if (allowance < usdcAmount) {
    const approveHash = await wallet.writeContract({
      address: MONAD_USDC,
      abi: erc20Abi,
      functionName: "approve",
      args: [PCS_V3_SWAP_ROUTER, maxUint256],
    });
    await pub.waitForTransactionReceipt({ hash: approveHash });
  }

  // 1% slippage vs quoted min.
  const amountOutMinimum = (minMonOut * 99n) / 100n;
  const balBefore = await pub.getBalance({ address: account });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const swapHash = await wallet.writeContract({
    address: PCS_V3_SWAP_ROUTER,
    abi: swapRouterAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: MONAD_USDC,
        tokenOut: WMON,
        fee: MON_USDC_FEE,
        recipient: account,
        deadline,
        amountIn: usdcAmount,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  await pub.waitForTransactionReceipt({ hash: swapHash });

  const wmonBal = await pub.readContract({
    address: WMON,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
  if (wmonBal <= 0n) throw new Error("Swap completed but no WMON received.");

  const unwrapHash = await wallet.writeContract({
    address: WMON,
    abi: wmonAbi,
    functionName: "withdraw",
    args: [wmonBal],
  });
  await pub.waitForTransactionReceipt({ hash: unwrapHash });

  const balAfter = await pub.getBalance({ address: account });
  // Net MON gained (approx; gas spent reduces this).
  const gained = balAfter > balBefore ? balAfter - balBefore : wmonBal;
  if (gained + parseUnits("0.001", 18) < amountOutMinimum) {
    // Soft check — gas can eat a bit; hard fail only if far below.
    throw new Error("Swap returned less MON than expected. Try again.");
  }
  return gained;
}

export function formatUsdc(amount: bigint): string {
  const s = formatUnits(amount, 6);
  const [w, f = ""] = s.split(".");
  return `${w}.${(f + "00").slice(0, 2)}`;
}
