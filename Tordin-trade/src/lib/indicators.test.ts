import { describe, it, expect } from "vitest";
import { sma, ema, rsi } from "./indicators";

describe("indicators", () => {
  it("sma of 1..5 period 3", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("ema seeds with sma then smooths", () => {
    const e = ema([1, 2, 3, 4], 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3);
  });
  it("rsi is 100 on monotonic rise", () => {
    const r = rsi(
      Array.from({ length: 20 }, (_, i) => i),
      14,
    );
    expect(r[19]).toBe(100);
  });
});

import { macd, bollinger, vwap, atr, stochastic, type Candle } from "./indicators";
import { normalizeCandles, mergeCandle } from "./market";
const candles = Array.from({ length: 40 }, (_, i): Candle => ({
  time: 1000 + i * 60,
  open: 10 + i,
  high: 12 + i,
  low: 9 + i,
  close: 11 + i,
  volume: 2,
}));
describe("additional indicators and market normalization", () => {
  it("Bollinger of constant prices has zero width", () => {
    const b = bollinger(Array(20).fill(5) as number[]);
    expect(b.mid.at(-1)).toBe(5);
    expect(b.upper.at(-1)).toBe(5);
    expect(b.lower.at(-1)).toBe(5);
  });
  it("VWAP uses cumulative typical price weighted by volume", () => {
    expect(
      vwap([
        { time: 1, open: 2, high: 4, low: 1, close: 4, volume: 1 },
        { time: 2, open: 5, high: 7, low: 4, close: 7, volume: 3 },
      ]),
    ).toEqual([3, 5.25]);
  });
  it("ATR of fixed three-point ranges equals three", () => {
    expect(atr(candles, 14)[13]).toBe(3);
  });
  it("MACD on constant prices converges to zero", () => {
    const m = macd(Array(50).fill(10) as number[]);
    expect(m.line.at(-1)).toBeCloseTo(0);
    expect(m.signal.at(-1)).toBeCloseTo(0);
    expect(m.hist.at(-1)).toBeCloseTo(0);
  });
  it("Stochastic of a rising series remains in the expected range", () => {
    const s = stochastic(candles);
    expect(s.k.at(-1)).toBeCloseTo(93.75);
    expect(s.d.at(-1)).toBeCloseTo(93.75);
  });
  it("normalizes duplicates, unordered rows, NaN and invalid range", () => {
    const a = candles[0]!,
      b = candles[1]!;
    expect(
      normalizeCandles([b, a, a, { ...a, time: 3000, close: NaN }, { ...a, time: 4000, high: 0 }]),
    ).toEqual([a, b]);
  });
  it("merges last candle and appends new, never older", () => {
    const a = candles[0]!,
      b = candles[1]!;
    expect(mergeCandle([a], { ...a, close: 12 })[0]?.close).toBe(12);
    expect(mergeCandle([a], b)).toEqual([a, b]);
    expect(mergeCandle([b], a)).toEqual([b]);
  });
});
