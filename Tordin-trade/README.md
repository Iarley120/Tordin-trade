# Tordin Trade

Terminal de análise de criptomoedas com React 19, TanStack Start, TypeScript e lightweight-charts v5. A interface é em português do Brasil. Cotações e candles são obtidos da API pública da Binance; WebSocket é utilizado para atualizações, com consultas HTTP periódicas como alternativa.

## Ambiente

Node.js 22 ou superior. Gerenciador escolhido: **npm**.

```bash
npm install --legacy-peer-deps
npm run dev
```

## Validação

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run check
```

O script `test:e2e` está reservado para a suíte Playwright; ela ainda não foi adicionada. Não considere essa etapa homologada.

## Estrutura

- `src/components/TradingChart.tsx`: gráfico e séries de indicadores.
- `src/lib/indicators.ts`: cálculos dos indicadores.
- `src/lib/market.ts`: integração REST e WebSocket com Binance.
- `src/routes/index.tsx`: terminal, preferências e painéis.
- `src/lib/chart-types.ts`: tipos compartilhados.

## Limitações

A Binance pode impor limites de acesso ou bloquear requisições por região. Não há garantia de execução em tempo real ininterrupta. A aplicação não executa ordens reais. Recursos do roadmap não fazem parte desta entrega. A versão ainda exige validação de compilação, testes automatizados e testes em navegador.


## Gráfico de candles

O terminal utiliza `CandlestickSeries` da biblioteca `lightweight-charts` v5, alimentado por candles OHLC da Binance. O streaming WebSocket atualiza o último candle e a consulta REST carrega o histórico. Documentação: https://tradingview.github.io/lightweight-charts/docs/series-types#candlestick

> Estado: `typecheck`, `lint`, `test` (49 testes, incluindo gráfico com a biblioteca simulada, painel e cálculos financeiros) e `build` executados com sucesso. **Pendente:** validação visual em navegador real e testes E2E com Playwright (não executados no ambiente de correção).

### Comportamento do gráfico

- Períodos: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 1D, 1W, 1M (conforme a Binance).
- Atualização incremental do último candle e de novos candles (sem recriar o gráfico); troca de ativo/período limpa os dados anteriores antes de exibir os novos.
- Ao rolar para a esquerda, candles mais antigos são carregados automaticamente (até 5000 candles por ativo/período).
- Ferramentas de desenho (roadmap) ainda não implementadas.

## Operações demonstrativas (sem dinheiro real)

Painel **Operações** (lado direito): COMPRAR / ALTA e VENDER / BAIXA com confirmação, saldo, capital alocado, patrimônio, resultado, posições abertas/encerradas e movimentações. Nenhuma ordem real é enviada; não há depósito, saque ou corretora.

- Sem alavancagem; quantidade = valor ÷ preço de entrada; taxa demonstrativa de 0,1% por lado.
- Compra: (preço − entrada) × qtd. Venda: (entrada − preço) × qtd. Perda limitada ao capital alocado.
- Preço de marcação: cotação Binance mais recente (WebSocket/REST). Sem preço disponível, a operação é bloqueada.
- Persistência em `localStorage` (`tordin.demo-account.v1`), validada ao carregar e sincronizada entre abas.
- Gráfico: linha do preço de entrada com resultado ao vivo e marcadores de entrada (C/V) e saída.
- Lógica em `src/lib/trading.ts`; painel em `src/components/TradingPanel.tsx`.
