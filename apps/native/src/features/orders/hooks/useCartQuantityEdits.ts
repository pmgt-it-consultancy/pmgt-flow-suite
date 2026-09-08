import { type NavigationAction, usePreventRemove } from "@react-navigation/native";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert } from "react-native";

type Edit = { quantity: number; save: (quantity: number) => void | Promise<void> };

/** Screen-owned edits survive virtualized rows unmounting and serialize database writes. */
export class CartQuantityEdits {
  private pending = new Map<string, Edit>();
  private quantities = new Map<string, number>();
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<Map<string, number>>;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify() {
    for (const listener of this.listeners) listener();
  }

  enqueue(id: string, quantity: number, save: Edit["save"]) {
    this.pending.set(id, { quantity, save });
    this.quantities.set(id, quantity);
    this.notify();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() =>
        Alert.alert(
          "Quantity not saved",
          "Try checkout again to retry saving your quantity changes.",
        ),
      );
    }, 300);
  }

  hasPending = () => {
    return this.pending.size > 0;
  };
  pendingQuantity(id: string) {
    return this.pending.get(id)?.quantity;
  }

  updateSaver(id: string, save: Edit["save"]) {
    const edit = this.pending.get(id);
    if (edit) edit.save = save;
  }

  acknowledge(id: string) {
    if (!this.pending.has(id)) this.quantities.delete(id);
  }

  discard(id?: string) {
    if (id) {
      this.pending.delete(id);
      this.quantities.delete(id);
    } else {
      this.pending.clear();
      this.quantities.clear();
    }
    this.notify();
  }

  flush(): Promise<Map<string, number>> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.running) return this.running;
    const snapshot = new Map(this.quantities);
    const drain = async () => {
      while (this.pending.size) {
        const [id, edit] = this.pending.entries().next().value!;
        await edit.save(edit.quantity);
        snapshot.set(id, edit.quantity);
        if (this.pending.get(id) === edit) this.pending.delete(id);
        this.notify();
      }
      return snapshot;
    };
    this.running = drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
}

export function useCartQuantityEdits() {
  const [edits] = useState(() => new CartQuantityEdits());
  useEffect(
    () => () => {
      void edits
        .flush()
        .catch(() =>
          Alert.alert(
            "Quantity not saved",
            "Return to the order and retry saving your quantity changes.",
          ),
        );
    },
    [edits],
  );
  return edits;
}

/** Native-stack needs usePreventRemove rather than a beforeRemove listener. */
export function usePreventCartEditLoss(
  edits: CartQuantityEdits,
  navigation: { dispatch: (action: NavigationAction) => void },
) {
  const pending = useSyncExternalStore(edits.subscribe, edits.hasPending, edits.hasPending);
  const leaving = useRef(false);
  usePreventRemove(pending, async ({ data }) => {
    if (leaving.current) return;
    leaving.current = true;
    try {
      await edits.flush();
      navigation.dispatch(data.action);
    } catch {
      Alert.alert("Quantity not saved", "Please try again to save your changes before leaving.");
    } finally {
      leaving.current = false;
    }
  });
}
