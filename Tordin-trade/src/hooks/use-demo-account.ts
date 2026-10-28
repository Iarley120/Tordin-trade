import { useCallback, useEffect, useRef, useState } from "react";
import {
  closePosition,
  createAccount,
  loadAccount,
  openPosition,
  parseAccount,
  resetAccount,
  saveAccount,
  settleExpired,
  STORAGE_KEY,
  type Account,
  type ClosedTrade,
  type OpenInput,
  type Result,
} from "@/lib/trading";

/** Conta demonstrativa persistida no navegador (localStorage), sincronizada entre abas. */
export function useDemoAccount() {
  const [account, setAccountState] = useState<Account>(() => createAccount());
  const [ready, setReady] = useState(false);
  const ref = useRef(account);
  const apply = useCallback((next: Account) => {
    ref.current = next;
    setAccountState(next);
  }, []);

  useEffect(() => {
    const stored = loadAccount(typeof localStorage === "undefined" ? undefined : localStorage);
    if (stored) apply(stored);
    setReady(true);
  }, [apply]);
  useEffect(() => {
    if (ready) saveAccount(typeof localStorage === "undefined" ? undefined : localStorage, account);
  }, [account, ready]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = parseAccount(e.newValue);
      if (next) apply(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [apply]);

  const open = useCallback(
    (input: OpenInput): Result => {
      const r = openPosition(ref.current, input);
      if (r.ok) apply(r.account);
      return r;
    },
    [apply],
  );
  const close = useCallback(
    (id: string, price: number): Result => {
      const r = closePosition(ref.current, id, price);
      if (r.ok) apply(r.account);
      return r;
    },
    [apply],
  );
  /** Encerra posições vencidas usando o último preço conhecido de cada ativo. */
  const settle = useCallback(
    (prices: Record<string, number | undefined>, now = Date.now()): ClosedTrade[] => {
      const { account: next, settled } = settleExpired(ref.current, prices, now);
      if (settled.length) apply(next);
      return settled;
    },
    [apply],
  );
  const reset = useCallback(
    (initialBalance: number) => apply(resetAccount(initialBalance)),
    [apply],
  );
  return { account, ready, open, close, settle, reset };
}
