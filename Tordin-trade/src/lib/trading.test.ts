import { describe, expect, it } from "vitest";
import {
  allocated,
  closePosition,
  createAccount,
  equity,
  FEE_RATE,
  loadAccount,
  openPosition,
  parseAccount,
  realizedPnl,
  remainingSeconds,
  resetAccount,
  settleExpired,
  saveAccount,
  STORAGE_KEY,
  unrealizedPnl,
  type Account,
  type Result,
} from "./trading";

const ok = (r: Result): Account => {
  if (!r.ok) throw new Error(r.error);
  return r.account;
};
const fresh = () => createAccount(10000, 1000);

describe("conta demonstrativa", () => {
  it("abre COMPRA: quantidade, capital alocado, taxa e saldo", () => {
    const a = ok(
      openPosition(fresh(), {
        symbol: "BTCUSDT",
        side: "buy",
        amount: 1000,
        price: 50000,
        now: 2000,
      }),
    );
    const p = a.positions[0]!;
    expect(p.qty).toBeCloseTo(0.02);
    expect(p.entryPrice).toBe(50000);
    expect(a.cash).toBeCloseTo(10000 - 1000 - 1000 * FEE_RATE);
    expect(allocated(a)).toBe(1000);
  });
  it("COMPRA: lucro quando o preço sobe, prejuízo quando cai", () => {
    const p = { side: "buy" as const, qty: 0.02, entryPrice: 50000, amount: 1000 };
    expect(unrealizedPnl(p, 55000)).toBeCloseTo(100);
    expect(unrealizedPnl(p, 45000)).toBeCloseTo(-100);
  });
  it("VENDA: lucro quando o preço cai, prejuízo quando sobe", () => {
    const p = { side: "sell" as const, qty: 0.02, entryPrice: 50000, amount: 1000 };
    expect(unrealizedPnl(p, 45000)).toBeCloseTo(100);
    expect(unrealizedPnl(p, 55000)).toBeCloseTo(-100);
  });
  it("a perda é limitada ao capital alocado (venda com alta extrema)", () => {
    expect(unrealizedPnl({ side: "sell", qty: 1, entryPrice: 100, amount: 100 }, 1000)).toBe(-100);
  });
  it("encerra COMPRA com lucro: saldo, histórico e resultado líquido das taxas", () => {
    let a = ok(
      openPosition(fresh(), {
        symbol: "BTCUSDT",
        side: "buy",
        amount: 1000,
        price: 50000,
        now: 2000,
      }),
    );
    a = ok(closePosition(a, a.positions[0]!.id, 55000, 3000));
    const closeFee = 0.02 * 55000 * FEE_RATE;
    expect(a.positions).toHaveLength(0);
    expect(a.closed).toHaveLength(1);
    expect(a.closed[0]!.pnl).toBeCloseTo(100 - 1 - closeFee);
    expect(a.cash).toBeCloseTo(10000 + 100 - 1 - closeFee);
    expect(realizedPnl(a)).toBeCloseTo(a.cash - 10000);
  });
  it("encerra VENDA com prejuízo", () => {
    let a = ok(
      openPosition(fresh(), {
        symbol: "ETHUSDT",
        side: "sell",
        amount: 500,
        price: 2000,
        now: 2000,
      }),
    );
    a = ok(closePosition(a, a.positions[0]!.id, 2200, 3000));
    expect(a.closed[0]!.pnl).toBeLessThan(-50);
    expect(a.cash).toBeCloseTo(10000 + a.closed[0]!.pnl);
  });
  it("patrimônio = saldo + capital alocado + resultado não realizado", () => {
    const a = ok(
      openPosition(fresh(), {
        symbol: "BTCUSDT",
        side: "buy",
        amount: 1000,
        price: 50000,
        now: 2000,
      }),
    );
    expect(equity(a, { BTCUSDT: 50000 })).toBeCloseTo(10000 - 1);
    expect(equity(a, { BTCUSDT: 55000 })).toBeCloseTo(10000 - 1 + 100);
  });
  it("rejeita saldo insuficiente, valor mínimo e preço inválido", () => {
    expect(
      openPosition(fresh(), { symbol: "BTCUSDT", side: "buy", amount: 10000, price: 1 }).ok,
    ).toBe(false);
    expect(openPosition(fresh(), { symbol: "BTCUSDT", side: "buy", amount: 5, price: 1 }).ok).toBe(
      false,
    );
    expect(
      openPosition(fresh(), { symbol: "BTCUSDT", side: "buy", amount: 100, price: 0 }).ok,
    ).toBe(false);
    expect(
      openPosition(fresh(), { symbol: "BTCUSDT", side: "buy", amount: NaN, price: 1 }).ok,
    ).toBe(false);
  });
  it("não encerra posição inexistente nem com preço inválido", () => {
    const a = ok(
      openPosition(fresh(), { symbol: "BTCUSDT", side: "buy", amount: 100, price: 10, now: 2000 }),
    );
    expect(closePosition(a, "x", 10).ok).toBe(false);
    expect(closePosition(a, a.positions[0]!.id, NaN).ok).toBe(false);
  });
  it("ids únicos para operações no mesmo instante", () => {
    let a = fresh();
    a = ok(openPosition(a, { symbol: "BTCUSDT", side: "buy", amount: 100, price: 10, now: 2000 }));
    a = ok(openPosition(a, { symbol: "BTCUSDT", side: "buy", amount: 100, price: 10, now: 2000 }));
    expect(new Set(a.positions.map((p) => p.id)).size).toBe(2);
  });
  it("redefine a conta com saldo configurável", () => {
    const a = resetAccount(2500, 5000);
    expect(a.cash).toBe(2500);
    expect(a.positions).toHaveLength(0);
    expect(a.movements[0]!.kind).toBe("redefinicao");
  });
});

