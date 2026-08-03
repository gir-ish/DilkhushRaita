"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface CartLine {
  key: string; // menuItemId + variantId + addOnIds
  menuItemId: string;
  name: string;
  imageEmoji: string;
  veg: boolean;
  variantId?: string | null;
  variantName?: string | null;
  addOnIds: string[];
  addOnNames: string[];
  displayPrice: number; // UI hint only — the server recomputes all prices
  qty: number;
  instructions?: string;
}

interface CartState {
  branchId: string | null;
  branchSlug: string | null;
  branchName: string | null;
  lines: CartLine[];
}

interface CartApi extends CartState {
  count: number;
  displayTotal: number;
  add: (branch: { id: string; slug: string; name: string }, line: Omit<CartLine, "key" | "qty">, qty?: number) => "ok" | "branch-conflict";
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  switchBranch: (branch: { id: string; slug: string; name: string }) => void;
}

const KEY = "dk_cart_v1";
const CartCtx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CartState>({
    branchId: null,
    branchSlug: null,
    branchName: null,
    lines: [],
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setState(JSON.parse(raw));
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(KEY, JSON.stringify(state));
  }, [state, loaded]);

  const add: CartApi["add"] = useCallback(
    (branch, line, qty = 1) => {
      let result: "ok" | "branch-conflict" = "ok";
      setState((s) => {
        if (s.branchId && s.branchId !== branch.id && s.lines.length > 0) {
          result = "branch-conflict";
          return s;
        }
        const key = `${line.menuItemId}|${line.variantId ?? ""}|${[...line.addOnIds].sort().join(",")}`;
        const existing = s.lines.find((l) => l.key === key);
        const lines = existing
          ? s.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(20, l.qty + qty) } : l))
          : [...s.lines, { ...line, key, qty }];
        return { branchId: branch.id, branchSlug: branch.slug, branchName: branch.name, lines };
      });
      return result;
    },
    []
  );

  const setQty = useCallback((key: string, qty: number) => {
    setState((s) => ({
      ...s,
      lines:
        qty <= 0
          ? s.lines.filter((l) => l.key !== key)
          : s.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(20, qty) } : l)),
    }));
  }, []);

  const remove = useCallback((key: string) => {
    setState((s) => ({ ...s, lines: s.lines.filter((l) => l.key !== key) }));
  }, []);

  const clear = useCallback(() => {
    setState({ branchId: null, branchSlug: null, branchName: null, lines: [] });
  }, []);

  const switchBranch = useCallback((branch: { id: string; slug: string; name: string }) => {
    setState({ branchId: branch.id, branchSlug: branch.slug, branchName: branch.name, lines: [] });
  }, []);

  const api = useMemo<CartApi>(
    () => ({
      ...state,
      count: state.lines.reduce((s, l) => s + l.qty, 0),
      displayTotal: state.lines.reduce((s, l) => s + l.displayPrice * l.qty, 0),
      add,
      setQty,
      remove,
      clear,
      switchBranch,
    }),
    [state, add, setQty, remove, clear, switchBranch]
  );

  return <CartCtx.Provider value={api}>{children}</CartCtx.Provider>;
}

export function useCart() {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error("useCart outside CartProvider");
  return ctx;
}
