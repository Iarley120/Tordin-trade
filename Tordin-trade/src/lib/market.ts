import type { Candle } from "./indicators";

const BASE = "https://data-api.binance.vision/api/v3";
export const TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export const TF_LABEL: Record<Timeframe, string> = {
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1D",
  "1w": "1W",
  "1M": "1M",
};
/** Duração de cada período em segundos (null: mensal, de duração variável). */
export const TF_SECONDS: Record<Timeframe, number | null> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
  "1M": null,
};
/** Segundos até o fechamento do candle que abriu em `lastOpen` (s); null se não aplicável. */
export function secondsToClose(lastOpen: number, tf: Timeframe, nowMs: number): number | null {
  const length = TF_SECONDS[tf];
  if (length === null) return null;
  return Math.max(0, Math.ceil(lastOpen + length - nowMs / 1000));
}
export const SYMBOLS = [
  { s: "BTCUSDT", name: "Bitcoin" },
  { s: "ETHUSDT", name: "Ethereum" },
  { s: "SOLUSDT", name: "Solana" },
  { s: "BNBUSDT", name: "BNB" },
  { s: "XRPUSDT", name: "XRP" },
  { s: "ADAUSDT", name: "Cardano" },
  { s: "DOGEUSDT", name: "Dogecoin" },
  { s: "AVAXUSDT", name: "Avalanche" },
  { s: "LINKUSDT", name: "Chainlink" },
  { s: "DOTUSDT", name: "Polkadot" },
  { s: "LTCUSDT", name: "Litecoin" },
  { s: "PAXGUSDT", name: "PAX Gold" },
];
export type Ticker = {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  quoteVolume: number;
  priceChange: number;
};
export type MiniTicker = Ticker;

export const MAX_CANDLES = 5000;
const API_ORIGINS = [BASE, "https://api.binance.com/api/v3"];

async function requestJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let lastError: unknown;
  for (const origin of API_ORIGINS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted)
        throw signal.reason ?? new DOMException("Requisição cancelada", "AbortError");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        const response = await fetch(`${origin}${path}`, { signal: controller.signal });
        if (response.ok) return (await response.json()) as unknown;
        if (response.status === 418 || response.status === 429) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          const wait =
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
          lastError = new Error(`Limite de requisições Binance (${response.status})`);
          if (attempt < 2) await delay(Math.min(wait, 30000), signal);
          else break;
          continue;
        }
        if (response.status >= 400 && response.status < 500) {
          // Erro do cliente/região (ex.: 400, 451): repetir não adianta; tenta a próxima origem.
          lastError = new Error(`Falha na API Binance (${response.status})`);
          break;
        }
        throw new Error(`Falha temporária na API Binance (${response.status})`);
      } catch (error) {
        if (signal?.aborted)
          throw signal.reason ?? new DOMException("Requisição cancelada", "AbortError");
        lastError = error;
        if (attempt < 2) await delay(500 * 2 ** attempt, signal);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
      }
    }
  }
  throw lastError ?? new Error("Não foi possível conectar à Binance");
}
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(signal?.reason ?? new DOMException("Requisição cancelada", "AbortError"));
    };
    const cancel = () => finish();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
function rowsOf(value: unknown): unknown[][] {
  if (!Array.isArray(value) || !value.every(Array.isArray))
    throw new Error("Resposta de candles inválida");
  return value as unknown[][];
}
export async function fetchKlines(
  symbol: string,
  tf: Timeframe,
  limit = 500,
  signal?: AbortSignal,
  endTime?: number,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol,
    interval: tf,
    limit: String(Math.min(1000, Math.max(1, limit))),
  });
  if (endTime !== undefined) params.set("endTime", String(endTime));
  const rows = rowsOf(await requestJson(`/klines?${params}`, signal));
  return normalizeCandles(
    rows.map((k) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    })),
  );
}
export async function fetchTickers(signal?: AbortSignal): Promise<Ticker[]> {
  const q = encodeURIComponent(JSON.stringify(SYMBOLS.map((x) => x.s)));
  const value = await requestJson(`/ticker/24hr?symbols=${q}`, signal);
  if (!Array.isArray(value)) throw new Error("Resposta de cotações inválida");
  return value.map((raw: unknown) => {
    if (!isRecord(raw)) throw new Error("Cotação inválida");
    const t = raw;
    const item = {
      symbol: String(t["symbol"]),
      lastPrice: Number(t["lastPrice"]),
      priceChangePercent: Number(t["priceChangePercent"]),
      highPrice: Number(t["highPrice"]),
      lowPrice: Number(t["lowPrice"]),
      quoteVolume: Number(t["quoteVolume"]),
      priceChange: Number(t["priceChange"]),
    };
    if (
      !SYMBOLS.some((s) => s.s === item.symbol) ||
      Object.values(item)
        .slice(1)
        .some((v) => !Number.isFinite(v))
    )
      throw new Error("Cotação inválida");
    return item;
  });
}
export const fmt = (n: number, d?: number) =>
  n.toLocaleString("pt-BR", {
    minimumFractionDigits: d ?? (n < 0.01 ? 6 : n < 1 ? 4 : 2),
    maximumFractionDigits: d ?? (n < 0.01 ? 8 : n < 1 ? 6 : 2),
  });
