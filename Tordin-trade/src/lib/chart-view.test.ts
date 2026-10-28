import { describe, expect, it } from "vitest";
import {
  MAX_VISIBLE_BARS,
  MIN_VISIBLE_BARS,
  RIGHT_PADDING_BARS,
  TARGET_BAR_SPACING,
  recentRange,
} from "./chart-view";

describe("recentRange", () => {
  it("mostra só as velas mais recentes que cabem na largura, com folga à direita", () => {
    const r = recentRange(1000, 900);
    const visible = 900 / TARGET_BAR_SPACING;
    expect(r.to).toBe(999 + RIGHT_PADDING_BARS);
    expect(r.to - r.from).toBeCloseTo(visible + RIGHT_PADDING_BARS - 1 + 0.5, 5);
  });
  it("com poucos candles usa todos, sem região vazia à esquerda", () => {
    expect(recentRange(5, 900)).toEqual({ from: -0.5, to: 4 + RIGHT_PADDING_BARS });
  });
  it("respeita os limites mínimo e máximo de velas visíveis", () => {
    const narrow = recentRange(1000, 10);
    expect(999 - Math.ceil(narrow.from)).toBeLessThanOrEqual(MIN_VISIBLE_BARS);
    const wide = recentRange(5000, 100000);
    expect(4999 - Math.ceil(wide.from)).toBeLessThanOrEqual(MAX_VISIBLE_BARS);
  });
  it("largura inválida usa um valor padrão", () => {
    expect(recentRange(1000, 0)).toEqual(recentRange(1000, Number.NaN));
  });
});
