import { describe, expect, it } from "vitest";
import type { ChartTrade } from "./chart-types";
import { MAX_SEGMENTS, snapTime, tradeMarkers, tradeSegments, tradesAtTime } from "./chart-trades";

const times = [100, 160, 220, 280, 340];
const base = { side: "buy" as const, amount: 10 };
const open: ChartTrade = { ...base, id: "o", entryTime: 170, entryPrice: 5, status: "open" };
const done = (id: string, entry: number, exit: number, pnl = 1): ChartTrade => ({
  ...base,
  id,
  entryTime: entry,
  entryPrice: 5,
  status: "closed",
  exitTime: exit,
  exitPrice: 6,
  pnl,
});

describe("snapTime", () => {
  it("usa o candle que contém o horário", () => {
    expect(snapTime(times, 160)).toBe(160);
    expect(snapTime(times, 219)).toBe(160);
    expect(snapTime(times, 9999)).toBe(340);
  });
  it("antes do primeiro candle não há âncora", () => {
    expect(snapTime(times, 99)).toBeNull();
    expect(snapTime([], 5)).toBeNull();
  });
});

describe("tradeMarkers", () => {
  it("aberta tem só entrada; encerrada tem entrada e saída", () => {
    const m = tradeMarkers([open, done("c", 100, 300)], times);
    expect(m.map((x) => x.id)).toEqual(["c:entry", "o:entry", "c:exit"]);
    expect(m.find((x) => x.id === "o:entry")!.price).toBe(5);
    expect(m.find((x) => x.id === "c:exit")!.price).toBe(6);
  });
  it("ids são únicos mesmo com várias operações no mesmo candle", () => {
    const m = tradeMarkers([done("x", 170, 175), done("y", 171, 176)], times);
    expect(new Set(m.map((x) => x.id)).size).toBe(m.length);
  });
  it("ignora operações anteriores ao histórico carregado", () => {
    expect(tradeMarkers([done("z", 10, 20)], times)).toEqual([]);
  });
});

describe("tradeSegments", () => {
  it("liga entrada e saída em candles distintos", () => {
    const s = tradeSegments([done("c", 100, 300, -2)], times);
    expect(s).toHaveLength(1);
    expect(s[0]!.points[0].time).toBe(100);
    expect(s[0]!.points[1].time).toBe(280);
    expect(s[0]!.win).toBe(false);
  });
  it("mesmo candle não gera segmento; aberta também não", () => {
    expect(tradeSegments([done("c", 170, 190), open], times)).toEqual([]);
  });
  it("limita ao máximo mais recente", () => {
    const many = Array.from({ length: MAX_SEGMENTS + 5 }, (_, i) => done(`t${i}`, 100, 300));
    const s = tradeSegments(many, times);
    expect(s).toHaveLength(MAX_SEGMENTS);
    expect(s.at(-1)!.id).toBe(`t${MAX_SEGMENTS + 4}`);
  });
});

describe("tradesAtTime", () => {
  it("retorna operações com entrada ou saída no candle", () => {
    const list = [open, done("c", 100, 300)];
    expect(tradesAtTime(list, times, 160).map((t) => t.id)).toEqual(["o"]);
    expect(tradesAtTime(list, times, 280).map((t) => t.id)).toEqual(["c"]);
    expect(tradesAtTime(list, times, 220)).toEqual([]);
  });
});
