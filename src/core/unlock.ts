import type { UnlockRecord } from "./types.js";

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
