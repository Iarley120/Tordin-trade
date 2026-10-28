import { z } from "zod";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Maximize2,
  PanelLeft,
  Search,
  SlidersHorizontal,
  CandlestickChart,
  LineChart,
  AreaChart,
  BarChart3,
  AlertTriangle,
} from "lucide-react";
import { TradingChart } from "@/components/TradingChart";
import { TradingPanel } from "@/components/TradingPanel";
import { useDemoAccount } from "@/hooks/use-demo-account";
import { equity, remainingSeconds, unrealizedPnl, type ClosedTrade } from "@/lib/trading";
import type { ChartPosition, ChartTrade, ChartType, IndicatorState } from "@/lib/chart-types";
import {
  fetchKlines,
  fetchTickers,
  mergeCandle,
  normalizeCandles,
  secondsToClose,
  subscribeMarket,
  fmt,
  fmtCompact,
  MAX_CANDLES,
  SYMBOLS,
  TIMEFRAMES,
  TF_LABEL,
  type Timeframe,
} from "@/lib/market";
import type { Candle } from "@/lib/indicators";
import { createCandleBatcher } from "@/lib/candle-batcher";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tordin Trade | Plataforma de Trading" },
      {
        name: "description",
        content:
          "Terminal profissional com gráficos, indicadores técnicos e cotações de criptomoedas.",
      },
      { property: "og:title", content: "Tordin Trade | Plataforma de Trading" },
      {
        property: "og:description",
        content: "Gráficos candlestick, RSI, MACD, Bollinger e mais sobre dados reais de mercado.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Terminal,
});

const DEFAULT_IND: IndicatorState = {
  sma: false,
  smaP: 20,
  ema: false,
  emaP: 20,
  ma9: false,
  ma21: true,
  ma50: true,
  ma200: false,
  bb: false,
  vwap: false,
  volume: true,
  rsi: false,
  macd: false,
  stoch: false,
};
const IND_LABELS: [keyof IndicatorState, string][] = [
  ["volume", "Volume"],
  ["ma9", "MA 9"],
  ["ma21", "MA 21"],
  ["ma50", "MA 50"],
  ["ma200", "MA 200"],
  ["sma", "SMA"],
  ["ema", "EMA"],
  ["bb", "Bollinger"],
  ["vwap", "VWAP"],
  ["rsi", "RSI"],
  ["macd", "MACD"],
  ["stoch", "Estocástico"],
];
const PREFS = "nexus.chart.prefs";
const NO_CANDLES: Candle[] = [];

const preferencesSchema = z
  .object({
    symbol: z.enum(SYMBOLS.map((x) => x.s) as [string, ...string[]]),
    tf: z.enum(TIMEFRAMES),
    type: z.enum(["candle", "bar", "line", "area"]),
    marks: z.boolean().optional(),
    ind: z
      .object({
        smaP: z.number().int().min(2).max(400),
        emaP: z.number().int().min(2).max(400),
        sma: z.boolean(),
        ema: z.boolean(),
        ma9: z.boolean(),
        ma21: z.boolean(),
        ma50: z.boolean(),
        ma200: z.boolean(),
        bb: z.boolean(),
        vwap: z.boolean(),
        volume: z.boolean(),
        rsi: z.boolean(),
        macd: z.boolean(),
        stoch: z.boolean(),
      })
      .partial(),
  })
  .passthrough();
function usePrefs() {
  const [p, setP] = useState({
    symbol: "BTCUSDT",
    tf: "1h" as Timeframe,
    type: "candle" as ChartType,
    marks: true,
    ind: DEFAULT_IND,
  });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const s = localStorage.getItem(PREFS);
      if (s) {
        const parsed = preferencesSchema.safeParse(JSON.parse(s));
        if (parsed.success)
          setP((o) => ({
            ...o,
            ...parsed.data,
            type: parsed.data.type as ChartType,
            marks: parsed.data.marks ?? o.marks,
            ind: {
              ...DEFAULT_IND,
              ...(Object.fromEntries(
                Object.entries(parsed.data.ind).filter(([, v]) => v !== undefined),
              ) as Partial<IndicatorState>),
            },
          }));
      }
    } catch {
      /* Preferências inválidas: manter valores padrão. */
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(PREFS, JSON.stringify(p));
      } catch {
        /* storage disabled */
      }
    }
  }, [p, ready]);
  return [p, setP] as const;
}

