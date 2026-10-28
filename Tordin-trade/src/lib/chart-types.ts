export type ChartType = "candle" | "line" | "area" | "bar";
export type IndicatorState = {
  sma: boolean;
  smaP: number;
  ema: boolean;
  emaP: number;
  ma9: boolean;
  ma21: boolean;
  ma50: boolean;
  ma200: boolean;
  bb: boolean;
  vwap: boolean;
  volume: boolean;
  rsi: boolean;
  macd: boolean;
  stoch: boolean;
};

/** Posição aberta do ativo exibido, desenhada como linha de preço de entrada. */
export type ChartPosition = {
  id: string;
  side: "buy" | "sell";
  entryPrice: number;
  pnl: number;
  /** Capital alocado e segundos restantes até o encerramento automático (quando houver). */
  amount?: number;
  remainingSec?: number | null;
};
/**
 * Operação simulada do ativo exibido. Tempos em segundos UTC.
 * Aberta: só entrada. Encerrada: entrada, saída, resultado e motivo.
 */
export type ChartTrade = {
  id: string;
  side: "buy" | "sell";
  entryTime: number;
  entryPrice: number;
  amount: number;
  status: "open" | "closed";
  exitTime?: number;
  exitPrice?: number;
  pnl?: number;
  reason?: "manual" | "expiry";
};
