import { z } from "zod";

/**
 * Conta DEMONSTRATIVA. Nenhum dinheiro real, corretora ou ordem real está envolvido.
 *
 * Modelo (sem alavancagem, 1x):
 *  - O usuário informa o valor da operação (USDT) = capital alocado (margem).
 *  - quantidade = valor / preço de entrada.
 *  - COMPRA: resultado = (preço atual − entrada) × quantidade.
 *  - VENDA (short): resultado = (entrada − preço atual) × quantidade.
 *  - Custo demonstrativo: FEE_RATE sobre o valor nocional, na abertura e no encerramento.
 *  - A perda de uma posição é limitada ao capital alocado (sem saldo negativo).
 *  - Patrimônio = saldo disponível + Σ (capital alocado + resultado não realizado).
 */
export type Side = "buy" | "sell";
export const FEE_RATE = 0.001; // 0,1% por lado (demonstrativo)
export const MIN_AMOUNT = 10; // valor mínimo por operação (USDT)
export const DEFAULT_BALANCE = 10000;
export const MIN_BALANCE = 100;
export const MAX_BALANCE = 100_000_000;
const MAX_HISTORY = 500;
export const STORAGE_KEY = "tordin.demo-account.v1";
/** Durações disponíveis para operações demonstrativas com temporizador (segundos). */
export const DURATION_STEPS = [15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600] as const;
export const DEFAULT_DURATION = 60;
export type CloseReason = "manual" | "expiry";

export type Position = {
  id: string;
  symbol: string;
  side: Side;
  qty: number;
  entryPrice: number;
  amount: number; // capital alocado
  openFee: number;
  openedAt: number; // ms
  /** Duração escolhida (s) e instante de encerramento automático (ms). Ausentes em posições antigas. */
  durationSec?: number;
  expiresAt?: number;
};
export type ClosedTrade = Position & {
  exitPrice: number;
  closeFee: number;
  pnl: number;
  closedAt: number;
  closeReason?: CloseReason;
};
export type MovementKind = "inicial" | "abertura" | "encerramento" | "redefinicao";
export type Movement = {
  id: string;
  time: number;
  kind: MovementKind;
  delta: number;
  balanceAfter: number;
  note: string;
};
export type Account = {
  initialBalance: number;
  cash: number;
  seq: number;
  positions: Position[];
  closed: ClosedTrade[];
  movements: Movement[];
};

const num = z.number().finite();
const positionSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  qty: num.positive(),
  entryPrice: num.positive(),
  amount: num.positive(),
  openFee: num.min(0),
  openedAt: num.nonnegative(),
  durationSec: num.positive().optional(),
  expiresAt: num.nonnegative().optional(),
});
const closedSchema = positionSchema.extend({
  exitPrice: num.positive(),
  closeFee: num.min(0),
  pnl: num,
  closedAt: num.nonnegative(),
  closeReason: z.enum(["manual", "expiry"]).optional(),
});
const movementSchema = z.object({
  id: z.string().min(1),
  time: num.nonnegative(),
  kind: z.enum(["inicial", "abertura", "encerramento", "redefinicao"]),
  delta: num,
  balanceAfter: num,
  note: z.string(),
});
const accountSchema = z.object({
  initialBalance: num.min(MIN_BALANCE).max(MAX_BALANCE),
  cash: num.min(0),
  seq: num.int().nonnegative(),
  positions: z.array(positionSchema),
  closed: z.array(closedSchema),
  movements: z.array(movementSchema),
});

export function createAccount(initialBalance = DEFAULT_BALANCE, now = Date.now()): Account {
  const balance = clampBalance(initialBalance);
  return {
    initialBalance: balance,
    cash: balance,
    seq: 1,
    positions: [],
    closed: [],
    movements: [
      {
        id: `m-${now}-0`,
        time: now,
        kind: "inicial",
        delta: balance,
        balanceAfter: balance,
        note: "Saldo inicial demonstrativo",
      },
    ],
  };
}
export function clampBalance(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BALANCE;
  return Math.min(MAX_BALANCE, Math.max(MIN_BALANCE, Math.round(value * 100) / 100));
}

/** Resultado não realizado, já limitado ao capital alocado (sem custo de saída). */
export function unrealizedPnl(
  p: Pick<Position, "side" | "qty" | "entryPrice" | "amount">,
  price: number,
): number {
  const raw = p.side === "buy" ? (price - p.entryPrice) * p.qty : (p.entryPrice - price) * p.qty;
  return Math.max(raw, -p.amount);
}
export function allocated(a: Account): number {
  return a.positions.reduce((sum, p) => sum + p.amount, 0);
}
export function equity(a: Account, prices: Record<string, number | undefined>): number {
  return (
    a.cash +
    a.positions.reduce((sum, p) => {
      const price = prices[p.symbol];
      return sum + p.amount + (price ? unrealizedPnl(p, price) : 0);
    }, 0)
  );
}
export function realizedPnl(a: Account): number {
  return a.closed.reduce((sum, t) => sum + t.pnl, 0);
}

export type OpenInput = {
  symbol: string;
  side: Side;
  amount: number;
  price: number;
  now?: number;
  /** Duração em segundos; quando informada a posição é encerrada automaticamente ao expirar. */
  durationSec?: number;
};
export type Result = { ok: true; account: Account } | { ok: false; error: string };

