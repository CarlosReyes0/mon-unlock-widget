import type { WalletState } from "./types.js";

const DEMO_ADDRESS = "0xDemo0000000000000000000000000000000001";

/** MVP: wallet connect; uses demo address when no extension (local demo only) */
export class WalletManager {
  private listeners = new Set<(s: WalletState) => void>();
  private state: WalletState = {
    connected: false,
    address: null,
  };

  subscribe(fn: (s: WalletState) => void) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  async connect(): Promise<WalletState> {
    const eth = (globalThis as { ethereum?: { request: (a: { method: string }) => Promise<unknown> } })
      .ethereum;

    if (eth) {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No account selected");
      this.state = { connected: true, address };
    } else if (import.meta.env.DEV) {
      // No MetaMask — still unlock in local demo
      this.state = { connected: true, address: DEMO_ADDRESS };
    } else {
      throw new Error("Install a Web3 wallet (e.g. MetaMask) to unlock articles.");
    }

    this.emit();
    return this.state;
  }

  disconnect() {
    this.state = { connected: false, address: null };
    this.emit();
  }
}

export function truncateAddress(addr: string): string {
  if (addr.startsWith("0xDemo")) return "Demo wallet";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
