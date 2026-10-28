import { fmt } from "./market";
import type { ChartTrade } from "./chart-types";

/** Máximo de segmentos entrada→saída desenhados ao mesmo tempo (as operações mais recentes). */
export const MAX_SEGMENTS = 60;

/**
 * Candle (por tempo de abertura) que contém o instante `t`: o último com tempo <= t.
 * Retorna null quando `t` é anterior ao primeiro candle carregado.
 */
export function snapTime(times: readonly number[], t: number): number | null {
  let lo = 0;
  let hi = times.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 ? times[ans]! : null;
}

export type TradeMarker = {
  /** Identificador estável: `<operação>:entry` ou `<operação>:exit`. */
  id: string;
  tradeId: string;
  kind: "entry" | "exit";
  side: "buy" | "sell";
  time: number;
  price: number;
  text: string;
  pnl?: number;
};

const sign = (n: number) => `${n >= 0 ? "+" : "-"}${fmt(Math.abs(n), 2)}`;

/** Um marcador de entrada por operação e um de saída por operação encerrada, no preço real. */
export function tradeMarkers(trades: readonly ChartTrade[], times: readonly number[]): TradeMarker[] {
  const out: TradeMarker[] = [];
  for (const t of trades) {
    const entry = snapTime(times, t.entryTime);
    if (entry !== null)
      out.push({
        id: `${t.id}:entry`,
        tradeId: t.id,
        kind: "entry",
        side: t.side,
        time: entry,
        price: t.entryPrice,
        text: `${t.side === "buy" ? "C" : "V"} ${fmt(t.entryPrice)}`,
      });
    if (t.status === "closed" && t.exitTime !== undefined && t.exitPrice !== undefined) {
      const exit = snapTime(times, t.exitTime);
      if (exit !== null)
        out.push({
          id: `${t.id}:exit`,
          tradeId: t.id,
          kind: "exit",
          side: t.side,
          time: exit,
          price: t.exitPrice,
          text: `S ${sign(t.pnl ?? 0)}`,
          ...(t.pnl !== undefined ? { pnl: t.pnl } : {}),
        });
    }
  }
  return out.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export type TradeSegment = {
  id: string;
  win: boolean;
  points: [{ time: number; value: number }, { time: number; value: number }];
};

/**
 * Segmento que liga a entrada à saída de operações encerradas. Exige candles distintos
 * (a biblioteca só aceita tempos estritamente crescentes); operações que abrem e fecham no
 * mesmo candle mostram apenas os marcadores.
 */
export function tradeSegments(
  trades: readonly ChartTrade[],
  times: readonly number[],
  max = MAX_SEGMENTS,
): TradeSegment[] {
  const out: TradeSegment[] = [];
  for (const t of trades) {
    if (t.status !== "closed" || t.exitTime === undefined || t.exitPrice === undefined) continue;
    const a = snapTime(times, t.entryTime);
    const b = snapTime(times, t.exitTime);
    if (a === null || b === null || a >= b) continue;
    out.push({
      id: t.id,
      win: (t.pnl ?? 0) >= 0,
      points: [
        { time: a, value: t.entryPrice },
        { time: b, value: t.exitPrice },
      ],
    });
  }
  return out.slice(-max);
}

/** Operações com entrada ou saída no candle indicado (várias operações podem coincidir). */
export function tradesAtTime(
  trades: readonly ChartTrade[],
  times: readonly number[],
  time: number,
): ChartTrade[] {
  return trades.filter(
    (t) =>
      snapTime(times, t.entryTime) === time ||
      (t.status === "closed" && t.exitTime !== undefined && snapTime(times, t.exitTime) === time),
  );
}

export const formatTradeTime = (seconds: number) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(seconds * 1000));
