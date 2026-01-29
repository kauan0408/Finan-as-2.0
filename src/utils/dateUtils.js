// =========================
// Funções de mês financeiro
// =========================

export function getMesFinanceiroIntervalo(dataBase, diaPagamento) {
  const d = new Date(dataBase);

  const dia = Number(diaPagamento) || 1;

  // define início e fim do mês financeiro
  let inicio = new Date(d.getFullYear(), d.getMonth(), dia);
  let fim = new Date(d.getFullYear(), d.getMonth() + 1, dia - 1);

  // se o usuário ainda não chegou no dia X deste mês → volta 1 mês
  const hoje = new Date();
  if (hoje < inicio) {
    inicio.setMonth(inicio.getMonth() - 1);
    fim.setMonth(fim.getMonth() - 1);
  }

  const rotulo = nomeMes(inicio.getMonth()) + " / " + inicio.getFullYear();

  return { inicio, fim, rotulo };
}

export function nomeMes(m) {
  return [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ][m];
}


// =========================
// Criar parcelas automáticas
// =========================

export function gerarParcelas(transacaoBase) {
  const parcelas = [];
  const totalParcelas = Number(transacaoBase.parcelas || 1);

  for (let i = 0; i < totalParcelas; i++) {
    const data = new Date(transacaoBase.dataHora);
    data.setMonth(data.getMonth() + i);

    parcelas.push({
      ...transacaoBase,
      id: transacaoBase.id + "_p" + (i + 1),
      descricao:
        transacaoBase.descricao +
        ` (parcela ${i + 1}/${totalParcelas})`,
      dataHora: data.toISOString(),
    });
  }

  return parcelas;
}
