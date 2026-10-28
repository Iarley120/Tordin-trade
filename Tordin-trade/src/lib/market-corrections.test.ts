import { describe, expect, it } from "vitest";
import { mergeCandle, normalizeCandles, secondsToClose } from "./market";
import type { Candle } from "./indicators";

const base: Candle = { time: 1000, open: 10, high: 12, low: 9, close: 11, volume: 5 };

describe("integridade dos candles para lightweight-charts", () => {
  it("ordena, elimina tempos duplicados e descarta OHLC inválido", () => {
    const next = { ...base, time: 1060, close: 12 };
    const result = normalizeCandles([next, base, { ...base, high: 8 }, base]);
    expect(result).toEqual([base, next]);
  });
  it("atualiza somente o último candle com o mesmo horário", () => {
    expect(mergeCandle([base], { ...base, close: 10 })[0]?.close).toBe(10);
  });
  it("ignora candle anterior e mantém o limite de histórico", () => {
    const newer = { ...base, time: 1060 };
    expect(mergeCandle([newer], base)).toEqual([newer]);
    expect(mergeCandle([base], newer, 1)).toEqual([newer]);
  });
});

import { afterEach, vi } from "vitest";
import { fetchKlines, MAX_CANDLES, TIMEFRAMES } from "./market";

describe("integração Binance e histórico", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("inclui o período de 3 minutos", () => {
    expect(TIMEFRAMES).toContain("3m");
  });
  it("mergeCandle respeita o limite padrão de histórico estendido", () => {
    const history = Array.from({ length: MAX_CANDLES }, (_, i): Candle => ({
      ...base,
      time: 1000 + i * 60,
    }));
    const next = { ...base, time: 1000 + MAX_CANDLES * 60 };
    const merged = mergeCandle(history, next);
    expect(merged).toHaveLength(MAX_CANDLES);
    expect(merged.at(-1)).toEqual(next);
    expect(merged[0]?.time).toBe(1060);
  });
  it("converte klines da Binance em candles OHLC ordenados e sem duplicatas", async () => {
    const rows = [
      [120000, "11", "13", "10", "12", "7"],
      [60000, "10", "12", "9", "11", "5"],
      [60000, "10", "12", "9", "11", "5"],
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })),
    );
    const result = await fetchKlines("BTCUSDT", "1m", 500);
    expect(result).toEqual([
      { time: 60, open: 10, high: 12, low: 9, close: 11, volume: 5 },
      { time: 120, open: 11, high: 13, low: 10, close: 12, volume: 7 },
    ]);
  });
  it("não repete requisições em erro 4xx (ex.: bloqueio regional) e tenta a origem alternativa", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 451 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchKlines("BTCUSDT", "1m", 10)).rejects.toThrow(/451/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("passa endTime ao carregar histórico anterior", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchKlines("BTCUSDT", "1h", 500, undefined, 123456);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("endTime=123456");
  });
});

describe("secondsToClose", () => {
  it("conta até o fechamento do candle atual", () => {
    expect(secondsToClose(1000, "1m", 1_020_000)).toBe(40);
    expect(secondsToClose(1000, "1h", 1_000_000)).toBe(3600);
  });
  it("nunca fica negativo e ignora o período mensal", () => {
    expect(secondsToClose(1000, "1m", 2_000_000)).toBe(0);
    expect(secondsToClose(1000, "1M", 1_000_000)).toBeNull();
  });
});
