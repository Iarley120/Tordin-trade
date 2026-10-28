import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@/lib/indicators";
import type { IndicatorState } from "@/lib/chart-types";

type FakeSeries = {
  setData: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  applyOptions: ReturnType<typeof vi.fn>;
  createPriceLine: ReturnType<typeof vi.fn>;
  priceScale: () => { applyOptions: ReturnType<typeof vi.fn> };
  kind: string;
};
const state = vi.hoisted(() => ({
  charts: [] as unknown[],
  series: [] as unknown[],
  markers: [] as { setMarkers: ReturnType<typeof vi.fn>; list: { time: number; text: string }[] }[],
}));

vi.mock("lightweight-charts", () => {
  const make = (kind: string) => {
    const s = {
      kind,
      setData: vi.fn(),
      update: vi.fn(),
      applyOptions: vi.fn(),
      createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })),
      removePriceLine: vi.fn(),
      priceScale: () => ({ applyOptions: vi.fn() }),
    };
    state.series.push(s);
    return s;
  };
  return {
    CrosshairMode: { Normal: 0 },
    createSeriesMarkers: vi.fn((_series: unknown, list: unknown[]) => {
      const api = {
        setMarkers: vi.fn(),
        detach: vi.fn(),
        list: list as { time: number; text: string }[],
      };
      state.markers.push(api);
      return api;
    }),
    CandlestickSeries: "candle",
    LineSeries: "line",
    AreaSeries: "area",
    BarSeries: "bar",
    HistogramSeries: "hist",
    createChart: vi.fn(() => {
      const timeScale = {
        fitContent: vi.fn(),
        applyOptions: vi.fn(),
        subscribeVisibleLogicalRangeChange: vi.fn(),
        unsubscribeVisibleLogicalRangeChange: vi.fn(),
        getVisibleLogicalRange: vi.fn(() => ({ from: 5, to: 50 })),
        setVisibleLogicalRange: vi.fn(),
      };
      const chart = {
        addSeries: vi.fn((kind: string) => make(kind)),
        removeSeries: vi.fn(),
        panes: () => [],
        timeScale: () => timeScale,
        subscribeCrosshairMove: vi.fn(),
        unsubscribeCrosshairMove: vi.fn(),
        subscribeClick: vi.fn(),
        unsubscribeClick: vi.fn(),
        remove: vi.fn(),
        _ts: timeScale,
      };
      state.charts.push(chart);
      return chart;
    }),
  };
});

import { TradingChart } from "./TradingChart";

const IND: IndicatorState = {
  sma: false,
  smaP: 20,
  ema: false,
  emaP: 20,
  ma9: false,
  ma21: false,
  ma50: false,
  ma200: false,
  bb: false,
  vwap: false,
  volume: false,
  rsi: false,
  macd: false,
  stoch: false,
};
const mk = (n: number, start = 1000, step = 60): Candle[] =>
  Array.from({ length: n }, (_, i) => ({
    time: start + i * step,
    open: 10,
    high: 1000,
    low: 1,
    close: 11 + i,
    volume: 1,
  }));
const main = () => state.series.find((s) => (s as FakeSeries).kind === "candle") as FakeSeries;
const chartOf = () =>
  state.charts.at(-1) as {
    subscribeClick: ReturnType<typeof vi.fn>;
    subscribeCrosshairMove: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    _ts: { fitContent: ReturnType<typeof vi.fn>; setVisibleLogicalRange: ReturnType<typeof vi.fn> };
  };

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  state.charts.length = 0;
  state.series.length = 0;
  state.markers.length = 0;
});

