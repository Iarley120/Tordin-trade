import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TradingPanel } from "./TradingPanel";
import { createAccount, openPosition } from "@/lib/trading";

const setup = (overrides: Partial<Parameters<typeof TradingPanel>[0]> = {}) => {
  const onOpen = vi.fn(() => ({ ok: true as const, account: createAccount() }));
  const onClose = vi.fn(() => ({ ok: true as const, account: createAccount() }));
  const onReset = vi.fn();
  render(
    <TradingPanel
      account={createAccount(10000, 1)}
      symbol="BTCUSDT"
      prices={{ BTCUSDT: 50000 }}
      onOpen={onOpen}
      onClose={onClose}
      onReset={onReset}
      {...overrides}
    />,
  );
  return { onOpen, onClose, onReset };
};

describe("TradingPanel", () => {
  it("exige confirmação antes de abrir a operação simulada", () => {
    const { onOpen } = setup();
    fireEvent.click(screen.getByText("COMPRAR / ALTA"));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirmar"));
    expect(onOpen).toHaveBeenCalledWith("buy", 1000, 60);
  });
  it("VENDER / BAIXA abre posição de venda", () => {
    const { onOpen } = setup();
    fireEvent.click(screen.getByText("VENDER / BAIXA"));
    fireEvent.click(screen.getByText("Confirmar"));
    expect(onOpen).toHaveBeenCalledWith("sell", 1000, 60);
  });
  it("valida valor mínimo e não chama a operação", () => {
    const { onOpen } = setup();
    fireEvent.change(screen.getByLabelText("Valor da operação"), { target: { value: "3" } });
    fireEvent.click(screen.getByText("COMPRAR / ALTA"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("pelo menos");
  });
  it("sem preço de mercado não permite operar", () => {
    const { onOpen } = setup({ prices: {} });
    fireEvent.click(screen.getByText("COMPRAR / ALTA"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("indisponível");
  });
  it("mostra posição aberta com resultado e permite encerrar", () => {
    const r = openPosition(createAccount(10000, 1), {
      symbol: "BTCUSDT",
      side: "buy",
      amount: 1000,
      price: 40000,
      now: 2,
    });
    if (!r.ok) throw new Error(r.error);
    const { onClose } = setup({ account: r.account, prices: { BTCUSDT: 50000 } });
    expect(screen.getAllByText(/\+250,00/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Encerrar"));
    expect(onClose).toHaveBeenCalledWith(r.account.positions[0]!.id, 50000);
  });
  it("ajusta o tempo da operação com os botões e usa a duração escolhida", () => {
    const { onOpen } = setup();
    fireEvent.click(screen.getByLabelText("Aumentar tempo"));
    expect(screen.getByLabelText("Tempo da operação").textContent).toBe("02:00");
    fireEvent.click(screen.getByLabelText("Diminuir tempo"));
    fireEvent.click(screen.getByLabelText("Diminuir tempo"));
    expect(screen.getByLabelText("Tempo da operação").textContent).toBe("00:30");
    fireEvent.click(screen.getByText("COMPRAR / ALTA"));
    fireEvent.click(screen.getByText("Confirmar"));
    expect(onOpen).toHaveBeenCalledWith("buy", 1000, 30);
  });
  it("botões de valor respeitam mínimo e saldo disponível", () => {
    setup({ account: createAccount(100, 1) });
    const input = screen.getByLabelText("Valor da operação") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "95" } });
    fireEvent.click(screen.getByLabelText("Aumentar valor"));
    expect(Number(input.value)).toBeLessThanOrEqual(99.9);
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.click(screen.getByLabelText("Diminuir valor"));
    expect(Number(input.value)).toBe(10);
  });
  it("não permite operação acima do saldo disponível", () => {
    const { onOpen } = setup({ account: createAccount(500, 1) });
    fireEvent.change(screen.getByLabelText("Valor da operação"), { target: { value: "800" } });
    fireEvent.click(screen.getByText("COMPRAR / ALTA"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("insuficiente");
  });
  it("cliques repetidos em Confirmar não duplicam a operação", () => {
    const { onOpen } = setup();
    fireEvent.click(screen.getByText("COMPRAR / ALTA"));
    const confirm = screen.getByText("Confirmar");
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it("mostra a contagem regressiva da posição aberta", () => {
    const r = openPosition(createAccount(10000, 1), {
      symbol: "BTCUSDT",
      side: "buy",
      amount: 1000,
      price: 40000,
      now: 1_000_000,
      durationSec: 60,
    });
    if (!r.ok) throw new Error(r.error);
    setup({ account: r.account, now: 1_015_000 });
    expect(screen.getByLabelText("Tempo restante 00:45")).toBeTruthy();
  });
  it("redefinir exige confirmação e usa o saldo informado", () => {
    const { onReset } = setup();
    fireEvent.change(screen.getByLabelText("Saldo inicial"), { target: { value: "2500" } });
    fireEvent.click(screen.getByText("Redefinir conta demonstrativa"));
    expect(onReset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Sim, redefinir"));
    expect(onReset).toHaveBeenCalledWith(2500);
  });
});
