import type { WalletState } from "./types.js";
import type { Chain } from "viem";
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import { monadMainnet } from "./chains.js";

const DEMO_ADDRESS = "0xDemo0000000000000000000000000000000001";
const CONNECT_TIMEOUT_MS = 180_000;
const CHAIN_SWITCH_TIMEOUT_MS = 120_000;

export type Eip1193Provider = { request: (args: any) => Promise<unknown> };

export type PickableWallet = {
  address: string;
  walletClientType: string;
};

/**
 * Prefer a linked injected wallet over Privy's embedded one.
 * Email/Google login creates an empty embedded wallet; if the user also connected
 * MetaMask (or similar), that is the address they expect to publish from.
 */
export function pickPublisherWallet<T extends PickableWallet>(
  wallets: T[],
  preferredAddress?: string | null
): T | null {
  if (!wallets.length) return null;
  const pref = preferredAddress?.trim().toLowerCase();
  if (pref) {
    const match = wallets.find((w) => w.address.toLowerCase() === pref);
    if (match) return match;
  }
  const external = [...wallets]
    .reverse()
    .find((w) => w.walletClientType !== "privy");
  if (external) return external;
  return wallets.find((w) => w.walletClientType === "privy") || wallets[0];
}

/** Address of an external wallet that appeared since the last snapshot, if any. */
export function newestExternalWalletAddress(
  previousAddresses: string[],
  wallets: PickableWallet[]
): string | null {
  const prev = new Set(previousAddresses.map((a) => a.toLowerCase()));
  const added = wallets.filter(
    (w) => w.walletClientType !== "privy" && !prev.has(w.address.toLowerCase())
  );
  return added.length ? added[added.length - 1].address : null;
}

/**
 * Viem retries failed `eth_sendTransaction` as `wallet_sendTransaction`.
 * Privy forwards unknown methods to the chain RPC (https://rpc.monad.xyz),
 * which does not support that wallet-namespace method.
 */
export function mapWalletSendToEthSend(eth: Eip1193Provider): Eip1193Provider {
  return {
    request: (args) => {
      if (args?.method === "wallet_sendTransaction") {
        return eth.request({ ...args, method: "eth_sendTransaction" });
      }
      return eth.request(args);
    },
  };
}