describe("persistência", () => {
  const store = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      m,
    };
  };
  it("salva e recarrega posições e saldo sem inconsistência", () => {
    const s = store();
    const a = ok(
      openPosition(fresh(), {
        symbol: "BTCUSDT",
        side: "buy",
        amount: 1000,
        price: 50000,
        now: 2000,
      }),
    );
    saveAccount(s, a);
    expect(s.m.has(STORAGE_KEY)).toBe(true);
    expect(loadAccount(s)).toEqual(a);
  });
  it("descarta dados corrompidos ou inválidos", () => {
    expect(parseAccount("{nao-json")).toBeNull();
    expect(parseAccount(JSON.stringify({ ...fresh(), cash: -5 }))).toBeNull();
    expect(parseAccount(JSON.stringify({ ...fresh(), positions: [{ id: "x" }] }))).toBeNull();
    expect(parseAccount(null)).toBeNull();
  });
});

describe("operações com temporizador", () => {
  const open = (durationSec?: number, now = 1_000_000) =>
    ok(
      openPosition(fresh(), {
        symbol: "BTCUSDT",
        side: "buy",
        amount: 1000,
        price: 50000,
        now,
        ...(durationSec !== undefined ? { durationSec } : {}),
      }),
    );
  it("registra duração e instante de expiração", () => {
    const a = open(60);
    expect(a.positions[0]!.durationSec).toBe(60);
    expect(a.positions[0]!.expiresAt).toBe(1_060_000);
    expect(remainingSeconds(a.positions[0]!, 1_000_000)).toBe(60);
    expect(remainingSeconds(a.positions[0]!, 1_059_001)).toBe(1);
    expect(remainingSeconds(a.positions[0]!, 1_070_000)).toBe(0);
  });
  it("sem duração não há prazo e nada é encerrado automaticamente", () => {
    const a = open(undefined);
    expect(remainingSeconds(a.positions[0]!, 5)).toBeNull();
    expect(settleExpired(a, { BTCUSDT: 60000 }, 9_999_999).settled).toHaveLength(0);
  });
  it("rejeita duração inválida", () => {
    const r = openPosition(fresh(), {
      symbol: "BTCUSDT",
      side: "buy",
      amount: 1000,
      price: 50000,
      durationSec: 0,
    });
    expect(r.ok).toBe(false);
  });
  it("não encerra antes do prazo", () => {
    const a = open(60);
    const r = settleExpired(a, { BTCUSDT: 55000 }, 1_059_999);
    expect(r.settled).toHaveLength(0);
    expect(r.account).toBe(a);
  });
  it("encerra no prazo pelo último preço, atualiza saldo e histórico", () => {
    const a = open(60);
    const { account, settled } = settleExpired(a, { BTCUSDT: 55000 }, 1_060_000);
    expect(settled).toHaveLength(1);
    expect(account.positions).toHaveLength(0);
    expect(account.closed).toHaveLength(1);
    const t = account.closed[0]!;
    expect(t.closeReason).toBe("expiry");
    expect(t.exitPrice).toBe(55000);
    // 1000 USDT em 50000 → 0,02 BTC; +5000 de preço → +100 bruto, menos taxas.
    expect(t.pnl).toBeCloseTo(100 - a.positions[0]!.openFee - 0.02 * 55000 * FEE_RATE, 6);
    expect(account.cash).toBeCloseTo(a.cash + 1000 + 100 - 0.02 * 55000 * FEE_RATE, 6);
    expect(account.movements.at(-1)!.note).toContain("por tempo");
  });
  it("sem preço do ativo a posição segue aberta até haver cotação", () => {
    const a = open(30);
    const r = settleExpired(a, {}, 2_000_000);
    expect(r.settled).toHaveLength(0);
    expect(r.account.positions).toHaveLength(1);
    expect(settleExpired(a, { BTCUSDT: 49000 }, 2_000_001).settled).toHaveLength(1);
  });
  it("encerrar duas vezes é impossível (sem duplicar resultado)", () => {
    const a = open(30);
    const first = settleExpired(a, { BTCUSDT: 51000 }, 2_000_000);
    const second = settleExpired(first.account, { BTCUSDT: 52000 }, 2_000_100);
    expect(second.settled).toHaveLength(0);
    expect(second.account.closed).toHaveLength(1);
  });
  it("salva e recarrega posições com prazo", () => {
    const a = open(120);
    const store: Record<string, string> = {};
    saveAccount({ setItem: (k, v) => void (store[k] = v) }, a);
    const back = loadAccount({ getItem: (k) => store[k] ?? null });
    expect(back?.positions[0]?.expiresAt).toBe(1_120_000);
  });
});
