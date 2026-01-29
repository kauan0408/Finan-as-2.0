import { addMesBaseadoData } from "./financeDate";

export function gerarParcelas(transacaoBase, qtdParcelas) {
  const parcelas = [];
  const valorParcela = transacaoBase.valor / qtdParcelas;

  for (let i = 0; i < qtdParcelas; i++) {
    parcelas.push({
      ...transacaoBase,
      id: `${transacaoBase.id}-${i + 1}`,
      valor: Number(valorParcela.toFixed(2)),
      parcelaNumero: i + 1,
      parcelaTotal: qtdParcelas,
      dataHora: addMesBaseadoData(transacaoBase.dataHora, i)
    });
  }

  return parcelas;
}
