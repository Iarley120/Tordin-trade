import type { Candle } from "./indicators";

type Scheduler = {
  request: (cb: () => void) => number;
  cancel: (id: number) => void;
};
const rafScheduler: Scheduler = {
  request: (cb) => requestAnimationFrame(() => cb()),
  cancel: (id) => cancelAnimationFrame(id),
};

/**
 * Agrupa as mensagens de candle do WebSocket e as entrega no máximo uma vez por quadro de
 * animação. Cada mensagem traz o estado completo (abertura/máxima/mínima/fechamento/volume) do
 * candle, então manter só a última por horário não perde informação; candles de horários
 * diferentes (o que fechou e o novo) são todos entregues, em ordem cronológica.
 */
export function createCandleBatcher(
  flush: (candles: Candle[]) => void,
  scheduler: Scheduler = rafScheduler,
) {
  const pending = new Map<number, Candle>();
  let handle: number | null = null;
  const run = () => {
    handle = null;
    if (!pending.size) return;
    const batch = [...pending.values()].sort((a, b) => a.time - b.time);
    pending.clear();
    flush(batch);
  };
  return {
    push(candle: Candle) {
      pending.set(candle.time, candle);
      if (handle === null) handle = scheduler.request(run);
    },
    /** Descarta o que está pendente (ex.: ao trocar de ativo/período). */
    dispose() {
      if (handle !== null) scheduler.cancel(handle);
      handle = null;
      pending.clear();
    },
  };
}
