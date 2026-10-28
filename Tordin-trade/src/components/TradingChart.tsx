import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  BarSeries,
  HistogramSeries,
  CrosshairMode,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
  type ISeriesApi,
  type SeriesType,
} from "lightweight-charts";
import {
  type Candle,
  sma,
  ema,
  rsi,
  macd,
  bollinger,
  vwap,
  toPts,
  stochastic,
} from "@/lib/indicators";
import { fmt, normalizeCandles } from "@/lib/market";
import { RIGHT_PADDING_BARS, TARGET_BAR_SPACING, recentRange } from "@/lib/chart-view";
import type { ChartPosition, ChartTrade, ChartType, IndicatorState } from "@/lib/chart-types";
import {
  formatTradeTime,
  tradeMarkers,
  tradeSegments,
  tradesAtTime,
} from "@/lib/chart-trades";

type Series = ISeriesApi<SeriesType>;
type LineKey =
  | "sma"
  | "ema"
  | "ma9"
  | "ma21"
  | "ma50"
  | "ma200"
  | "bbUpper"
  | "bbMid"
  | "bbLower"
  | "vwap"
  | "rsi"
  | "macdLine"
  | "macdSignal"
  | "macdHist"
  | "stochK"
  | "stochD";
type SeriesKey = LineKey | "main" | "volume";
type SeriesMap = Partial<Record<SeriesKey, Series>>;
const T = (t: number) => t as UTCTimestamp;
const zone = "America/Sao_Paulo";
const formatTime = (t: number) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: zone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(t * 1000));
let colorContext: CanvasRenderingContext2D | null = null;
const colorCache = new Map<string, string>();
/** Cor resolvida das variáveis CSS; em cache porque a leitura via canvas (getImageData) é cara. */
function css(variable: string, alpha = 1): string {
  const key = `${variable}|${alpha}`;
  const cached = colorCache.get(key);
  if (cached) return cached;
  const fallback = `rgba(128,128,128,${alpha})`;
  try {
    const ctx = colorContext ?? (colorContext = document.createElement("canvas").getContext("2d"));
    if (!ctx) return fallback;
    const raw = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    ctx.fillStyle = "#010203";
    ctx.fillStyle = raw;
    if (ctx.fillStyle === "#010203" && raw !== "#010203") return fallback;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const color = `rgba(${r},${g},${b},${alpha})`;
    colorCache.set(key, color);
    return color;
  } catch {
    return fallback;
  }
}
/** Janela usada para recalcular indicadores a cada tick (EMA/RSI já convergiram nesse ponto). */
const INCREMENTAL_WINDOW = 1500;
const clock = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
function pricePrecision(price: number) {
  const precision = price < 0.01 ? 8 : price < 1 ? 6 : price < 1000 ? 3 : 2;
  return { type: "price" as const, precision, minMove: 10 ** -precision };
}
function computed(candles: Candle[], ind: IndicatorState, full: Candle[] = candles) {
  const closes = candles.map((c) => c.close);
  const lines: Partial<Record<LineKey, { time: number; value: number }[]>> = {};
  if (ind.sma) lines.sma = toPts(candles, sma(closes, ind.smaP));
  if (ind.ema) lines.ema = toPts(candles, ema(closes, ind.emaP));
  if (ind.ma9) lines.ma9 = toPts(candles, sma(closes, 9));
  if (ind.ma21) lines.ma21 = toPts(candles, sma(closes, 21));
  if (ind.ma50) lines.ma50 = toPts(candles, sma(closes, 50));
  if (ind.ma200) lines.ma200 = toPts(candles, sma(closes, 200));
  if (ind.bb) {
    const b = bollinger(closes);
    lines.bbUpper = toPts(candles, b.upper);
    lines.bbMid = toPts(candles, b.mid);
    lines.bbLower = toPts(candles, b.lower);
  }
  if (ind.vwap) {
    // VWAP é acumulado sobre todo o histórico carregado, então usa sempre a série completa.
    const values = vwap(full);
    lines.vwap = full.map((c, i) => ({ time: c.time, value: values[i]! }));
  }
  if (ind.rsi) lines.rsi = toPts(candles, rsi(closes));
  if (ind.macd) {
    const m = macd(closes);
    lines.macdLine = toPts(candles, m.line);
    lines.macdSignal = toPts(candles, m.signal);
    lines.macdHist = toPts(candles, m.hist);
  }
  if (ind.stoch) {
    const s = stochastic(candles);
    lines.stochK = toPts(candles, s.k);
    lines.stochD = toPts(candles, s.d);
  }
  return lines;
}
export const TradingChart = memo(function TradingChart({
  candles,
  type,
  ind,
  symbol,
  tf,
  onNeedHistory,
  positions,
  trades,
  showMarks = true,
  closesIn = null,
}: {
  candles: Candle[];
  type: ChartType;
  ind: IndicatorState;
  symbol: string;
  tf: string;
  onNeedHistory?: () => void;
  positions?: ChartPosition[];
  trades?: ChartTrade[];
  showMarks?: boolean;
  /** Segundos até o fechamento do candle atual (null quando não aplicável). */
  closesIn?: number | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<SeriesMap>({});
  const candleMap = useRef(new Map<number, Candle>());
  const previous = useRef<Candle[]>([]);
  const loadedKey = useRef("");
  const previousStructure = useRef("");
  const [hover, setHover] = useState<Candle | null>(null);
  const hoverTime = useRef<number | null>(null);
  const linesRef = useRef(new Map<string, IPriceLine>());
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const segmentsRef = useRef(new Map<string, { series: Series; sig: string }>());
  const precisionRef = useRef(-1);
  const [pinnedTime, setPinnedTime] = useState<number | null>(null);
  const needHistory = useRef(onNeedHistory);
  needHistory.current = onNeedHistory;
  const structureKey = JSON.stringify([
    type,
    ind.sma,
    ind.smaP,
    ind.ema,
    ind.emaP,
    ind.ma9,
    ind.ma21,
    ind.ma50,
    ind.ma200,
    ind.bb,
    ind.vwap,
    ind.volume,
    ind.rsi,
    ind.macd,
    ind.stoch,
  ]);
  const dataKey = `${symbol}:${tf}`;
  // A biblioteca exige tempos estritamente crescentes, sem duplicações.
  const safeCandles = useMemo(
    () => (candles.length ? normalizeCandles(candles) : candles),
    [candles],
  );

  const times = useMemo(() => safeCandles.map((c) => c.time), [safeCandles]);

  useEffect(() => {
    if (!container.current) return;
    const fg = css("--muted-foreground"),
      grid = css("--border");
    const chart = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: fg,
        fontFamily: "JetBrains Mono",
        panes: { separatorColor: grid },
      },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: grid },
      localization: {
        locale: "pt-BR",
        timeFormatter: (time: import("lightweight-charts").Time) => formatTime(Number(time)),
      },
      timeScale: {
        borderColor: grid,
        timeVisible: true,
        secondsVisible: false,
        barSpacing: TARGET_BAR_SPACING,
        minBarSpacing: 1.5,
        rightOffset: RIGHT_PADDING_BARS,
        rightBarStaysOnScroll: true,
        tickMarkFormatter: (
          time: import("lightweight-charts").Time,
          tickMarkType: import("lightweight-charts").TickMarkType,
        ) =>
          new Intl.DateTimeFormat("pt-BR", {
            timeZone: zone,
            ...(tickMarkType <= 1
              ? { year: "numeric", month: "short" }
              : tickMarkType === 2
                ? { day: "2-digit", month: "2-digit" }
                : { hour: "2-digit", minute: "2-digit" }),
          } as Intl.DateTimeFormatOptions).format(new Date(Number(time) * 1000)),
      },
    });
    chartRef.current = chart;
    const move = (p: { time?: unknown }) => {
      const t = typeof p.time === "number" ? p.time : null;
      if (hoverTime.current === t) return;
      hoverTime.current = t;
      setHover(t === null ? null : (candleMap.current.get(t) ?? null));
    };
    const resize = () => chart.timeScale().applyOptions({});
    const onRange = (range: { from: number; to: number } | null) => {
      if (range && range.from < 20) needHistory.current?.();
    };
    const click = (p: { time?: unknown }) => {
      const t = typeof p.time === "number" ? p.time : null;
      setPinnedTime((prev) => (t === null || prev === t ? null : t));
    };
    chart.subscribeCrosshairMove(move);
    chart.subscribeClick(click);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    document.addEventListener("fullscreenchange", resize);
    return () => {
      document.removeEventListener("fullscreenchange", resize);
      chart.unsubscribeCrosshairMove(move);
      chart.unsubscribeClick(click);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chartRef.current = null;
      seriesRef.current = {};
      linesRef.current = new Map();
      segmentsRef.current = new Map();
      markersRef.current = null;
      previous.current = [];
      loadedKey.current = "";
      candleMap.current = new Map();
      hoverTime.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    Object.values(seriesRef.current).forEach((old) => {
      try {
        chart.removeSeries(old);
      } catch {
        /* série já descartada com o gráfico anterior */
      }
    });
    linesRef.current = new Map();
    markersRef.current = null;
    const s: SeriesMap = {};
    const addLine = (key: SeriesKey, color: string, pane = 0, width: 1 | 2 = 1) => {
      s[key] = chart.addSeries(
        LineSeries,
        { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false },
        pane,
      );
    };
    const bull = css("--bull"),
      bear = css("--bear");
    if (type === "candle")
      s.main = chart.addSeries(CandlestickSeries, {
        upColor: bull,
        downColor: bear,
        wickUpColor: bull,
        wickDownColor: bear,
        borderVisible: false,
      });
    else if (type === "bar")
      s.main = chart.addSeries(BarSeries, { upColor: bull, downColor: bear });
    else if (type === "area")
      s.main = chart.addSeries(AreaSeries, {
        lineColor: css("--primary"),
        topColor: css("--primary", 0.35),
        bottomColor: css("--primary", 0),
      });
    else s.main = chart.addSeries(LineSeries, { color: css("--primary"), lineWidth: 2 });
    if (ind.volume) {
      s.volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      s.volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    }
    const colors: Record<LineKey, string> = {
      sma: "#f5b942",
      ema: "#e04fd0",
      ma9: "#5fd3f3",
      ma21: "#a3e635",
      ma50: "#fb923c",
      ma200: "#f43f5e",
      bbUpper: "#8ab4ff",
      bbMid: "#8ab4ff",
      bbLower: "#8ab4ff",
      vwap: "#facc15",
      rsi: "#c084fc",
      macdHist: "#60a5fa",
      macdLine: "#60a5fa",
      macdSignal: "#f59e0b",
      stochK: "#38bdf8",
      stochD: "#f472b6",
    };
    const keys: LineKey[] = [];
    if (ind.sma) keys.push("sma");
    if (ind.ema) keys.push("ema");
    if (ind.ma9) keys.push("ma9");
    if (ind.ma21) keys.push("ma21");
    if (ind.ma50) keys.push("ma50");
    if (ind.ma200) keys.push("ma200");
    if (ind.bb) keys.push("bbUpper", "bbMid", "bbLower");
    if (ind.vwap) keys.push("vwap");
    keys.forEach((k) => addLine(k, colors[k]!));
    let pane = 1;
    if (ind.rsi) {
      addLine("rsi", colors.rsi!, pane, 2);
      s.rsi?.createPriceLine({
        price: 30,
        color: css("--muted-foreground", 0.5),
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
      });
      s.rsi?.createPriceLine({
        price: 70,
        color: css("--muted-foreground", 0.5),
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
      });
      pane++;
    }
    if (ind.macd) {
      s.macdHist = chart.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        pane,
      );
      addLine("macdLine", colors.macdLine!, pane);
      addLine("macdSignal", colors.macdSignal!, pane);
      pane++;
    }
    if (ind.stoch) {
      addLine("stochK", colors.stochK!, pane);
      addLine("stochD", colors.stochD!, pane);
      for (const level of [20, 80])
        s.stochK?.createPriceLine({
          price: level,
          color: css("--muted-foreground", 0.5),
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: false,
        });
    }
    seriesRef.current = s;
    // Painéis secundários proporcionais: o gráfico principal mantém a maior parte da altura.
    chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 6 : 1));
    previous.current = [];
    precisionRef.current = -1;
    previousStructure.current = structureKey;
  }, [
    structureKey,
    type,
    ind.sma,
    ind.smaP,
    ind.ema,
    ind.emaP,
    ind.ma9,
    ind.ma21,
    ind.ma50,
    ind.ma200,
    ind.bb,
    ind.vwap,
    ind.volume,
    ind.rsi,
    ind.macd,
    ind.stoch,
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    const s = seriesRef.current;
    if (!chart || !s.main) return;
    if (!safeCandles.length) {
      // Sem dados do mercado atual (carregando): limpa para não exibir candles do ativo/período anterior.
      Object.values(s).forEach((series) => series.setData([]));
      previous.current = [];
      candleMap.current = new Map();
      loadedKey.current = "";
      hoverTime.current = null;
      setHover(null);
      return;
    }
    if (previous.current === safeCandles) return;
    const changedMarket = loadedKey.current !== dataKey;
    const prev = previous.current;
    const same = (a: Candle | undefined, b: Candle | undefined) =>
      a?.time === b?.time &&
      a?.open === b?.open &&
      a?.high === b?.high &&
      a?.low === b?.low &&
      a?.close === b?.close &&
      a?.volume === b?.volume;
    const lastPrev = prev.at(-1);
    const j = lastPrev ? safeCandles.findIndex((c) => c.time === lastPrev.time) : -1;
    // Atualização incremental: mesmo mercado, histórico anterior intacto e no máximo um candle novo.
    const appendOrTick =
      !changedMarket &&
      prev.length >= 2 &&
      j >= 1 &&
      safeCandles[0]!.time >= prev[0]!.time &&
      same(safeCandles[j - 1], prev[prev.length - 2]) &&
      safeCandles.length - 1 - j <= 1;
    // Histórico antigo adicionado à esquerda: preserva a posição visível.
    const prepended =
      !changedMarket && !appendOrTick && prev.length > 0 && safeCandles[0]!.time < prev[0]!.time;
    const addedLeft = prepended ? safeCandles.findIndex((c) => c.time === prev[0]!.time) : 0;
    const visible = prepended ? chart.timeScale().getVisibleLogicalRange() : null;
    // No tick só o último ponto muda: recalcula numa janela recente em vez de todo o histórico.
    const lineData = appendOrTick
      ? computed(safeCandles.slice(-INCREMENTAL_WINDOW), ind, safeCandles)
      : computed(safeCandles, ind);
    const bull = css("--bull"),
      bear = css("--bear");
    const volUp = css("--bull", 0.4),
      volDown = css("--bear", 0.4);
    const point = (c: Candle) =>
      type === "candle" || type === "bar"
        ? { time: T(c.time), open: c.open, high: c.high, low: c.low, close: c.close }
        : { time: T(c.time), value: c.close };
    const volumePoint = (c: Candle) => ({
      time: T(c.time),
      value: c.volume,
      color: c.close >= c.open ? volUp : volDown,
    });
    const apply = (key: LineKey, points: { time: number; value: number }[]) => {
      const series = s[key];
      if (!series) return;
      if (appendOrTick) {
        const last = points.at(-1);
        if (last && (!lastPrev || last.time >= lastPrev.time))
          series.update({
            time: T(last.time),
            value: last.value,
            ...(key === "macdHist" ? { color: last.value >= 0 ? bull : bear } : {}),
          });
      } else
        series.setData(
          points.map((p) => ({
            time: T(p.time),
            value: p.value,
            ...(key === "macdHist" ? { color: p.value >= 0 ? bull : bear } : {}),
          })),
        );
    };
    // applyOptions força novo layout: só quando a precisão do preço realmente muda.
    const format = pricePrecision(safeCandles.at(-1)!.close);
    if (format.precision !== precisionRef.current) {
      s.main.applyOptions({ priceFormat: format });
      precisionRef.current = format.precision;
    }
    if (appendOrTick) {
      const c = safeCandles.at(-1)!;
      s.main.update(point(c));
      s.volume?.update(volumePoint(c));
    } else {
      s.main.setData(safeCandles.map(point));
      s.volume?.setData(safeCandles.map(volumePoint));
    }
    (Object.keys(lineData) as LineKey[]).forEach((key) => {
      const points = lineData[key];
      if (points) apply(key, points);
    });
    candleMap.current = new Map(safeCandles.map((c) => [c.time, c]));
    previous.current = safeCandles;
    if (visible && addedLeft > 0)
      chart
        .timeScale()
        .setVisibleLogicalRange({ from: visible.from + addedLeft, to: visible.to + addedLeft });
    if (changedMarket) {
      hoverTime.current = null;
      setHover(null);
      const width = container.current?.clientWidth ?? 0;
      chart.timeScale().setVisibleLogicalRange(recentRange(safeCandles.length, width));
      loadedKey.current = dataKey;
    }
  }, [safeCandles, dataKey, type, ind, structureKey]);

  // Linhas das posições abertas (preço de entrada + resultado atual).
  useEffect(() => {
    const main = seriesRef.current.main;
    if (!main) return;
    const lines = linesRef.current;
    const list = showMarks ? (positions ?? []) : [];
    const ids = new Set(list.map((p) => p.id));
    for (const [id, line] of lines) {
      if (!ids.has(id)) {
        try {
          main.removePriceLine(line);
        } catch {
          /* já removida */
        }
        lines.delete(id);
      }
    }
    for (const p of list) {
      const options = {
        price: p.entryPrice,
        color: css(p.side === "buy" ? "--bull" : "--bear"),
        lineWidth: 1 as const,
        lineStyle: 2,
        axisLabelVisible: true,
        title: [
          p.side === "buy" ? "COMPRA" : "VENDA",
          p.amount !== undefined ? fmt(p.amount, 2) : null,
          p.remainingSec != null ? clock(p.remainingSec) : null,
          `${p.pnl >= 0 ? "+" : "-"}${fmt(Math.abs(p.pnl), 2)}`,
        ]
          .filter(Boolean)
          .join(" · "),
      };
      const existing = lines.get(p.id);
      if (existing) existing.applyOptions(options);
      else lines.set(p.id, main.createPriceLine(options));
    }
  }, [positions, showMarks, structureKey]);

  // Marcadores de entrada/saída no preço real, ancorados no candle do horário da operação.
  useEffect(() => {
    const main = seriesRef.current.main;
    if (!main) return;
    const bull = css("--bull"),
      bear = css("--bear");
    const list: SeriesMarker<Time>[] = (showMarks ? tradeMarkers(trades ?? [], times) : []).map(
      (m) => ({
        id: m.id,
        time: T(m.time),
        position: "atPriceMiddle" as const,
        price: m.price,
        shape:
          m.kind === "entry"
            ? m.side === "buy"
              ? ("arrowUp" as const)
              : ("arrowDown" as const)
            : ("square" as const),
        color: m.kind === "entry" ? (m.side === "buy" ? bull : bear) : (m.pnl ?? 0) >= 0 ? bull : bear,
        text: m.text,
      }),
    );
    if (markersRef.current) markersRef.current.setMarkers(list);
    else markersRef.current = createSeriesMarkers(main, list);
  }, [trades, times, showMarks, structureKey]);

  // Segmento tracejado ligando a entrada à saída de cada operação encerrada.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const map = segmentsRef.current;
    const segments = showMarks ? tradeSegments(trades ?? [], times) : [];
    const keep = new Set(segments.map((x) => x.id));
    for (const [id, entry] of map) {
      if (keep.has(id)) continue;
      try {
        chart.removeSeries(entry.series);
      } catch {
        /* série já descartada */
      }
      map.delete(id);
    }
    const bull = css("--bull", 0.8),
      bear = css("--bear", 0.8);
    for (const seg of segments) {
      const color = seg.win ? bull : bear;
      const sig = JSON.stringify([seg.points, seg.win]);
      let entry = map.get(seg.id);
      if (!entry) {
        const series = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        entry = { series, sig: "" };
        map.set(seg.id, entry);
      }
      if (entry.sig !== sig) {
        entry.series.applyOptions({ color });
        entry.series.setData(seg.points.map((p) => ({ time: T(p.time), value: p.value })));
        entry.sig = sig;
      }
    }
  }, [trades, times, showMarks]);

  const detailTime = pinnedTime ?? hover?.time ?? null;
  const details = useMemo(
    () => (showMarks && detailTime !== null ? tradesAtTime(trades ?? [], times, detailTime) : []),
    [showMarks, detailTime, trades, times],
  );

  const c = hover ?? safeCandles.at(-1);
  return (
    <div className="relative h-full w-full">
      {c && (
        <div className="num pointer-events-none absolute left-3 top-2 z-10 flex flex-wrap gap-3 text-xs">
          {(["open", "high", "low", "close"] as const).map((k) => (
            <span key={k} className="text-muted-foreground">
              {k.charAt(0).toUpperCase()}{" "}
              <span className={c.close >= c.open ? "text-bull" : "text-bear"}>{fmt(c[k])}</span>
            </span>
          ))}
          <span className="text-muted-foreground">
            {((c.close / c.open - 1) * 100).toFixed(2)}%
          </span>
          <span className="text-muted-foreground">Vol {fmt(c.volume)}</span>
          {closesIn !== null && (
            <span className="text-muted-foreground" aria-label="Tempo até o fechamento do candle">
              Fecha em <span className="text-foreground">{clock(closesIn)}</span>
            </span>
          )}
        </div>
      )}
      <div ref={container} className="h-full w-full" />
      {details.length > 0 && (
        <div
          role="region"
          aria-label="Detalhes das operações neste candle"
          className={`absolute right-16 top-2 z-10 max-h-[60%] w-64 overflow-y-auto rounded-md border bg-popover p-2 text-[11px] shadow ${pinnedTime !== null ? "" : "pointer-events-none"}`}
        >
          {pinnedTime !== null && (
            <button
              aria-label="Fechar detalhes"
              onClick={() => setPinnedTime(null)}
              className="float-right text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          )}
          {details.map((t) => (
            <div key={t.id} className="border-b py-1.5 last:border-0">
              <div className={`font-semibold ${t.side === "buy" ? "text-bull" : "text-bear"}`}>
                {t.side === "buy" ? "▲ COMPRA" : "▼ VENDA"} ·{" "}
                {t.status === "open" ? "aberta" : t.reason === "expiry" ? "encerrada por tempo" : "encerrada"}
              </div>
              <div className="num text-muted-foreground">
                Entrada {fmt(t.entryPrice)} · {formatTradeTime(t.entryTime)}
              </div>
              {t.status === "closed" && t.exitPrice !== undefined && t.exitTime !== undefined && (
                <div className="num text-muted-foreground">
                  Saída {fmt(t.exitPrice)} · {formatTradeTime(t.exitTime)}
                </div>
              )}
              <div className="num">
                Valor {fmt(t.amount, 2)}
                {t.pnl !== undefined && (
                  <span className={t.pnl >= 0 ? "text-bull" : "text-bear"}>
                    {" "}
                    · Resultado {t.pnl >= 0 ? "+" : "-"}
                    {fmt(Math.abs(t.pnl), 2)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {showMarks && (trades?.length ?? 0) > 0 && (
        <ul
          aria-label="Legenda das marcações"
          className="pointer-events-none absolute bottom-8 left-3 z-10 flex flex-wrap gap-x-3 rounded bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          <li>
            <span className="text-bull">▲</span> entrada compra
          </li>
          <li>
            <span className="text-bear">▼</span> entrada venda
          </li>
          <li>■ saída (verde lucro, vermelho prejuízo)</li>
          <li>┄ entrada → saída</li>
          <li>— linha: operação aberta</li>
        </ul>
      )}
    </div>
  );
});
