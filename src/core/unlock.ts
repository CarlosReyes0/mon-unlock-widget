import { createPublicClient, createWalletClient, custom, keccak256, toBytes, type Address, type Hash } from "viem";
import { monadMainnet } from "./chains.js";
import type { UnlockRecord } from "./types.js";

function toArticleId(articleId: string): `0x${string}` {
  return keccak256(toBytes(articleId));
}

const STORAGE_KEY = "mon-unlock-widget";

export class UnlockStore {
  private cache: UnlockRecord[] = [];

  load(): UnlockRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.cache = raw ? (JSON.parse(raw) as UnlockRecord[]) : [];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  isUnlocked(articleId: string, wallet: string): boolean {
    this.load();
    const w = wallet.toLowerCase();
    return this.cache.some(
      (u) => u.articleId === articleId && u.wallet.toLowerCase() === w
    );
  }

  record(record: UnlockRecord): void {
    this.load();
    if (
      this.cache.some(
        (u) =>
          u.articleId === record.articleId &&
          u.wallet.toLowerCase() === record.wallet.toLowerCase()
      )
    ) {
      return;
    }
    this.cache.push(record);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
  }
}

/** MVP: simulated MON payment (no onchain tx yet) */
export class UnlockService {
  private store = new UnlockStore();

  hasAccess(articleId: string, wallet: string | null): boolean {
    if (!wallet) return false;
    return this.store.isUnlocked(articleId, wallet);
  }

  async unlock(articleId: string, wallet: string): Promise<UnlockRecord> {
    await new Promise((r) => setTimeout(r, 600));

    const record: UnlockRecord = {
      articleId,
      wallet,
      unlockedAt: Date.now(),
      mode: "demo",
    };

    this.store.record(record);
    return record;
  }
}

/** Phase 1.2: real MON payment on Monad mainnet via viem */
export class OnchainUnlockService {
  private store = new UnlockStore();
  private contractAddress: Address;
  private chain = monadMainnet;

  constructor(contractAddress: Address) {
    this.contractAddress = contractAddress;
  }

  hasAccess(articleId: string, wallet: string | null): boolean {
    if (!wallet) return false;
    return this.store.isUnlocked(articleId, wallet);
  }

  /** Phase 1.3: query on-chain truth (source of authority) */
  async checkOnchainAccess(articleId: string, wallet: string | null): Promise<boolean> {
    if (!wallet) return false;

    const eth = (globalThis as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
    if (!eth) return this.store.isUnlocked(articleId, wallet); // fallback to cache

    const publicClient = createPublicClient({ chain: this.chain, transport: custom(eth) });
    const articleIdBytes = toArticleId(articleId);

    const unlocked = (await publicClient.readContract({
      address: this.contractAddress,
      abi: [
        {
          name: "hasUnlocked",
          type: "function",
          stateMutability: "view",
          inputs: [
            { name: "reader", type: "address" },
            { name: "articleId", type: "bytes32" },
          ],
          outputs: [{ type: "bool" }],
        },
      ],
      functionName: "hasUnlocked",
      args: [wallet as Address, articleIdBytes],
    })) as boolean;

    // If on-chain says true, persist to local cache so future loads are instant
    if (unlocked) {
      this.store.record({
        articleId,
        wallet,
        unlockedAt: Date.now(),
        mode: "onchain",
      });
    }

    return unlocked;
  }

  async unlock(articleId: string, wallet: string, priceMon: bigint): Promise<UnlockRecord> {
    const eth = (globalThis as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
    if (!eth) throw new Error("No wallet found. Install MetaMask or another Web3 wallet.");

    const publicClient = createPublicClient({ chain: this.chain, transport: custom(eth) });
    const walletClient = createWalletClient({ chain: this.chain, transport: custom(eth) });

    const account = wallet as Address;
    const articleIdBytes = toArticleId(articleId);

    // Send the unlock transaction (payable)
    const txHash = (await walletClient.writeContract({
      account,
      address: this.contractAddress,
      abi: [
        {
          name: "unlock",
          type: "function",
          stateMutability: "payable",
          inputs: [{ name: "articleId", type: "bytes32" }],
          outputs: [],
        },
      ],
      functionName: "unlock",
      args: [articleIdBytes],
      value: priceMon,
    })) as Hash;

    // Wait for confirmation
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    const record: UnlockRecord = {
      articleId,
      wallet,
      unlockedAt: Date.now(),
      mode: "onchain",
      txHash,
    };

    this.store.record(record);
    return record;
  }

  /** Register an article as the connected publisher (Phase 2 writer dashboard) */
  async registerArticle(articleId: string, wallet: string, priceMon: bigint): Promise<Hash> {
    const eth = (globalThis as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
    if (!eth) throw new Error("No wallet found. Install MetaMask or another Web3 wallet.");

    const walletClient = createWalletClient({ chain: this.chain, transport: custom(eth) });

    const account = wallet as Address;
    const articleIdBytes = toArticleId(articleId);

    const txHash = (await walletClient.writeContract({
      account,
      address: this.contractAddress,
      abi: [
        {
          name: "registerArticle",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [
            { name: "articleId", type: "bytes32" },
            { name: "priceWei", type: "uint256" },
          ],
          outputs: [],
        },
      ],
      functionName: "registerArticle",
      args: [articleIdBytes, priceMon],
    })) as Hash;

    return txHash;
  }
}
