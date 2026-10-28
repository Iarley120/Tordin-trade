import { useRef, useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { fmt } from "@/lib/market";
import {
  allocated,
  DEFAULT_BALANCE,
  DEFAULT_DURATION,
  DURATION_STEPS,
  equity,
  FEE_RATE,
  MAX_BALANCE,
  MIN_AMOUNT,
  MIN_BALANCE,
  realizedPnl,
  remainingSeconds,
  unrealizedPnl,
  type Account,
  type Result,
  type Side,
} from "@/lib/trading";

type Tab = "abertas" | "encerradas" | "movimentos";
const money = (n: number) => `${n >= 0 ? "" : "-"}${fmt(Math.abs(n), 2)}`;
const signed = (n: number) => `${n >= 0 ? "+" : "-"}${fmt(Math.abs(n), 2)}`;
const tone = (n: number) => (n >= 0 ? "text-bull" : "text-bear");
const pair = (s: string) => s.replace("USDT", "/USDT");
const when = (t: number) =>
  new Date(t).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}
const stepFor = (v: number) => (v < 100 ? 10 : v < 1000 ? 50 : v < 10000 ? 250 : 1000);
const DOUBLE_CLICK_GUARD_MS = 800;

export function TradingPanel({
  account,
  symbol,
  prices,
  onOpen,
  onClose,
  onReset,
  now = Date.now(),
}: {
  account: Account;
  symbol: string;
  prices: Record<string, number | undefined>;
  onOpen: (side: Side, amount: number, durationSec: number) => Result;
  onClose: (id: string, price: number) => Result;
  onReset: (balance: number) => void;
  /** Relógio (ms) usado para a contagem regressiva; atualizado pelo componente pai. */
  now?: number;
}) {
  const [amountText, setAmountText] = useState("1000");
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [pending, setPending] = useState<Side | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState<Tab>("abertas");
  const [balanceText, setBalanceText] = useState(String(DEFAULT_BALANCE));
  const [confirmReset, setConfirmReset] = useState(false);
  const lastOpen = useRef(0);

  const price = prices[symbol];
  const amount = Number(amountText.replace(",", "."));
  const amountValid = Number.isFinite(amount) && amount >= MIN_AMOUNT;
  const maxAmount = Math.max(0, Math.floor((account.cash / (1 + FEE_RATE)) * 100) / 100);
  const overBalance = amountValid && amount > maxAmount + 1e-9;
  const eq = equity(account, prices);
  const unreal = account.positions.reduce((s, p) => {
    const px = prices[p.symbol];
    return s + (px ? unrealizedPnl(p, px) : 0);
  }, 0);
  const total = eq - account.initialBalance;

  const bumpAmount = (dir: 1 | -1) => {
    const base = amountValid ? amount : MIN_AMOUNT;
    const next = dir > 0 ? Math.min(maxAmount, base + stepFor(base)) : base - stepFor(base - 1);
    const clamped = Math.max(MIN_AMOUNT, next);
    setAmountText(String(Math.round(clamped * 100) / 100));
    setPending(null);
  };
  const bumpDuration = (dir: 1 | -1) => {
    const steps: readonly number[] = DURATION_STEPS;
    const idx = steps.indexOf(duration);
    const next = steps[Math.min(steps.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + dir))];
    setDuration(next ?? DEFAULT_DURATION);
    setPending(null);
  };
  const request = (side: Side) => {
    setMessage(null);
    if (!price) {
      setMessage({ ok: false, text: "Preço de mercado indisponível." });
      return;
    }
    if (!amountValid) {
      setMessage({ ok: false, text: `Informe um valor de pelo menos ${MIN_AMOUNT} USDT.` });
      return;
    }
    if (overBalance) {
      setMessage({ ok: false, text: "Saldo disponível insuficiente (valor + taxa)." });
      return;
    }
    setPending(side);
  };
  const confirm = () => {
    if (!pending) return;
    // Evita operações duplicadas por cliques repetidos.
    const t = Date.now();
    if (t - lastOpen.current < DOUBLE_CLICK_GUARD_MS) return;
    lastOpen.current = t;
    const r = onOpen(pending, amount, duration);
    setPending(null);
    setMessage(
      r.ok
        ? {
            ok: true,
            text: `${pending === "buy" ? "Compra" : "Venda"} simulada registrada · ${formatClock(duration)}.`,
          }
        : { ok: false, text: r.error },
    );
    if (r.ok) setTab("abertas");
  };
  const closeIt = (id: string, px: number | undefined) => {
    if (!px) {
      setMessage({ ok: false, text: "Preço de mercado indisponível." });
      return;
    }
    const r = onClose(id, px);
    setMessage(r.ok ? { ok: true, text: "Posição encerrada." } : { ok: false, text: r.error });
  };
  const doReset = () => {
    const b = Number(balanceText.replace(",", "."));
    if (!Number.isFinite(b) || b < MIN_BALANCE || b > MAX_BALANCE) {
      setMessage({
        ok: false,
        text: `Saldo inicial entre ${MIN_BALANCE} e ${fmt(MAX_BALANCE, 0)} USDT.`,
      });
      setConfirmReset(false);
      return;
    }
    onReset(b);
    setConfirmReset(false);
    setPending(null);
    setMessage({ ok: true, text: "Conta demonstrativa redefinida." });
  };

  return (
    <div className="flex min-h-0 flex-col rounded-xl bg-panel p-3 lg:h-full">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{pair(symbol)}</div>
          <div className="num text-[11px] text-muted-foreground">
            Preço atual {price ? fmt(price) : "—"}
          </div>
        </div>
        <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
          Demonstrativo · sem dinheiro real
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stepper
          label="Tempo"
          value={formatClock(duration)}
          onMinus={() => bumpDuration(-1)}
          onPlus={() => bumpDuration(1)}
          minusLabel="Diminuir tempo"
          plusLabel="Aumentar tempo"
        />
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Valor (USDT)</div>
          <div className="flex items-center rounded-md border bg-card">
            <StepButton label="Diminuir valor" onClick={() => bumpAmount(-1)}>
              <Minus className="h-3.5 w-3.5" />
            </StepButton>
            <input
              aria-label="Valor da operação"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => {
                setAmountText(e.target.value);
                setPending(null);
              }}
              className="num min-w-0 flex-1 bg-transparent px-1 py-1.5 text-center text-sm outline-none"
            />
            <StepButton label="Aumentar valor" onClick={() => bumpAmount(1)}>
              <Plus className="h-3.5 w-3.5" />
            </StepButton>
          </div>
        </div>
      </div>
      <div
        className={`mt-1 text-[11px] ${overBalance ? "text-bear" : "text-muted-foreground"}`}
      >
        {overBalance
          ? `Acima do saldo disponível (máx. ${fmt(maxAmount, 2)})`
          : `Disponível ${money(account.cash)} · taxa ${(FEE_RATE * 100).toFixed(1)}%`}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => request("buy")}
          className="rounded-md bg-bull px-2 py-3 text-xs font-bold text-background hover:opacity-90"
        >
          COMPRAR / ALTA
        </button>
        <button
          onClick={() => request("sell")}
          className="rounded-md bg-bear px-2 py-3 text-xs font-bold text-background hover:opacity-90"
        >
          VENDER / BAIXA
        </button>
      </div>
      {pending && price && (
        <div className="mt-2 rounded-md border p-2 text-[11px]">
          <div className="num">
            Confirmar {pending === "buy" ? "COMPRA" : "VENDA"} simulada de {fmt(amount, 2)} USDT em{" "}
            {pair(symbol)} a {fmt(price)}?
          </div>
          <div className="mt-0.5 text-muted-foreground">
            Qtd. {fmt(amount / price, 6)} · taxa demo {fmt(amount * FEE_RATE, 2)} USDT · encerra em{" "}
            {formatClock(duration)}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={confirm}
              className="rounded-md bg-primary px-3 py-1 text-primary-foreground"
            >
              Confirmar
            </button>
            <button
              onClick={() => setPending(null)}
              className="rounded-md border px-3 py-1 text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {message && (
        <div
          role="status"
          className={`mt-2 text-[11px] ${message.ok ? "text-bull" : "text-bear"}`}
        >
          {message.text}
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-2">
        <Row label="Disponível" value={money(account.cash)} />
        <Row label="Comprometido" value={money(allocated(account))} />
        <Row label="Resultado total" value={signed(total)} cls={tone(total)} />
      </div>
      <details className="mt-1 text-[11px]">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Mais detalhes da carteira
        </summary>
        <div className="mt-1 grid grid-cols-3 gap-2">
          <Row label="Patrimônio" value={money(eq)} />
          <Row label="Em aberto" value={signed(unreal)} cls={tone(unreal)} />
          <Row
            label="Realizado"
            value={signed(realizedPnl(account))}
            cls={tone(realizedPnl(account))}
          />
        </div>
      </details>

      <div className="mt-3 flex gap-1 border-b pb-2 text-xs">
        {(
          [
            ["abertas", `Abertas (${account.positions.length})`],
            ["encerradas", `Encerradas (${account.closed.length})`],
            ["movimentos", "Movimentações"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            aria-pressed={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-md px-2 py-1 ${tab === k ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="min-h-24 flex-1 overflow-y-auto pt-2 text-[11px]">
        {tab === "abertas" &&
          (account.positions.length === 0 ? (
            <Empty text="Nenhuma posição aberta." />
          ) : (
            [...account.positions].reverse().map((p) => {
              const px = prices[p.symbol];
              const pnl = px ? unrealizedPnl(p, px) : 0;
              const left = remainingSeconds(p, now);
              return (
                <div key={p.id} className="border-b py-2 last:border-0">
                  <div className="flex justify-between">
                    <span
                      className={`font-semibold ${p.side === "buy" ? "text-bull" : "text-bear"}`}
                    >
                      {p.side === "buy" ? "COMPRA" : "VENDA"} {pair(p.symbol)}
                    </span>
                    <span className={`num ${tone(pnl)}`}>
                      {signed(pnl)} ({signed((pnl / p.amount) * 100)}%)
                    </span>
                  </div>
                  <div className="num mt-0.5 text-muted-foreground">
                    Entrada {fmt(p.entryPrice)} · Atual {px ? fmt(px) : "—"} · Alocado{" "}
                    {fmt(p.amount, 2)}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    {left !== null && (
                      <span
                        aria-label={`Tempo restante ${formatClock(left)}`}
                        className="num rounded-md bg-accent px-2 py-0.5 text-foreground"
                      >
                        {left === 0 ? "Encerrando…" : formatClock(left)}
                      </span>
                    )}
                    <button
                      onClick={() => closeIt(p.id, px)}
                      className="rounded-md border px-2 py-0.5 text-foreground hover:bg-accent"
                    >
                      Encerrar
                    </button>
                  </div>
                </div>
              );
            })
          ))}
        {tab === "encerradas" &&
          (account.closed.length === 0 ? (
            <Empty text="Nenhuma operação encerrada." />
          ) : (
            [...account.closed].reverse().map((t) => (
              <div key={t.id} className="border-b py-2 last:border-0">
                <div className="flex justify-between">
                  <span className={`font-semibold ${t.side === "buy" ? "text-bull" : "text-bear"}`}>
                    {t.side === "buy" ? "COMPRA" : "VENDA"} {pair(t.symbol)}
                    {t.closeReason === "expiry" && (
                      <span className="ml-1 font-normal text-muted-foreground">· por tempo</span>
                    )}
                  </span>
                  <span className={`num ${tone(t.pnl)}`}>{signed(t.pnl)}</span>
                </div>
                <div className="num mt-0.5 text-muted-foreground">
                  {fmt(t.entryPrice)} → {fmt(t.exitPrice)} · Alocado {fmt(t.amount, 2)} · Taxas{" "}
                  {fmt(t.openFee + t.closeFee, 2)} · {when(t.closedAt)}
                </div>
              </div>
            ))
          ))}
        {tab === "movimentos" &&
          [...account.movements].reverse().map((m) => (
            <div key={m.id} className="border-b py-1.5 last:border-0">
              <div className="flex justify-between">
                <span>{m.note}</span>
                <span className={`num ${tone(m.delta)}`}>{signed(m.delta)}</span>
              </div>
              <div className="num text-muted-foreground">
                {when(m.time)} · Saldo {money(m.balanceAfter)}
              </div>
            </div>
          ))}
      </div>

      <details className="mt-2 border-t pt-2">
        <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
          Configurações da conta demonstrativa
        </summary>
        <label className="mt-2 block text-[11px] text-muted-foreground">
          Saldo inicial da conta (USDT)
          <input
            aria-label="Saldo inicial"
            inputMode="decimal"
            value={balanceText}
            onChange={(e) => {
              setBalanceText(e.target.value);
              setConfirmReset(false);
            }}
            className="num mt-1 w-full rounded-md border bg-card px-2 py-1 text-xs text-foreground"
          />
        </label>
        {confirmReset ? (
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            <span className="text-bear">Apagar posições e histórico?</span>
            <button onClick={doReset} className="rounded-md bg-bear px-2 py-1 text-background">
              Sim, redefinir
            </button>
            <button
              onClick={() => setConfirmReset(false)}
              className="rounded-md border px-2 py-1 text-muted-foreground"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmReset(true)}
            className="mt-2 rounded-md border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Redefinir conta demonstrativa
          </button>
        )}
        <div className="mt-2 text-[10px] text-muted-foreground">
          Sem alavancagem · taxa demonstrativa de {(FEE_RATE * 100).toFixed(1)}% por lado ·
          resultado calculado pelo preço de mercado da Binance. Ambiente demonstrativo: não há
          depósitos, saques nem ordens reais.
        </div>
      </details>
    </div>
  );
}
function StepButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-8 w-8 shrink-0 place-items-center text-muted-foreground hover:text-foreground"
    >
      {children}
    </button>
  );
}
function Stepper({
  label,
  value,
  onMinus,
  onPlus,
  minusLabel,
  plusLabel,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  minusLabel: string;
  plusLabel: string;
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-muted-foreground">{label}</div>
      <div className="flex items-center rounded-md border bg-card">
        <StepButton label={minusLabel} onClick={onMinus}>
          <Minus className="h-3.5 w-3.5" />
        </StepButton>
        <div aria-label={`${label} da operação`} className="num flex-1 text-center text-sm">
          {value}
        </div>
        <StepButton label={plusLabel} onClick={onPlus}>
          <Plus className="h-3.5 w-3.5" />
        </StepButton>
      </div>
    </div>
  );
}
function Row({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`num text-sm ${cls ?? ""}`}>{value}</div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="py-2 text-muted-foreground">{text}</div>;
}
