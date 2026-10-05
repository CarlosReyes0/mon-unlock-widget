import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hash,
} from "viem";
import { monadMainnet } from "../core/chains.js";
import { buildEmbedSignMessage } from "../core/embed-signature.js";
import { MAINNET_USDC_UNLOCK_CONTRACT } from "../core/payment-asset.js";
import { usdcAtomicForCents } from "../core/article-price.js";
import { mapWalletSendToEthSend, type Eip1193Provider } from "../core/wallet.js";

const UPDATE_PRICE_ABI = [
  {
    name: "updatePrice",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "articleId", type: "bytes32" },
      { name: "priceWei", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** Publisher updatePrice on ArticleUnlockUsdc, then a new embed signature for that price. */
export async function pushUsdcListingPrice(input: {
  slug: string;
  publisher: Address;
  provider: Eip1193Provider;
  priceCents: number;
}): Promise<`0x${string}`> {
  const priceWei = usdcAtomicForCents(input.priceCents);
  const contract = MAINNET_USDC_UNLOCK_CONTRACT as Address;
  const eth = mapWalletSendToEthSend(input.provider);
  const account = input.publisher;
  const walletClient = createWalletClient({
    account,
    chain: monadMainnet,
    transport: custom(eth),
  });
  const message = buildEmbedSignMessage({
    chainId: monadMainnet.id,
    contract,
    articleId: input.slug,
    priceWei,
  });
  const embedSig = await walletClient.signMessage({ account, message });
  const data = encodeFunctionData({
    abi: UPDATE_PRICE_ABI,
    functionName: "updatePrice",
    args: [keccak256(toBytes(input.slug)), priceWei],
  });
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from: account, to: contract, data }],
  })) as Hash;
  const publicClient = createPublicClient({
    chain: monadMainnet,
    transport: http("https://rpc.monad.xyz"),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("The price update did not confirm on Monad.");
  }
  return embedSig;
}
