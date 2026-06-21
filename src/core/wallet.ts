import type { WalletState } from "./types.js";
import type { Chain } from "viem";
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import { monadMainnet } from "./chains.js";

const DEMO_ADDRESS = "0xDemo0000000000000000000000000000000001";
const CONNECT_TIMEOUT_MS = 90_000;

export type Eip1193Provider = { request: (args: any) => Promise<unknown> };

type WalletConnectProvider = Awaited<ReturnType<typeof EthereumProvider.init>>;

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

async function requestAccounts(provider: Eip1193Provider): Promise<string> {
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
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

  /** Set the WalletConnect project ID (required for mobile / WalletConnect flow). */
  setWalletConnectProjectId(id: string) {
    this.wcProjectId = id || null;
  }

  getProvider(): Eip1193Provider | null {
    return this.provider;
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
    // Mobile browsers often expose a broken injected provider or hang on eth_requestAccounts.
    // Prefer WalletConnect when a project ID is configured.
    const preferWalletConnect = Boolean(this.wcProjectId) && isMobileDevice();

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

  private async getOrInitWalletConnect(): Promise<WalletConnectProvider> {
    if (this.wcProvider) return this.wcProvider;
    if (!this.wcProjectId) {
      throw new Error("WalletConnect project ID is not configured.");
    }

    this.wcProvider = await EthereumProvider.init({
      projectId: this.wcProjectId,
      chains: [monadMainnet.id],
      optionalChains: [1],
      showQrModal: true,
      metadata: {
        name: "Mon Unlock",
        description: "Unlock articles with MON",
        url: typeof window !== "undefined" ? window.location.origin : "https://example.com",
        icons: [],
      },
    });

    return this.wcProvider;
  }

  private async connectViaWalletConnect(): Promise<void> {
    const wc = await this.getOrInitWalletConnect();

    if (wc.session) {
      this.provider = wc as unknown as Eip1193Provider;
      try {
        const address = await requestAccounts(this.provider);
        this.state = { connected: true, address };
        return;
      } catch {
        // Session stale — fall through to a fresh connect.
      }
    }

    await this.connectWalletConnectWithMobileResume(wc);
    this.provider = wc as unknown as Eip1193Provider;
    const address = await requestAccounts(this.provider);
    this.state = { connected: true, address };
  }

  /** iOS often approves WC in the wallet app while the browser tab promise never resolves. */
  private async connectWalletConnectWithMobileResume(wc: WalletConnectProvider): Promise<void> {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let visHandler: (() => void) | undefined;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (visHandler) document.removeEventListener("visibilitychange", visHandler);
    };

    const tryResumeSession = async (): Promise<boolean> => {
      try {
        const accounts = (await wc.request({ method: "eth_accounts" })) as string[];
        return Boolean(accounts[0]);
      } catch {
        return false;
      }
    };

    await new Promise<void>((resolve, reject) => {
      const finishOk = () => {
        if (settled) return;
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

      timeoutId = setTimeout(async () => {
        if (await tryResumeSession()) {
          finishOk();
          return;
        }
        finishErr(
          new Error(
            "Wallet connection timed out. Open your wallet app, approve the connection, then try again."
          )
        );
      }, CONNECT_TIMEOUT_MS);

      visHandler = async () => {
        if (document.visibilityState !== "visible" || settled) return;
        if (await tryResumeSession()) finishOk();
      };
      document.addEventListener("visibilitychange", visHandler);

      wc.connect()
        .then(async () => {
          if (await tryResumeSession()) finishOk();
        })
        .catch(async (err: unknown) => {
          if (await tryResumeSession()) {
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
      CONNECT_TIMEOUT_MS,
      "Network switch timed out. Approve Monad in your wallet app and try again."
    );
  }
}

export function truncateAddress(addr: string): string {
  if (addr.startsWith("0xDemo")) return "Demo wallet";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
