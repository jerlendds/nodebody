import { disposable, type Disposable } from "../base/disposable";
import type { ContentId } from "./model";
import type { LayoutIntent } from "./intents";

export interface LayoutContributionSink {
  propose(intent: LayoutIntent): Disposable;
  update(intent: LayoutIntent): void;
  remove(intentId: string): void;
}

export class LayoutIntentRegistry {
  private readonly intents = new Map<string, LayoutIntent>();
  private readonly intentOwners = new Map<string, ContentId | string>();

  sink(owner: ContentId | string): LayoutContributionSink {
    return {
      propose: (intent) => {
        this.set(owner, intent);
        return disposable(() => this.remove(intent.id));
      },
      update: (intent) => this.set(owner, intent),
      remove: (intentId) => this.remove(intentId),
    };
  }

  set(owner: ContentId | string, intent: LayoutIntent): void {
    this.intents.set(intent.id, intent);
    this.intentOwners.set(intent.id, owner);
  }

  remove(intentId: string): void {
    this.intents.delete(intentId);
    this.intentOwners.delete(intentId);
  }

  clearOwner(owner: ContentId | string): void {
    for (const [intentId, candidate] of this.intentOwners) {
      if (candidate !== owner) continue;
      this.remove(intentId);
    }
  }

  all(): readonly LayoutIntent[] {
    return [...this.intents.values()];
  }

  ownerOf(intentId: string): ContentId | string | undefined {
    return this.intentOwners.get(intentId);
  }
}
