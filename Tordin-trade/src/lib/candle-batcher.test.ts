import { describe, expect, it, vi } from "vitest";
import { createCandleBatcher } from "./candle-batcher";
import type { Candle } from "./indicators";

const candle = (time: number, close: number): Candle => ({
  time,
  open: 1,
  high: 10,
  low: 0.5,
  close,
  volume: 1,
});
function manual() {
  let cb: (() => void) | null = null;
  return {
    scheduler: {
      request: (fn: () => void) => {
        cb = fn;
        return 1;
      },
      cancel: vi.fn(() => {
        cb = null;
      }),
    },
    frame: () => {
      const fn = cb;
      cb = null;
      fn?.();
    },
    scheduled: () => cb !== null,
  };
}

describe("createCandleBatcher", () => {
  it("entrega uma vez por quadro, mantendo só a última atualização de cada candle", () => {
    const m = manual();
    const flush = vi.fn();
    const b = createCandleBatcher(flush, m.scheduler);
    b.push(candle(60, 2));
    b.push(candle(60, 3));
    b.push(candle(60, 4));
    expect(flush).not.toHaveBeenCalled();
    m.frame();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith([candle(60, 4)]);
  });
  it("não perde o fechamento do candle anterior quando o novo abre no mesmo quadro", () => {
    const m = manual();
    const flush = vi.fn();
    const b = createCandleBatcher(flush, m.scheduler);
    b.push(candle(120, 9));
    b.push(candle(60, 5));
    b.push(candle(60, 6));
    m.frame();
    expect(flush).toHaveBeenCalledWith([candle(60, 6), candle(120, 9)]);
  });
  it("agenda um novo quadro depois de entregar", () => {
    const m = manual();
    const flush = vi.fn();
    const b = createCandleBatcher(flush, m.scheduler);
    b.push(candle(60, 1));
    m.frame();
    expect(m.scheduled()).toBe(false);
    b.push(candle(60, 2));
    expect(m.scheduled()).toBe(true);
    m.frame();
    expect(flush).toHaveBeenCalledTimes(2);
  });
  it("dispose cancela o quadro e descarta o pendente", () => {
    const m = manual();
    const flush = vi.fn();
    const b = createCandleBatcher(flush, m.scheduler);
    b.push(candle(60, 1));
    b.dispose();
    m.frame();
    expect(m.scheduler.cancel).toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });
});
