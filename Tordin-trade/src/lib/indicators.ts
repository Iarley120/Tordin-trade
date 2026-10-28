export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
export type Pt = { time: number; value: number };

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (prev === null) {
      prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else prev = values[i]! * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** Wilder's RSI */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= period) return out;
  let gain = 0,
    loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(values, fast),
    s = ema(values, slow);
  const line = values.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : null));
  const start = line.findIndex((v) => v != null);
  const sig: (number | null)[] = values.map(() => null);
  if (start >= 0) {
    const e = ema(line.slice(start) as number[], signal);
    e.forEach((v, j) => (sig[start + j] = v));
  }
  const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i]! : null));
  return { line, signal: sig, hist };
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper: (number | null)[] = [],
    lower: (number | null)[] = [];
  values.forEach((_, i) => {
    if (mid[i]! == null) {
      upper.push(null);
      lower.push(null);
      return;
    }
    const sl = values.slice(i - period + 1, i + 1);
    const sd = Math.sqrt(sl.reduce((a, v) => a + (v - mid[i]!) ** 2, 0) / period);
    upper.push(mid[i]! + mult * sd);
    lower.push(mid[i]! - mult * sd);
  });
  return { mid, upper, lower };
}

/** Cumulative VWAP over the loaded range (typical price) */
export function vwap(c: Candle[]): number[] {
  let pv = 0,
    v = 0;
  return c.map((k) => {
    pv += ((k.high + k.low + k.close) / 3) * k.volume;
    v += k.volume;
    return v ? pv / v : k.close;
  });
}

export function atr(c: Candle[], period = 14): (number | null)[] {
  const tr = c.map((k, i) =>
    i === 0
      ? k.high - k.low
      : Math.max(
          k.high - k.low,
          Math.abs(k.high - c[i - 1]!.close),
          Math.abs(k.low - c[i - 1]!.close),
        ),
  );
  const out: (number | null)[] = c.map(() => null);
  if (c.length < period) return out;
  let a = tr.slice(0, period).reduce((x, y) => x + y, 0) / period;
  out[period - 1] = a;
  for (let i = period; i < c.length; i++) {
    a = (a * (period - 1) + tr[i]!) / period;
    out[i] = a;
  }
  return out;
}

export function stochastic(c: Candle[], kP = 14, dP = 3) {
  const k = c.map((_, i) => {
    if (i < kP - 1) return null;
    const sl = c.slice(i - kP + 1, i + 1);
    const hi = Math.max(...sl.map((x) => x.high)),
      lo = Math.min(...sl.map((x) => x.low));
    return hi === lo ? 50 : ((c[i]!.close - lo) / (hi - lo)) * 100;
  });
  const start = k.findIndex((v) => v != null);
  const d: (number | null)[] = c.map(() => null);
  if (start >= 0) sma(k.slice(start) as number[], dP).forEach((v, j) => (d[start + j] = v));
  return { k, d };
}

export const toPts = (c: Candle[], v: (number | null)[]): Pt[] =>
  v.flatMap((x, i) => (x == null || !isFinite(x) ? [] : [{ time: c[i]!.time, value: x }]));