export function openPosition(a: Account, input: OpenInput): Result {
  const { symbol, side, amount, price } = input;
  const now = input.now ?? Date.now();
  if (!Number.isFinite(price) || price <= 0)
    return { ok: false, error: "Preço de mercado indisponível. Aguarde a atualização." };
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT)
    return { ok: false, error: `Valor mínimo por operação: ${MIN_AMOUNT} USDT.` };
  if (
    input.durationSec !== undefined &&
    (!Number.isFinite(input.durationSec) || input.durationSec < 1)
  )
    return { ok: false, error: "Duração da operação inválida." };
  const fee = amount * FEE_RATE;
  if (amount + fee > a.cash + 1e-9)
    return { ok: false, error: "Saldo disponível insuficiente (valor + taxa)." };
  const position: Position = {
    id: `p-${now}-${a.seq}`,
    symbol,
    side,
    qty: amount / price,
    entryPrice: price,
    amount,
    openFee: fee,
    openedAt: now,
    ...(input.durationSec !== undefined
      ? { durationSec: input.durationSec, expiresAt: now + input.durationSec * 1000 }
      : {}),
  };
  const cash = a.cash - amount - fee;
  const movement: Movement = {
    id: `m-${now}-${a.seq}`,
    time: now,
    kind: "abertura",
    delta: -(amount + fee),
    balanceAfter: cash,
    note: `${side === "buy" ? "Compra" : "Venda"} ${symbol} @ ${price}`,
  };
  return {
    ok: true,
    account: {
      ...a,
      cash,
      seq: a.seq + 1,
      positions: [...a.positions, position],
      movements: [...a.movements, movement].slice(-MAX_HISTORY),
    },
  };
}

export function closePosition(
  a: Account,
  id: string,
  price: number,
  now = Date.now(),
  reason: CloseReason = "manual",
): Result {
  const p = a.positions.find((x) => x.id === id);
  if (!p) return { ok: false, error: "Posição não encontrada." };
  if (!Number.isFinite(price) || price <= 0)
    return { ok: false, error: "Preço de mercado indisponível. Aguarde a atualização." };
  const pnlGross = unrealizedPnl(p, price);
  const closeFee = p.qty * price * FEE_RATE;
  const pnl = pnlGross - p.openFee - closeFee; // resultado líquido das taxas
  const cash = Math.max(0, a.cash + p.amount + pnlGross - closeFee);
  const trade: ClosedTrade = {
    ...p,
    exitPrice: price,
    closeFee,
    pnl,
    closedAt: now,
    closeReason: reason,
  };
  const movement: Movement = {
    id: `m-${now}-${a.seq}`,
    time: now,
    kind: "encerramento",
    delta: cash - a.cash,
    balanceAfter: cash,
    note: `Encerramento${reason === "expiry" ? " por tempo" : ""} ${p.side === "buy" ? "compra" : "venda"} ${p.symbol} @ ${price}`,
  };
  return {
    ok: true,
    account: {
      ...a,
      cash,
      seq: a.seq + 1,
      positions: a.positions.filter((x) => x.id !== id),
      closed: [...a.closed, trade].slice(-MAX_HISTORY),
      movements: [...a.movements, movement].slice(-MAX_HISTORY),
    },
  };
}

/** Segundos restantes (arredondado para cima) até o encerramento automático; null se não houver prazo. */
export function remainingSeconds(p: Pick<Position, "expiresAt">, now: number): number | null {
  if (p.expiresAt === undefined) return null;
  return Math.max(0, Math.ceil((p.expiresAt - now) / 1000));
}

/**
 * Encerra, pelo último preço conhecido, todas as posições com prazo vencido.
 * Posições cujo ativo ainda não tem preço disponível permanecem abertas até haver cotação.
 */
export function settleExpired(
  a: Account,
  prices: Record<string, number | undefined>,
  now = Date.now(),
): { account: Account; settled: ClosedTrade[] } {
  let account = a;
  const settled: ClosedTrade[] = [];
  for (const p of a.positions) {
    if (p.expiresAt === undefined || p.expiresAt > now) continue;
    const price = prices[p.symbol];
    if (!price || !Number.isFinite(price) || price <= 0) continue;
    const r = closePosition(account, p.id, price, now, "expiry");
    if (r.ok) {
      account = r.account;
      settled.push(r.account.closed[r.account.closed.length - 1]!);
    }
  }
  return { account, settled };
}

export function resetAccount(initialBalance: number, now = Date.now()): Account {
  const fresh = createAccount(initialBalance, now);
  return {
    ...fresh,
    movements: [
      { ...fresh.movements[0]!, kind: "redefinicao", note: "Conta demonstrativa redefinida" },
    ],
  };
}

export function parseAccount(raw: string | null): Account | null {
  if (!raw) return null;
  try {
    const parsed = accountSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as Account) : null;
  } catch {
    return null;
  }
}
export function loadAccount(storage: Pick<Storage, "getItem"> | undefined): Account | null {
  try {
    return parseAccount(storage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}
export function saveAccount(storage: Pick<Storage, "setItem"> | undefined, a: Account): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch {
    /* armazenamento indisponível */
  }
}
