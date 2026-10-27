/**
 * YG-14: in-app purchases behind config.features.iap. A permanent product (like "no_ads") is never
 * consumed: its effect follows the platform at every launch, its gift comes once. A consumable
 * is granted, saved to the cloud at once, then consumed — a lost connection never loses a
 * purchase. At every launch the platform's purchases the game has not applied are applied
 * (requirement 1.13.1). What each product gives lives in src/content/shop.json; the title,
 * description and price come from the console through the SDK.
 */

import type { Platform, Product } from '../platform/Platform';
import type { ProgressService } from './progress';

export interface ShopProductDef {
  id: string;
  permanent: boolean;
  /** YG-14: a consumable offered once ("starter_pack"): bought — never offered again. */
  once: boolean;
  noAds: boolean;
  /** Gems and gold granted (once for a permanent product, every time for a consumable). */
  gems: number;
  gold: number;
}

export type BuyResult = 'ok' | 'failed';

export class ShopService {
  products: Product[] = [];

  constructor(
    private readonly platform: Platform,
    private readonly progress: ProgressService,
    private readonly defs: readonly ShopProductDef[],
    readonly enabled: boolean,
    /** "No ads" turned on: the banner goes away at once. */
    private readonly onNoAds: () => void,
  ) {}

  /** At launch: the catalog and every purchase the game has not applied yet. */
  async init(): Promise<void> {
    if (!this.enabled) return;
    try {
      const catalog = await this.platform.purchases.catalog();
      // Only products the game knows and the console offers.
      this.products = catalog.filter((p) => this.defs.some((d) => d.id === p.id));
      for (const p of await this.platform.purchases.owned()) {
        await this.apply(p.productID, p.purchaseToken);
      }
    } catch {
      // Purchases are unavailable now; the game works without them.
    }
  }

  async buy(id: string): Promise<BuyResult> {
    try {
      const p = await this.platform.purchases.buy(id);
      await this.apply(p.productID, p.purchaseToken);
      return 'ok';
    } catch {
      // Cancelled, failed or no connection: the player sees "the purchase was not completed".
      return 'failed';
    }
  }

  private async apply(productId: string, token: string): Promise<void> {
    const def = this.defs.find((d) => d.id === productId);
    if (!def) return;
    if (def.permanent) {
      if (def.noAds && !this.progress.data.noAds) {
        this.progress.data.noAds = true;
        this.onNoAds();
      }
      if (!this.progress.seen(`purchase:${def.id}`)) {
        this.grant(def);
        this.progress.markSeen(`purchase:${def.id}`);
      }
      this.progress.commitImportant();
      return;
    }
    this.grant(def);
    // The starter pack is offered once (YG-14); the gold chest joins it with chests in Stage 3.
    if (def.once) this.progress.markSeen(`purchase:${def.id}`);
    this.progress.commitImportant();
    await this.platform.purchases.consume(token);
  }

  private grant(def: ShopProductDef): void {
    this.progress.data.gems += def.gems;
    this.progress.data.gold += def.gold;
  }

  /** YG-14: what the shop offers now — a one-off product disappears once bought. */
  offered(): Product[] {
    return this.products.filter((p) => {
      const def = this.defs.find((d) => d.id === p.id);
      return !def?.once || !this.progress.seen(`purchase:${p.id}`);
    });
  }
}