describe("TradingChart", () => {
  it("carrega o histórico uma vez, ordenado e sem duplicatas", () => {
    const data = mk(5);
    render(
      <TradingChart
        candles={[...data, data[2]!, data[0]!]}
        type="candle"
        ind={IND}
        symbol="BTCUSDT"
        tf="1m"
      />,
    );
    expect(main().setData).toHaveBeenCalledTimes(1);
    const arg = main().setData.mock.calls[0]![0] as { time: number }[];
    expect(arg.map((p) => p.time)).toEqual(data.map((c) => c.time));
    // Vista inicial explícita nas velas mais recentes (sem fitContent sobre todo o histórico).
    expect(chartOf()._ts.fitContent).not.toHaveBeenCalled();
    expect(chartOf()._ts.setVisibleLogicalRange).toHaveBeenCalledTimes(1);
    expect(chartOf()._ts.setVisibleLogicalRange).toHaveBeenCalledWith({ from: -0.5, to: 12 });
  });
  it("atualiza o candle atual e adiciona novo sem recriar o gráfico", () => {
    const data = mk(5);
    const { rerender } = render(
      <TradingChart candles={data} type="candle" ind={IND} symbol="BTCUSDT" tf="1m" />,
    );
    const tick = [...data.slice(0, -1), { ...data.at(-1)!, close: 99 }];
    rerender(<TradingChart candles={tick} type="candle" ind={IND} symbol="BTCUSDT" tf="1m" />);
    expect(main().setData).toHaveBeenCalledTimes(1);
    expect(main().update).toHaveBeenLastCalledWith(
      expect.objectContaining({ time: data.at(-1)!.time, close: 99 }),
    );
    const next = [...tick, { ...data.at(-1)!, time: data.at(-1)!.time + 60 }];
    rerender(<TradingChart candles={next} type="candle" ind={IND} symbol="BTCUSDT" tf="1m" />);
    expect(main().update).toHaveBeenLastCalledWith(
      expect.objectContaining({ time: data.at(-1)!.time + 60 }),
    );
    expect(main().setData).toHaveBeenCalledTimes(1);
    expect(state.charts).toHaveLength(1);
  });
  it("não reaplica o formato de preço a cada atualização", () => {
    const data = mk(5);
    const { rerender } = render(
      <TradingChart candles={data} type="candle" ind={IND} symbol="BTCUSDT" tf="1m" />,
    );
    for (let i = 0; i < 5; i++) {
      const tick = [...data.slice(0, -1), { ...data.at(-1)!, close: 20 + i }];
      rerender(<TradingChart candles={tick} type="candle" ind={IND} symbol="BTCUSDT" tf="1m" />);
    }
    expect(main().applyOptions).toHaveBeenCalledTimes(1);
  });
  it("mostra a contagem até o fechamento do candle", () => {
    render(
      <TradingChart candles={mk(5)} type="candle" ind={IND} symbol="BTCUSDT" tf="1m" closesIn={75} />,
    );
    expect(screen.getByLabelText("Tempo até o fechamento do candle").textContent).toContain("01:15");
  });
  it("no tick recalcula os indicadores só sobre a janela recente e atualiza o último ponto", () => {
    const data = mk(2000);
    const ind = { ...IND, sma: true, smaP: 5 };
    const { rerender } = render(
      <TradingChart candles={data} type="candle" ind={ind} symbol="BTCUSDT" tf="1m" />,
    );
    const lines = state.series.filter((x) => (x as FakeSeries).kind === "line") as FakeSeries[];
    const sma5 = lines.at(-1)!;
    expect((sma5.setData.mock.calls[0]![0] as unknown[]).length).toBe(1996);
    const tick = [...data.slice(0, -1), { ...data.at(-1)!, close: 5000 }];
    rerender(<TradingChart candles={tick} type="candle" ind={ind} symbol="BTCUSDT" tf="1m" />);
    expect(sma5.setData).toHaveBeenCalledTimes(1);
    const last = sma5.update.mock.calls.at(-1)![0] as { time: number; value: number };
    expect(last.time).toBe(data.at(-1)!.time);
    const closes = tick.slice(-5).map((c) => c.close);
    expect(last.value).toBeCloseTo(closes.reduce((a, b) => a + b, 0) / 5, 8);
  });
  it("trocar de período limpa os dados antigos e reajusta a visão", () => {
    const { rerender } = render(
      <TradingChart candles={mk(5)} type="candle" ind={IND} symbol="BTCUSDT" tf="1m" />,
    );
    rerender(<TradingChart candles={[]} type="candle" ind={IND} symbol="BTCUSDT" tf="1h" />);
    expect(main().setData).toHaveBeenLastCalledWith([]);
    const hourly = mk(4, 7200, 3600);
    rerender(<TradingChart candles={hourly} type="candle" ind={IND} symbol="BTCUSDT" tf="1h" />);
    const arg = main().setData.mock.calls.at(-1)![0] as { time: number }[];
    expect(arg.map((p) => p.time)).toEqual(hourly.map((c) => c.time));
    expect(chartOf()._ts.setVisibleLogicalRange).toHaveBeenCalledTimes(2);
  });
  it("histórico anterior preserva a posição visível", () => {
    const recent = mk(5, 10000);
    const { rerender } = render(
      <TradingChart candles={recent} type="candle" ind={IND} symbol="BTCUSDT" tf="1m" />,
    );
    rerender(
      <TradingChart
        candles={[...mk(3, 9820), ...recent]}
        type="candle"
        ind={IND}
        symbol="BTCUSDT"
        tf="1m"
      />,
    );
    expect(main().setData).toHaveBeenCalledTimes(2);
    expect(chartOf()._ts.setVisibleLogicalRange).toHaveBeenCalledTimes(2);
    expect(chartOf()._ts.setVisibleLogicalRange).toHaveBeenLastCalledWith({ from: 8, to: 53 });
  });
  it("alterar o período da SMA recalcula todo o histórico", () => {
    const data = mk(30);
    const { rerender } = render(
      <TradingChart
        candles={data}
        type="candle"
        ind={{ ...IND, sma: true, smaP: 5 }}
        symbol="BTCUSDT"
        tf="1m"
      />,
    );
    rerender(
      <TradingChart
        candles={data}
        type="candle"
        ind={{ ...IND, sma: true, smaP: 10 }}
        symbol="BTCUSDT"
        tf="1m"
      />,
    );
    const lines = state.series.filter((s) => (s as FakeSeries).kind === "line") as FakeSeries[];
    expect(lines.at(-1)!.setData).toHaveBeenCalledTimes(1);
    expect((lines.at(-1)!.setData.mock.calls[0]![0] as unknown[]).length).toBe(21);
  });
  it("desenha a linha da posição aberta e atualiza o resultado sem recriar", () => {
    const data = mk(5);
    const pos = (pnl: number) => [{ id: "p1", side: "buy" as const, entryPrice: 12, pnl }];
    const { rerender } = render(
      <TradingChart
        candles={data}
        type="candle"
        ind={IND}
        symbol="BTCUSDT"
        tf="1m"
        positions={pos(5)}
      />,
    );
    const m = main() as unknown as { createPriceLine: ReturnType<typeof vi.fn> };
    expect(m.createPriceLine).toHaveBeenCalledTimes(1);
    expect(m.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ price: 12, title: expect.stringContaining("+5,00") }),
    );
    const line = m.createPriceLine.mock.results[0]!.value as {
      applyOptions: ReturnType<typeof vi.fn>;
    };
    rerender(
      <TradingChart
        candles={data}
        type="candle"
        ind={IND}
        symbol="BTCUSDT"
        tf="1m"
        positions={pos(-3)}
      />,
    );
    expect(m.createPriceLine).toHaveBeenCalledTimes(1);
    expect(line.applyOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("-3,00") }),
    );
    rerender(
      <TradingChart
        candles={data}
        type="candle"
        ind={IND}
        symbol="BTCUSDT"
        tf="1m"
        positions={[]}
      />,
    );
    expect(
      (main() as unknown as { removePriceLine: ReturnType<typeof vi.fn> }).removePriceLine,
    ).toHaveBeenCalledTimes(1);
  });
  it("rotula a linha da posição com valor e tempo restante", () => {
    const data = mk(5);
    render(
      <TradingChart
        candles={data}
        type="candle"
        ind={IND}
        symbol="BTCUSDT"
        tf="1m"
        positions={[
          { id: "p1", side: "sell", entryPrice: 12, pnl: 1, amount: 250, remainingSec: 75 },
        ]}
      />,
    );
    const m = main() as unknown as { createPriceLine: ReturnType<typeof vi.fn> };
    const title = (m.createPriceLine.mock.calls[0]![0] as { title: string }).title;
    expect(title).toContain("VENDA");
    expect(title).toContain("250,00");
    expect(title).toContain("01:15");
  });
  describe("marcações de entrada e saída", () => {
    const data = mk(5); // candles em 1000, 1060, 1120, 1180, 1240
    const open = {
      id: "a",
      side: "buy" as const,
      entryTime: 1130,
      entryPrice: 12.5,
      amount: 100,
      status: "open" as const,
    };
    const closed = {
      id: "b",
      side: "sell" as const,
      entryTime: 1000 + 70,
      entryPrice: 13,
      amount: 50,
      status: "closed" as const,
      exitTime: 1000 + 250,
      exitPrice: 11,
      pnl: 7.5,
      reason: "expiry" as const,
    };
    const ui = (extra: Partial<Parameters<typeof TradingChart>[0]> = {}) => (
      <TradingChart
        candles={data}
        type="candle"
        ind={IND}
        symbol="BTCUSDT"
        tf="1m"
        trades={[open, closed]}
        {...extra}
      />
    );
    const segs = () =>
      (state.series as FakeSeries[]).filter(
        (x) =>
          x.kind === "line" &&
          (x.setData.mock.calls[0]?.[0] as unknown[] | undefined)?.length === 2,
      );

    it("toda operação tem entrada e a encerrada tem saída, no preço e candle corretos", () => {
      render(ui());
      const list = state.markers[0]!.list as unknown as {
        id: string;
        time: number;
        price: number;
        text: string;
      }[];
      expect(list.map((m) => [m.id, m.time, m.price])).toEqual([
        ["b:entry", 1060, 13],
        ["a:entry", 1120, 12.5],
        ["b:exit", 1240, 11],
      ]);
      expect(list.find((m) => m.id === "b:exit")!.text).toContain("+7,50");
      expect(list.find((m) => m.id === "a:entry")!.text.startsWith("C")).toBe(true);
    });
    it("liga entrada e saída com um segmento e não duplica ao re-renderizar", () => {
      const { rerender } = render(ui());
      expect(segs()).toHaveLength(1);
      expect(segs()[0]!.setData).toHaveBeenCalledWith([
        { time: 1060, value: 13 },
        { time: 1240, value: 11 },
      ]);
      rerender(ui());
      rerender(ui({ candles: [...data] }));
      expect(segs()).toHaveLength(1);
      expect(segs()[0]!.setData).toHaveBeenCalledTimes(1);
    });
    it("operação aberta desenha linha de entrada; ocultar remove tudo sem apagar o histórico", () => {
      const positions = [{ id: "a", side: "buy" as const, entryPrice: 12.5, pnl: 1 }];
      const { rerender } = render(ui({ positions }));
      const m = main() as unknown as {
        createPriceLine: ReturnType<typeof vi.fn>;
        removePriceLine: ReturnType<typeof vi.fn>;
      };
      expect(m.createPriceLine).toHaveBeenCalledTimes(1);
      rerender(ui({ positions, showMarks: false }));
      expect(m.removePriceLine).toHaveBeenCalledTimes(1);
      expect(state.markers[0]!.setMarkers).toHaveBeenLastCalledWith([]);
      rerender(ui({ positions, showMarks: true }));
      expect(m.createPriceLine).toHaveBeenCalledTimes(2);
      expect(state.markers[0]!.setMarkers).toHaveBeenLastCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: "b:exit" })]),
      );
    });
    it("clicar fixa os detalhes do candle e clicar de novo ou fechar os remove", () => {
      render(ui());
      const click = chartOf().subscribeClick.mock.calls[0]![0] as (p: { time?: number }) => void;
      act(() => click({ time: 1240 }));
      const region = screen.getByRole("region", { name: /detalhes das operações/i });
      expect(region.textContent).toContain("VENDA");
      expect(region.textContent).toContain("encerrada por tempo");
      expect(region.textContent).toContain("Saída");
      expect(region.textContent).toContain("+7,50");
      fireEvent.click(screen.getByLabelText("Fechar detalhes"));
      expect(screen.queryByRole("region", { name: /detalhes das operações/i })).toBeNull();
    });
    it("mostra a legenda acessível quando há marcações", () => {
      render(ui());
      expect(screen.getByLabelText("Legenda das marcações")).toBeTruthy();
    });
  });
  it("desmonta e remonta sem erros, liberando o gráfico", () => {
    const first = render(
      <TradingChart candles={mk(5)} type="candle" ind={IND} symbol="BTCUSDT" tf="1m" />,
    );
    first.unmount();
    expect(chartOf().remove).toHaveBeenCalledTimes(1);
    render(<TradingChart candles={mk(5)} type="line" ind={IND} symbol="BTCUSDT" tf="1m" />);
    expect(state.charts).toHaveLength(2);
  });
});