type WalletConnectProvider = Awaited<ReturnType<typeof EthereumProvider.init>>;

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** True when the page runs inside MetaMask/Coinbase in-app browser with injected ethereum. */
export function hasReliableInjectedProvider(): boolean {
  const eth = (globalThis as {
    ethereum?: Eip1193Provider & {
      isMetaMask?: boolean;
      isCoinbaseWallet?: boolean;
      providers?: Array<{ isMetaMask?: boolean; isCoinbaseWallet?: boolean }>;
    };
  }).ethereum;
  if (!eth) return false;
  if (eth.isMetaMask || eth.isCoinbaseWallet) return true;
  return Boolean(eth.providers?.some((p) => p.isMetaMask || p.isCoinbaseWallet));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function walletConnectHasSession(wc: WalletConnectProvider): boolean {
  if (wc.accounts?.length) return true;
  const accounts = wc.session?.namespaces?.eip155?.accounts;
  return Boolean(accounts && accounts.length > 0);
}

function walletConnectAddress(wc: WalletConnectProvider): string | null {
  if (wc.accounts?.[0]) return wc.accounts[0];
  const sessionAccount = wc.session?.namespaces?.eip155?.accounts?.[0];
  if (!sessionAccount) return null;
  const parts = sessionAccount.split(":");
  return parts[parts.length - 1] ?? null;
}

async function requestAccounts(provider: Eip1193Provider): Promise<string> {
  let accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  if (!accounts[0]) {
    accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  }
  const address = accounts[0];
  if (!address) throw new Error("No account selected");
  return address;
}

/** WalletManager supports injected (window.ethereum), WalletConnect, or demo fallback. */
export class WalletManager {
  private listeners = new Set<(s: WalletState) => void>();
  private state: WalletState = { connected: false, address: null };
  private provider: Eip1193Provider | null = null;
  private wcProvider: WalletConnectProvider | null = null;
  private wcProjectId: string | null = null;
  private usingWalletConnect = false;

  /** Set the WalletConnect project ID (required for mobile / WalletConnect flow). */
  setWalletConnectProjectId(id: string) {
    this.wcProjectId = id || null;
  }

  getProvider(): Eip1193Provider | null {
    return this.provider;
  }

  isUsingWalletConnect(): boolean {
    return this.usingWalletConnect;
  }

  subscribe(fn: (s: WalletState) => void) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  async connect(): Promise<WalletState> {
    const injected = (globalThis as { ethereum?: Eip1193Provider }).ethereum;
    // Mobile Safari: use WalletConnect. MetaMask/Coinbase in-app browsers: use injected.
    const preferWalletConnect =
      Boolean(this.wcProjectId) && isMobileDevice() && !hasReliableInjectedProvider();

    this.usingWalletConnect = false;

    if (preferWalletConnect) {
      await this.connectViaWalletConnect();
    } else if (injected) {
      await this.connectViaInjected(injected);
    } else if (this.wcProjectId) {
      await this.connectViaWalletConnect();
    } else if (import.meta.env.DEV) {
      this.provider = null;
      this.state = { connected: true, address: DEMO_ADDRESS };
    } else {
      throw new Error(
        "Install a Web3 wallet (e.g. MetaMask) or provide a WalletConnect project ID for mobile."
      );
    }

    this.emit();
    return this.state;
  }

  private async connectViaInjected(injected: Eip1193Provider): Promise<void> {
    this.provider = injected;
    await withTimeout(
      injected.request({ method: "eth_requestAccounts" }),
      CONNECT_TIMEOUT_MS,
      "Wallet connection timed out. Open your wallet app and try again."
    );
    const address = await requestAccounts(injected);
    this.state = { connected: true, address };
  }

  /** Initialize WalletConnect without the built-in modal and return the connection URI for custom QR rendering. */
  async beginWalletConnectQr(): Promise<string> {
    if (this.wcProvider) {
      // If we already have a provider with a URI, return it (rare).
      const uri = (this.wcProvider as any).uri;
      if (uri) return uri;
    }
    if (!this.wcProjectId) {
      throw new Error("WalletConnect project ID is not configured.");
    }

    const provider = await withTimeout(
      EthereumProvider.init({
        projectId: this.wcProjectId,
        chains: [1],
        optionalChains: [monadMainnet.id],
        showQrModal: false, // we render our own QR
        rpcMap: {
          [monadMainnet.id]: monadMainnet.rpcUrls.default.http[0],
        },
        metadata: {
          name: "Open Paywall",
          description: "Unlock articles with MON",
          url: typeof window !== "undefined" ? window.location.origin : "https://example.com",
          icons: ["https://mon-unlock-widget-production.up.railway.app/dist/mon-unlock.png"],
        },
      }),
      15_000,
      "WalletConnect initialization timed out."
    );

    this.wcProvider = provider;

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for WalletConnect URI.")), 10_000);

      provider.on("display_uri", (uri: string) => {
        clearTimeout(timeout);
        resolve(uri);
      });

      // Start the connection handshake — this is what emits the pairing URI.
      provider.connect().catch((e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  }

  private async getOrInitWalletConnect(): Promise<WalletConnectProvider> {
    if (this.wcProvider) return this.wcProvider;
    if (!this.wcProjectId) {
      throw new Error("WalletConnect project ID is not configured.");
    }

    try {
      // Handshake on Ethereum (widely supported). Switch to Monad after connect.
      this.wcProvider = await withTimeout(
        EthereumProvider.init({
          projectId: this.wcProjectId,
          chains: [1],
          optionalChains: [monadMainnet.id],
          showQrModal: true,
          rpcMap: {
            [monadMainnet.id]: monadMainnet.rpcUrls.default.http[0],
          },
          metadata: {
            name: "Open Paywall",
            description: "Unlock articles with MON",
            url: typeof window !== "undefined" ? window.location.origin : "https://example.com",
            icons: ["https://mon-unlock-widget-production.up.railway.app/dist/mon-unlock.png"],
          },
        }),
        15_000,
        "WalletConnect initialization timed out. Check your internet connection or try again."
      );
    } catch (err) {
      this.wcProvider = null;
      const msg = err instanceof Error ? err.message : "Failed to initialize WalletConnect.";
      throw new Error(msg);
    }

    return this.wcProvider;
  }

  private async resolveWalletConnectAddress(wc: WalletConnectProvider): Promise<string> {
    const fromSession = walletConnectAddress(wc);
    if (fromSession) return fromSession;
    return requestAccounts(wc as unknown as Eip1193Provider);
  }

  private async connectViaWalletConnect(): Promise<void> {
    const wc = await this.getOrInitWalletConnect();
    this.usingWalletConnect = true;

    if (walletConnectHasSession(wc)) {
      this.provider = wc as unknown as Eip1193Provider;
      const address = await this.resolveWalletConnectAddress(wc);
      this.state = { connected: true, address };
      return;
    }

    await this.connectWalletConnectWithMobileResume(wc);
    this.provider = wc as unknown as Eip1193Provider;
    const address = await this.resolveWalletConnectAddress(wc);
    this.state = { connected: true, address };
  }

  /** iOS often approves WC in the wallet app while the browser tab promise never resolves. */
  private async connectWalletConnectWithMobileResume(wc: WalletConnectProvider): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let pollId: ReturnType<typeof setInterval> | undefined;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (pollId) clearInterval(pollId);
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("pageshow", onVisible);
        wc.removeListener("connect", onConnect);
        wc.removeListener("accountsChanged", onAccounts);
      };

      const finishOk = () => {
        if (settled || !walletConnectHasSession(wc)) return;
        settled = true;
        cleanup();
        resolve();
      };

      const finishErr = (err: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err instanceof Error ? err : new Error("Wallet connection failed."));
      };

      const onConnect = () => finishOk();
      const onAccounts = () => finishOk();
      const onVisible = () => {
        if (document.visibilityState === "visible") finishOk();
      };

      wc.on("connect", onConnect);
      wc.on("accountsChanged", onAccounts);
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("pageshow", onVisible);
      pollId = setInterval(() => finishOk(), 500);

      timeoutId = setTimeout(() => {
        if (walletConnectHasSession(wc)) {
          finishOk();
          return;
        }
        finishErr(
          new Error(
            "Wallet connection timed out. Pick your wallet, approve the connection in the app, then return here and tap Connect again."
          )
        );
      }, CONNECT_TIMEOUT_MS);

      wc.connect()
        .then(() => finishOk())
        .catch((err: unknown) => {
          if (walletConnectHasSession(wc)) {
            finishOk();
            return;
          }
          finishErr(err);
        });
    });
  }

  disconnect() {
    this.state = { connected: false, address: null };
    this.provider = null;
    this.usingWalletConnect = false;
    this.emit();
  }

  async ensureChain(chain: Chain): Promise<void> {
    if (!this.provider) return;

    await withTimeout(
      (async () => {
        const current = (await this.provider!.request({ method: "eth_chainId" })) as string;
        if (parseInt(current, 16) === chain.id) return;

        try {
          await this.provider!.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x" + chain.id.toString(16) }],
          });
        } catch (switchErr: any) {
          if (switchErr?.code === 4902) {
            await this.provider!.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: "0x" + chain.id.toString(16),
                  chainName: chain.name,
                  nativeCurrency: chain.nativeCurrency,
                  rpcUrls: chain.rpcUrls.default.http,
                  blockExplorerUrls: chain.blockExplorers
                    ? [chain.blockExplorers.default.url]
                    : undefined,
                },
              ],
            });
          } else {
            throw switchErr;
          }
        }
      })(),
      CHAIN_SWITCH_TIMEOUT_MS,
      "Network switch timed out. Approve Monad in your wallet app, then tap Connect again."
    );
  }
}

export function truncateAddress(addr: string | null | undefined): string {
  if (!addr) return "Wallet";
  if (addr.startsWith("0xDemo")) return "Demo wallet";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
