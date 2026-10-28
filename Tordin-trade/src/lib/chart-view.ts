/** Espaçamento-alvo entre velas (px) e limites de velas visíveis na abertura do gráfico. */
export const TARGET_BAR_SPACING = 9;
export const MIN_VISIBLE_BARS = 40;
export const MAX_VISIBLE_BARS = 240;
export const RIGHT_PADDING_BARS = 8;
const FALLBACK_WIDTH = 900;

/**
 * Faixa lógica inicial: as velas mais recentes, ocupando a largura disponível com espaçamento
 * confortável, mais uma folga à direita para a vela em formação e as etiquetas do eixo.
 * Em vez de ampliar as velas, escolhe-se quantas velas cabem na tela.
 */
export function recentRange(count: number, width: number): { from: number; to: number } {
  const usable = Number.isFinite(width) && width > 0 ? width : FALLBACK_WIDTH;
  const fit = Math.round(usable / TARGET_BAR_SPACING);
  const visible = Math.min(MAX_VISIBLE_BARS, Math.max(MIN_VISIBLE_BARS, fit));
  const shown = Math.min(count, visible);
  return { from: count - shown - 0.5, to: count - 1 + RIGHT_PADDING_BARS };
}
