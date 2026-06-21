import type { WalletState } from "./types.js";
import type { Chain } from "viem";
import { EthereumProvider } from "@walletconnect/ethereum-provider";

const DEMO_ADDRESS = "0xDemo0000000000000000000000000000000001";

type Eip1193Provider = { request: (args: any) => Promise<unknown> };

/** WalletManager supports injected (window.ethereum), WalletConnect, or demo fallback. */
export class WalletManager {
  private listeners = new Set<(s: WalletState) => void>();
  private state: WalletState = { connected: false, address: null };
  private provider: Eip1193Provider | null = null;
  private wcProjectId: string | null = null;

  /** Set the WalletConnect project ID (required for mobile / WalletConnect flow). */
  setWalletConnectProjectId(id: string) {
    this.wcProjectId = id || null;
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

    if (injected) {
      this.provider = injected;
      const accounts = (await this.provider.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No account selected");
      this.state = { connected: true, address };
    } else if (this.wcProjectId) {
      // Mobile: use WalletConnect (shows QR modal via @walletconnect/modal)
      const wc = await EthereumProvider.init({
        projectId: this.wcProjectId,
        optionalChains: [1, 5600], // Ethereum + Monad (placeholder; actual chain used later)
        showQrModal: true,
        metadata: {
          name: "Mon Unlock",
          description: "Unlock articles with MON",
          url: typeof window !== "undefined" ? window.location.origin : "https://example.com",
          icons: [],
        },
      });
      await wc.connect();
      this.provider = wc as unknown as Eip1193Provider;
      const accounts = (await this.provider.request({ method: "eth_accounts" })) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No account selected");
      this.state = { connected: true, address };
    } else if (import.meta.env.DEV) {
      // Demo fallback (localhost only)
      this.provider = null;
      this.state = { connected: true, address: DEMO_ADDRESS };
    } else {
      throw new Error("Install a Web3 wallet (e.g. MetaMask) or provide a WalletConnect project ID for mobile.");
    }

    this.emit();
    return this.state;
  }

  disconnect() {
    this.state = { connected: false, address: null };
    this.provider = null;
    this.emit();
  }

  async ensureChain(chain: Chain): Promise<void> {
    if (!this.provider) return;

    try {
      const current = (await this.provider.request({ method: "eth_chainId" })) as string;
      if (parseInt(current, 16) === chain.id) return;

      await this.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + chain.id.toString(16) }],
      });
    } catch (switchErr: any) {
      if (switchErr?.code === 4902) {
        await this.provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x" + chain.id.toString(16),
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: chain.rpcUrls.default.http,
              blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
            },
          ],
        });
      } else {
        throw switchErr;
      }
    }
  }
}

export function truncateAddress(addr: string): string {
  if (addr.startsWith("0xDemo")) return "Demo wallet";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
