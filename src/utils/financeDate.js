// -----------------------------------------
// FUNÇÕES DE DATA PARA MÊS FINANCEIRO
// -----------------------------------------

// Retorna { ano, mes } do mês financeiro ATUAL
export function getMesFinanceiroAtual(diaPagamento) {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth(); // 0 = Janeiro

  // Exemplo: se hoje é dia 08 e o pagamento é dia 10
  // está no mês financeiro ANTERIOR
  if (hoje.getDate() >= diaPagamento) {
    return { ano, mes };
  } else {
    const mesAnterior = mes - 1;
    const anoCorrigido = mesAnterior < 0 ? ano - 1 : ano;
    const mesCorrigido = mesAnterior < 0 ? 11 : mesAnterior;
    return { ano: anoCorrigido, mes: mesCorrigido };
  }
}

// Avança 1 mês financeiro
export function addMesFinanceiro({ ano, mes }) {
  const novoMes = mes + 1;
  if (novoMes > 11) {
    return { ano: ano + 1, mes: 0 };
  }
  return { ano, mes: novoMes };
}

// Retrocede 1 mês financeiro
export function subMesFinanceiro({ ano, mes }) {
  const novoMes = mes - 1;
  if (novoMes < 0) {
    return { ano: ano - 1, mes: 11 };
  }
  return { ano, mes: novoMes };
}

// Formata "2024-01-01" → "01/01/2024"
export function formatarData(dt) {
  const data = new Date(dt);
  return data.toLocaleDateString("pt-BR");
}

// Gera datas mensais para parcelas
export function addMesBaseadoData(data, quantidadeMeses) {
  const d = new Date(data);
  d.setMonth(d.getMonth() + quantidadeMeses);
  return d.toISOString();
}

// Verifica se uma transação pertence ao mês financeiro selecionado
export function pertenceAoMesFinanceiro(transacao, mesFinanceiro) {
  const data = new Date(transacao.dataHora);
  const ano = data.getFullYear();
  const mes = data.getMonth();

  return ano === mesFinanceiro.ano && mes === mesFinanceiro.mes;
}