function Terminal() {
  const [p, setP] = usePrefs();
  const [q, setQ] = useState("");
  const [live, setLive] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(true);
  const [showInd, setShowInd] = useState(false);
  const [hideSub, setHideSub] = useState(false);
  const [liveTicker, setLiveTicker] = useState<import("@/lib/market").MiniTicker | null>(null);
  const qc = useQueryClient();
  const tickers = useQuery({
    queryKey: ["tickers"],
    queryFn: ({ signal }) => fetchTickers(signal),
    refetchInterval: live ? 60000 : 15000,
  });
  const klines = useQuery({
    queryKey: ["klines", p.symbol, p.tf],
    queryFn: async ({ signal }) => {
      const fresh = await fetchKlines(p.symbol, p.tf, 500, signal);
      const old = qc.getQueryData<Candle[]>(["klines", p.symbol, p.tf]);
      // Mantém o histórico antigo já carregado, a menos que haja lacuna entre ele e os dados novos.
      if (!old?.length || !fresh.length || fresh[0]!.time > old.at(-1)!.time) return fresh;
      return normalizeCandles([...old, ...fresh]).slice(-MAX_CANDLES);
    },
    placeholderData: keepPreviousData,
    refetchInterval: live ? 60000 : 30000,
  });
  // Dados provisórios (do ativo/período anterior) nunca são enviados ao gráfico.
  const chartCandles = klines.isPlaceholderData ? NO_CANDLES : klines.data;
  const loadingOlder = useRef(false);
  const exhausted = useRef(new Set<string>());
  const loadOlder = useCallback(async () => {
    const key = ["klines", p.symbol, p.tf] as const;
    const marker = `${p.symbol}:${p.tf}`;
    const current = qc.getQueryData<Candle[]>(key);
    if (
      !current?.length ||
      current.length >= MAX_CANDLES ||
      loadingOlder.current ||
      exhausted.current.has(marker)
    )
      return;
    loadingOlder.current = true;
    try {
      const older = await fetchKlines(p.symbol, p.tf, 500, undefined, current[0]!.time * 1000 - 1);
      if (older.length < 500) exhausted.current.add(marker);
      if (older.length)
        qc.setQueryData<Candle[]>(key, (cur) => (cur ? normalizeCandles([...older, ...cur]) : cur));
    } catch {
      /* sem histórico adicional agora; nova tentativa ao rolar novamente */
    } finally {
      loadingOlder.current = false;
    }
  }, [p.symbol, p.tf, qc]);
  useEffect(() => {
    let active = true;
    const key = ["klines", p.symbol, p.tf];
    // Uma atualização do cache (e do gráfico) por quadro de animação, sem descartar candles.
    const batcher = createCandleBatcher((batch) => {
      if (!active) return;
      qc.setQueryData<Candle[]>(key, (old) =>
        old ? batch.reduce((acc, candle) => mergeCandle(acc, candle), old) : old,
      );
    });
    const stopSocket = subscribeMarket(
      p.symbol,
      p.tf,
      (candle) => {
        if (active) batcher.push(candle);
      },
      (ticker) => {
        if (!active) return;
        setLiveTicker(ticker);
        qc.setQueryData<import("@/lib/market").Ticker[]>(["tickers"], (old) =>
          old?.map((t) => (t.symbol === ticker.symbol ? ticker : t)),
        );
      },
      (online) => {
        if (active) setLive(online);
      },
      () => {
        if (active) void qc.invalidateQueries({ queryKey: key });
      },
    );
    return () => {
      active = false;
      batcher.dispose();
      stopSocket();
    };
  }, [p.symbol, p.tf, qc]);
  const cur =
    (liveTicker?.symbol === p.symbol ? liveTicker : null) ??
    tickers.data?.find((t) => t.symbol === p.symbol);
  const demo = useDemoAccount();
  const prices = useMemo(() => {
    const map: Record<string, number | undefined> = {};
    for (const t of tickers.data ?? []) map[t.symbol] = t.lastPrice;
    if (cur) map[p.symbol] = cur.lastPrice;
    return map;
  }, [tickers.data, cur, p.symbol]);
  // Relógio das operações: atualiza a contagem a cada segundo e encerra, a cada 250 ms,
  // as posições vencidas pelo último preço conhecido (mesmo estado usado pelo saldo e histórico).
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<ClosedTrade | null>(null);
  const pricesRef = useRef(prices);
  pricesRef.current = prices;
  const { settle } = demo;
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow((prev) => (Math.floor(prev / 1000) === Math.floor(t / 1000) ? prev : t));
      const done = settle(pricesRef.current, t);
      if (done.length) setNotice(done[done.length - 1]!);
    }, 250);
    return () => clearInterval(id);
  }, [settle]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(id);
  }, [notice]);
  const chartPositions = useMemo<ChartPosition[]>(
    () =>
      demo.account.positions
        .filter((x) => x.symbol === p.symbol)
        .map((x) => ({
          id: x.id,
          side: x.side,
          entryPrice: x.entryPrice,
          pnl: prices[p.symbol] ? unrealizedPnl(x, prices[p.symbol]!) : 0,
          amount: x.amount,
          remainingSec: remainingSeconds(x, now),
        })),
    [demo.account.positions, p.symbol, prices, now],
  );
  // Toda operação aberta tem entrada; toda encerrada tem entrada e saída (preço e horário reais).
  const chartTrades = useMemo<ChartTrade[]>(
    () => [
      ...demo.account.closed
        .filter((x) => x.symbol === p.symbol)
        .map(
          (x): ChartTrade => ({
            id: x.id,
            side: x.side,
            entryTime: Math.floor(x.openedAt / 1000),
            entryPrice: x.entryPrice,
            amount: x.amount,
            status: "closed",
            exitTime: Math.floor(x.closedAt / 1000),
            exitPrice: x.exitPrice,
            pnl: x.pnl,
            ...(x.closeReason ? { reason: x.closeReason } : {}),
          }),
        ),
      ...demo.account.positions
        .filter((x) => x.symbol === p.symbol)
        .map(
          (x): ChartTrade => ({
            id: x.id,
            side: x.side,
            entryTime: Math.floor(x.openedAt / 1000),
            entryPrice: x.entryPrice,
            amount: x.amount,
            status: "open",
          }),
        ),
    ],
    [demo.account.positions, demo.account.closed, p.symbol],
  );
  const name = SYMBOLS.find((s) => s.s === p.symbol)?.name;
  const list = useMemo(
    () =>
      (tickers.data ?? []).filter(
        (t) =>
          t.symbol.toLowerCase().includes(q.toLowerCase()) ||
          SYMBOLS.find((s) => s.s === t.symbol)
            ?.name.toLowerCase()
            .includes(q.toLowerCase()),
      ),
    [tickers.data, q],
  );
  const sorted = [...(tickers.data ?? [])].sort(
    (a, b) => b.priceChangePercent - a.priceChangePercent,
  );
  const pair = (s: string) => s.replace("USDT", "/USDT");

  const lastOpen = chartCandles?.at(-1)?.time;
  const closesIn = lastOpen === undefined ? null : secondsToClose(lastOpen, p.tf, now);
  const chartInd = useMemo<IndicatorState>(
    () => (hideSub ? { ...p.ind, rsi: false, macd: false, stoch: false } : p.ind),
    [hideSub, p.ind],
  );
  const setPeriod = (key: "smaP" | "emaP", raw: string) =>
    setP((prev) => ({
      ...prev,
      ind: { ...prev.ind, [key]: Math.min(400, Math.max(2, +raw || 2)) },
    }));
  const eqNow = equity(demo.account, prices);
  const changeUp = (cur?.priceChangePercent ?? 0) >= 0;
  const toggle = "rounded-md px-2 py-1 text-xs";
  const toggleOn = "bg-accent font-semibold text-foreground";
  const toggleOff = "text-muted-foreground hover:text-foreground";

  return (
    <div className="flex min-h-screen flex-col bg-background lg:h-screen lg:overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-panel px-3 py-2">
        <button
          aria-label={assetsOpen ? "Recolher lista de ativos" : "Mostrar lista de ativos"}
          aria-pressed={assetsOpen}
          onClick={() => setAssetsOpen((v) => !v)}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
        >
          <PanelLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-wide">TORDIN TRADE</div>
            <div className="hidden text-[10px] text-muted-foreground sm:block">
              Plataforma de trading
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1">
          <label className="sr-only" htmlFor="asset-select">
            Ativo selecionado
          </label>
          <select
            id="asset-select"
            value={p.symbol}
            onChange={(e) => setP((prev) => ({ ...prev, symbol: e.target.value }))}
            className="bg-transparent text-sm font-semibold outline-none lg:hidden"
          >
            {SYMBOLS.map((x) => (
              <option key={x.s} value={x.s} className="bg-card">
                {pair(x.s)}
              </option>
            ))}
          </select>
          <span className="hidden text-sm font-semibold lg:inline">{pair(p.symbol)}</span>
          {cur && (
            <>
              <span className="num text-sm">{fmt(cur.lastPrice)}</span>
              <span className={`num text-xs ${changeUp ? "text-bull" : "text-bear"}`}>
                {changeUp ? "+" : ""}
                {cur.priceChangePercent.toFixed(2)}%
              </span>
            </>
          )}
        </div>
        <span
          aria-live="polite"
          className="hidden text-[11px] text-muted-foreground xl:inline"
        >
          Binance · {live ? "ao vivo" : "reconectando"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1">
            <span className="rounded bg-warn px-1.5 py-0.5 text-[10px] font-bold text-background">
              DEMO
            </span>
            <div className="leading-tight">
              <div className="num text-sm font-semibold" aria-label="Saldo demonstrativo">
                {fmt(demo.account.cash, 2)} USDT
              </div>
              <div className="num hidden text-[10px] text-muted-foreground sm:block">
                Patrimônio {fmt(eqNow, 2)}
              </div>
            </div>
          </div>
          <button
            aria-label="Configurações do gráfico e indicadores"
            aria-pressed={showInd}
            onClick={() => setShowInd((v) => !v)}
            className={`rounded-md p-1.5 ${showInd ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <SlidersHorizontal className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div
        className={`grid min-h-0 flex-1 gap-2 p-2 lg:grid-rows-[minmax(0,1fr)] ${assetsOpen ? "lg:grid-cols-[220px_minmax(0,1fr)_320px]" : "lg:grid-cols-[minmax(0,1fr)_320px]"}`}
      >
        {assetsOpen && (
          <aside className="order-3 flex min-h-0 flex-col rounded-xl bg-panel p-2 lg:order-1">
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="Buscar ativo ou ticker"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar ativo…"
                className="w-full rounded-md border bg-card py-1.5 pl-8 pr-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tickers.isLoading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="mb-1.5 h-9 animate-pulse rounded-lg bg-muted" />
                ))}
              {tickers.isError && (
                <ErrorBox msg={(tickers.error as Error).message} retry={() => tickers.refetch()} />
              )}
              {list.map((t) => (
                <button
                  key={t.symbol}
                  onClick={() => setP((prev) => ({ ...prev, symbol: t.symbol }))}
                  aria-current={t.symbol === p.symbol}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent ${t.symbol === p.symbol ? "bg-accent" : ""}`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{pair(t.symbol)}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {SYMBOLS.find((s) => s.s === t.symbol)?.name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num text-xs">{fmt(t.lastPrice)}</div>
                    <div
                      className={`num text-[10px] ${t.priceChangePercent >= 0 ? "text-bull" : "text-bear"}`}
                    >
                      {t.priceChangePercent >= 0 ? "+" : ""}
                      {t.priceChangePercent.toFixed(2)}%
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-2 border-t pt-2">
              <div className="mb-1 px-1 text-[10px] font-semibold text-muted-foreground">
                Em alta / em baixa (24h)
              </div>
              {[
                ...new Map(
                  [...sorted.slice(0, 2), ...sorted.slice(-2)].map((t) => [t.symbol, t]),
                ).values(),
              ].map((t) => (
                <div key={t.symbol} className="flex justify-between px-1 py-0.5 text-[11px]">
                  <span>{pair(t.symbol)}</span>
                  <span className={`num ${t.priceChangePercent >= 0 ? "text-bull" : "text-bear"}`}>
                    {t.priceChangePercent.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </aside>
        )}

        <main className="order-1 flex min-h-0 min-w-0 flex-col gap-2 lg:order-2">
          <section
            aria-label="Estatísticas 24h"
            className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl bg-panel px-4 py-2"
          >
            <div className="text-xs text-muted-foreground">{name}</div>
            {cur ? (
              <>
                <Stat label="Último preço" value={fmt(cur.lastPrice)} big />
                <Stat
                  label="Variação 24h"
                  value={`${cur.priceChangePercent >= 0 ? "+" : ""}${cur.priceChangePercent.toFixed(2)}%`}
                  tone={cur.priceChangePercent >= 0 ? "bull" : "bear"}
                />
                <Stat label="Máxima 24h" value={fmt(cur.highPrice)} />
                <Stat label="Mínima 24h" value={fmt(cur.lowPrice)} />
                <Stat label="Volume 24h (USDT)" value={fmtCompact(cur.quoteVolume)} />
              </>
            ) : (
              <div className="h-8 w-80 animate-pulse rounded bg-muted" />
            )}
          </section>

          <section id="chart-box" className="flex min-h-0 flex-1 flex-col rounded-xl bg-panel">
            <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setP((prev) => ({ ...prev, tf }))}
                  aria-label={`Período ${TF_LABEL[tf]}`}
                  aria-pressed={p.tf === tf}
                  className={`${toggle} ${p.tf === tf ? toggleOn : toggleOff}`}
                >
                  {TF_LABEL[tf]}
                </button>
              ))}
              <div className="mx-1 h-5 w-px bg-border" />
              {(
                [
                  ["candle", CandlestickChart],
                  ["bar", BarChart3],
                  ["line", LineChart],
                  ["area", AreaChart],
                ] as const
              ).map(([t, Icon]) => (
                <button
                  key={t}
                  aria-label={`Gráfico ${t}`}
                  aria-pressed={p.type === t}
                  onClick={() => setP((prev) => ({ ...prev, type: t }))}
                  className={`rounded-md p-1.5 ${p.type === t ? "bg-accent text-foreground" : toggleOff}`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
              <div className="mx-1 h-5 w-px bg-border" />
              <button
                aria-label="Indicadores"
                aria-expanded={showInd}
                onClick={() => setShowInd((v) => !v)}
                className={`${toggle} flex items-center gap-1 ${showInd ? toggleOn : toggleOff}`}
              >
                Indicadores
                {showInd ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
              <button
                aria-label={hideSub ? "Mostrar subpainéis" : "Ocultar subpainéis"}
                aria-pressed={hideSub}
                onClick={() => setHideSub((v) => !v)}
                className={`${toggle} ${hideSub ? toggleOn : toggleOff}`}
              >
                {hideSub ? "Mostrar RSI/MACD" : "Ocultar RSI/MACD"}
              </button>
              <button
                aria-label={p.marks ? "Ocultar marcações de operações" : "Mostrar marcações de operações"}
                aria-pressed={p.marks}
                onClick={() => setP((prev) => ({ ...prev, marks: !prev.marks }))}
                className={`${toggle} flex items-center gap-1 ${p.marks ? toggleOn : toggleOff}`}
              >
                {p.marks ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                Marcações
              </button>
              <button
                aria-label="Tela cheia"
                onClick={() => {
                  const el = document.getElementById("chart-box");
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else void el?.requestFullscreen();
                }}
                className="ml-auto rounded-md p-1.5 text-muted-foreground hover:text-foreground"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
            {showInd && (
              <div className="border-b px-3 py-2">
                <div className="flex flex-wrap gap-1.5">
                  {IND_LABELS.map(([k, l]) => (
                    <button
                      key={k}
                      aria-label={`Indicador ${l}`}
                      aria-pressed={Boolean(p.ind[k])}
                      onClick={() =>
                        setP((prev) => ({ ...prev, ind: { ...prev.ind, [k]: !prev.ind[k] } }))
                      }
                      className={`rounded-full border px-3 py-0.5 text-xs transition-colors ${p.ind[k] ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {l}
                    </button>
                  ))}
                  <label className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
                    Período SMA
                    <input
                      type="number"
                      min={2}
                      max={400}
                      value={p.ind.smaP}
                      onChange={(e) => setPeriod("smaP", e.target.value)}
                      className="num w-16 rounded-md border bg-card px-2 py-0.5 text-foreground"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    Período EMA
                    <input
                      type="number"
                      min={2}
                      max={400}
                      value={p.ind.emaP}
                      onChange={(e) => setPeriod("emaP", e.target.value)}
                      className="num w-16 rounded-md border bg-card px-2 py-0.5 text-foreground"
                    />
                  </label>
                </div>
              </div>
            )}
            <div
              data-chart-area
              className="relative h-[60vh] min-h-[340px] p-1 lg:h-auto lg:flex-1"
            >
              {notice && (
                <div
                  role="status"
                  className={`absolute left-3 top-9 z-20 rounded-md border bg-popover px-3 py-1.5 text-xs shadow ${notice.pnl >= 0 ? "text-bull" : "text-bear"}`}
                >
                  Operação encerrada por tempo · {pair(notice.symbol)} ·{" "}
                  {notice.pnl >= 0 ? "+" : "-"}
                  {fmt(Math.abs(notice.pnl), 2)} USDT
                </div>
              )}
              {klines.isLoading ? (
                <div className="h-full animate-pulse rounded-lg bg-muted" />
              ) : klines.isError ? (
                <ErrorBox msg={(klines.error as Error).message} retry={() => klines.refetch()} />
              ) : (
                <div className="relative h-full">
                  <TradingChart
                    candles={chartCandles ?? NO_CANDLES}
                    type={p.type}
                    ind={chartInd}
                    symbol={p.symbol}
                    tf={p.tf}
                    onNeedHistory={loadOlder}
                    positions={chartPositions}
                    trades={chartTrades}
                    showMarks={p.marks}
                    closesIn={closesIn}
                  />
                  {klines.isPlaceholderData && (
                    <div className="absolute inset-0 animate-pulse rounded-lg bg-muted/60" />
                  )}
                </div>
              )}
            </div>
            <div className="border-t px-3 py-1 text-[11px] text-muted-foreground">
              {klines.dataUpdatedAt
                ? `Última atualização: ${new Date(klines.dataUpdatedAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                : ""}{" "}
              · {klines.data?.length ?? 0} candles reais · Dados podem ter atraso
            </div>
          </section>
        </main>

        <aside className="order-2 flex min-h-0 flex-col lg:order-3 lg:overflow-y-auto">
          <TradingPanel
            account={demo.account}
            symbol={p.symbol}
            prices={prices}
            now={now}
            onOpen={(side, amount, durationSec) =>
              demo.open({
                symbol: p.symbol,
                side,
                amount,
                price: prices[p.symbol] ?? 0,
                durationSec,
              })
            }
            onClose={demo.close}
            onReset={demo.reset}
          />
        </aside>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string;
  tone?: "bull" | "bear";
  big?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={`num ${big ? "text-xl font-semibold" : "text-sm"} ${tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
function ErrorBox({ msg, retry }: { msg: string; retry?: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/50 p-3 text-sm text-destructive">
      <AlertTriangle className="h-4 w-4" />
      {msg}
      {retry && (
        <button
          onClick={retry}
          className="ml-auto rounded border px-2 py-1 focus-visible:outline-2"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}