export const fmtCompact = (n: number) =>
  n.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 2 });
export function normalizeCandles(candles: Candle[]): Candle[] {
  const valid = candles.filter(
    (c) =>
      Number.isSafeInteger(c.time) &&
      c.time > 0 &&
      [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) &&
      c.high >= c.low &&
      c.high >= Math.max(c.open, c.close) &&
      c.low <= Math.min(c.open, c.close) &&
      c.volume >= 0,
  );
  return [...new Map(valid.sort((a, b) => a.time - b.time).map((c) => [c.time, c])).values()];
}
export function mergeCandle(old: Candle[], next: Candle, limit = MAX_CANDLES): Candle[] {
  if (!normalizeCandles([next]).length) return old;
  const last = old.at(-1);
  if (last && next.time < last.time) return old;
  if (last && next.time === last.time) return [...old.slice(0, -1), next];
  return [...old, next].slice(-limit);
}

type KlineMsg = {
  e: "kline";
  k: { t: number; o: string; h: string; l: string; c: string; v: string };
};
type MiniTickerMsg = {
  e: "24hrMiniTicker";
  s: string;
  c: string;
  o: string;
  h: string;
  l: string;
  q: string;
};
function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}
function isKline(x: unknown): x is KlineMsg {
  if (!isRecord(x) || x["e"] !== "kline" || !isRecord(x["k"])) return false;
  const k = x["k"];
  return (
    typeof k["t"] === "number" &&
    ["o", "h", "l", "c", "v"].every((key) => typeof k[key] === "string")
  );
}
function isMini(x: unknown): x is MiniTickerMsg {
  return (
    isRecord(x) &&
    x["e"] === "24hrMiniTicker" &&
    ["s", "c", "o", "h", "l", "q"].every((key) => typeof x[key] === "string")
  );
}
export function subscribeMarket(
  symbol: string,
  tf: Timeframe,
  onCandle: (c: Candle) => void,
  onTicker: (t: MiniTicker) => void,
  onStatus: (online: boolean) => void,
  onReconnect?: () => void,
): () => void {
  let disposed = false;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let retries = 0;
  let hasConnected = false;
  let lastMessage = 0;
  const clearTimers = () => {
    if (timer) clearTimeout(timer);
    if (watchdog) clearInterval(watchdog);
    timer = undefined;
    watchdog = undefined;
  };
  const closeCurrent = () => {
    const old = socket;
    socket = null;
    if (old) {
      old.onopen = null;
      old.onmessage = null;
      old.onclose = null;
      old.onerror = null;
      old.close();
    }
  };
  const connect = () => {
    if (disposed || (typeof document !== "undefined" && document.hidden)) return;
    const ws = new WebSocket(
      `wss://data-stream.binance.vision/stream?streams=${symbol.toLowerCase()}@kline_${tf}/${symbol.toLowerCase()}@miniTicker`,
    );
    socket = ws;
    ws.onopen = () => {
      if (disposed || socket !== ws) return;
      retries = 0;
      lastMessage = Date.now();
      onStatus(true);
      if (hasConnected) onReconnect?.();
      hasConnected = true;
      watchdog = setInterval(() => {
        if (!disposed && socket === ws && Date.now() - lastMessage > 20000) ws.close();
      }, 5000);
    };
    ws.onmessage = (event) => {
      if (disposed || socket !== ws) return;
      lastMessage = Date.now();
      try {
        const raw: unknown = JSON.parse(String(event.data));
        const d: unknown = isRecord(raw) ? raw["data"] : undefined;
        if (isKline(d)) {
          const k = d.k;
          const c = {
            time: Math.floor(k.t / 1000),
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
            volume: Number(k.v),
          };
          if (normalizeCandles([c]).length) onCandle(c);
        } else if (isMini(d) && d.s === symbol) {
          const lastPrice = Number(d.c),
            open = Number(d.o);
          if (Number.isFinite(lastPrice) && Number.isFinite(open) && open > 0)
            onTicker({
              symbol,
              lastPrice,
              priceChangePercent: (lastPrice / open - 1) * 100,
              priceChange: lastPrice - open,
              highPrice: Number(d.h),
              lowPrice: Number(d.l),
              quoteVolume: Number(d.q),
            });
        }
      } catch {
        /* malformed stream payload */
      }
    };
    ws.onclose = () => {
      if (disposed || socket !== ws) return;
      socket = null;
      if (watchdog) clearInterval(watchdog);
      onStatus(false);
      if (typeof document !== "undefined" && document.hidden) return;
      timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(retries++, 5)));
    };
    ws.onerror = () => {
      if (!disposed && socket === ws) ws.close();
    };
  };
  const visibility = () => {
    if (disposed) return;
    if (document.hidden) {
      clearTimers();
      closeCurrent();
      onStatus(false);
    } else {
      clearTimers();
      closeCurrent();
      onStatus(false);
      onReconnect?.();
      connect();
    }
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibility);
  connect();
  return () => {
    disposed = true;
    clearTimers();
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", visibility);
    closeCurrent();
  };
}
