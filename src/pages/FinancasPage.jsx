  // src/pages/FinancasPage.jsx

// Importa React e o hook useMemo (para memorizar cálculos pesados e evitar refazer a cada render)
import React, { useMemo } from "react";

// Importa o hook do seu Context (useFinance) que fornece dados e funções do app (transações, perfil, mês atual etc.)
import { useFinance } from "../App.jsx";

// Formata um número como moeda BRL (pt-BR), garantindo que valores nulos/undefined virem 0
function formatCurrency(value) {
  const num = Number(value || 0);
  return num.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/* ✅ Cálculo do próximo pagamento (baseado no DIA do perfil, e na data de HOJE) */
// Recebe o dia (1..31) e calcula qual é a próxima data de pagamento a partir de "hoje".
// Retorna também quantos dias faltam.
function calcularProximoPagamento(diaPagamento) {
  // Converte o dia vindo do perfil (string/number) para number
  const dia = Number(diaPagamento);

  // Valida: se não for um dia válido (1 a 31), não calcula
  if (!dia || dia < 1 || dia > 31) return null;

  // Data/hora atual (agora)
  const hoje = new Date();

  // Função interna: cria uma data no mês/ano desejado, mas ajusta para o último dia do mês
  // (ex.: se pedir dia 31 em fevereiro, vira dia 28/29)
  const criarDataCerta = (ano, mes, diaDesejado) => {
    // Calcula o último dia do mês (dia 0 do próximo mês = último dia do mês atual)
    const ultimoDiaDoMes = new Date(ano, mes + 1, 0).getDate();

    // Escolhe o menor entre o dia desejado e o último dia do mês
    const d = Math.min(diaDesejado, ultimoDiaDoMes);

    // Retorna a data ajustada
    return new Date(ano, mes, d);
  };

  // tenta este mês
  // Cria a data de pagamento no mês atual (com o dia escolhido)
  let proximo = criarDataCerta(hoje.getFullYear(), hoje.getMonth(), dia);

  // se já passou (ou é hoje mais cedo), joga para o próximo mês
  // Se a data calculada for menor que "agora", então o pagamento desse mês já passou
  if (proximo < hoje) {
    // Ano atual
    const ano2 = hoje.getFullYear();

    // Próximo mês (getMonth() é 0..11; somar 1 vai para o mês seguinte)
    const mes2 = hoje.getMonth() + 1;

    // Recalcula a data para o mês seguinte
    proximo = criarDataCerta(ano2, mes2, dia);
  }

  // Diferença em milissegundos entre a data do próximo pagamento e agora
  const diffMs = proximo - hoje;

  // Converte ms -> dias (arredonda pra cima: se faltar 0,2 dia, conta como 1 dia)
  const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  // Retorna a data calculada e quantos dias faltam
  return { data: proximo, diasRestantes: diffDias };
}

// pega o valor do gasto fixo no mês selecionado.
// se não tiver valor naquele mês, herda o valor mais recente anterior.
// Ex.: se o usuário configurou aluguel em 2025-12 e não configurou em 2026-01,
// então em 2026-01 usa o de 2025-12.
function getValorFixo(valoresPorMes = {}, chaveMes) {
  // Se existe valor exatamente para o mês selecionado, usa ele
  if (valoresPorMes && valoresPorMes[chaveMes] != null) {
    return Number(valoresPorMes[chaveMes]);
  }

  // Pega todos os meses cadastrados ("YYYY-MM") e ordena em ordem crescente
  const meses = Object.keys(valoresPorMes || {}).sort(); // "YYYY-MM" ordena certo

  // Guarda o último mês encontrado que seja <= ao mês selecionado
  let ultimo = null;

  // Varre os meses e atualiza "ultimo" sempre que encontrar um mês até o mês atual
  for (const m of meses) {
    if (m <= chaveMes) ultimo = m;
  }

  // Se encontrou um mês anterior, retorna o valor dele; senão, retorna 0
  return ultimo ? Number(valoresPorMes[ultimo]) : 0;
}

// ✅ normaliza nomes p/ unificar (Uber, uber, " Uber  " -> "uber")
// Isso ajuda a agrupar despesas iguais no Top 5, mesmo se o usuário digitar com variações.
function normalizarNome(descricao) {
  return String(descricao || "")
    .trim() // remove espaços no começo/fim
    .toLowerCase() // deixa tudo minúsculo
    .replace(/\s+/g, " "); // troca múltiplos espaços por um único espaço
}

// Componente principal da página de Finanças (visão geral do mês)
export default function FinancasPage() {
  // Puxa do contexto:
  // - transacoes: lista de transações (receitas/despesas)
  // - profile: dados do usuário (salários, dia de pagamento, gastos fixos, limite etc.)
  // - mesReferencia: qual mês/ano está sendo visualizado na tela
  // - mudarMesReferencia: função para avançar/voltar mês
  // - irParaMesAtual: função que retorna para o mês atual
  const {
    transacoes,
    profile,
    mesReferencia,
    mudarMesReferencia,
    irParaMesAtual,
  } = useFinance();

  /* RESUMO DO MÊS ESCOLHIDO */
  // useMemo: calcula o resumo do mês só quando (transacoes, mesReferencia, profile.gastosFixos) mudarem
  // (evita recalcular tudo em todo render).
  const resumo = useMemo(() => {
    // Extrai mes e ano do mês que está sendo visto
    const { mes, ano } = mesReferencia;

    // Acumuladores do resumo
    let receitas = 0; // soma das receitas do mês
    let despesasTransacoes = 0; // soma das despesas lançadas como transação no mês
    let gastosCartao = 0; // soma de despesas pagas no crédito no mês (para “Crédito usado”)

    // Soma por categorias (só essencial e lazer aqui)
    let categorias = {
      essencial: 0,
      lazer: 0,
    };

    // Soma por semana (4 semanas, aproximado por blocos de 7 dias)
    const semanas = [0, 0, 0, 0];

    // chave do mês selecionado: "2026-01", etc.
    // (mesReferencia.mes é 0..11, então soma 1 para ficar 1..12 e formata com 2 dígitos)
    const chaveMes = `${ano}-${String(mes + 1).padStart(2, "0")}`;

    // gastos fixos vindo do perfil (não transações)
    // Aqui você pega profile.gastosFixos e transforma num array pronto para somar/exibir no mês selecionado.
    const gastosFixosPerfil = (Array.isArray(profile?.gastosFixos)
      ? profile.gastosFixos
      : []
    )
      // Mantém só os ativos (se g.ativo === false, remove)
      .filter((g) => g.ativo !== false)
      // Remove itens de “educacao” (por nome ou categoria), para não entrar no resumo
      .filter(
        (g) =>
          (g.nome || "").toLowerCase() !== "educacao" &&
          (g.categoria || "").toLowerCase() !== "educacao"
      )
      // Mapeia para o formato que a tela usa
      .map((g) => ({
        id: g.id, // id do gasto fixo
        descricao: g.nome, // nome vira descrição
        categoria: (g.categoria || "").toLowerCase(), // categoria normalizada
        // pega o valor do mês atual ou herda o anterior (getValorFixo)
        valor: getValorFixo(g.valoresPorMes || {}, chaveMes),
      }))
      // Remove gastos com valor 0 (não polui a tela)
      .filter((g) => Number(g.valor) > 0);

    // transações do mês
    // Varre todas as transações e soma apenas as que pertencem ao mês/ano selecionados.
    transacoes.forEach((t) => {
      // Converte a data/hora da transação em Date
      const dt = new Date(t.dataHora);

      // Só considera se for do mesmo mês/ano
      if (dt.getMonth() === mes && dt.getFullYear() === ano) {
        // Pega o valor numérico
        const valor = Number(t.valor || 0);

        // Se for receita, soma em receitas
        if (t.tipo === "receita") {
          receitas += valor;

          // Se for despesa, soma em despesasTransacoes e faz detalhamentos
        } else if (t.tipo === "despesa") {
          despesasTransacoes += valor;

          // Se a despesa foi paga no crédito, soma também em "gastosCartao"
          if (t.formaPagamento === "credito") {
            gastosCartao += valor;
          }

          // Soma na categoria correspondente (só essencial/lazer)
          const cat = (t.categoria || "").toLowerCase();
          if (cat === "essencial") categorias.essencial += valor;
          if (cat === "lazer") categorias.lazer += valor;

          // Soma por semana (divide o mês em 4 blocos de 7 dias)
          const dia = dt.getDate(); // 1..31
          const semanaIndex = Math.min(3, Math.floor((dia - 1) / 7)); // 0..3
          semanas[semanaIndex] += valor;
        }
      }
    });

    // soma de gastos fixos do mês
    // Soma o valor de todos os gastos fixos do perfil naquele mês
    const totalGastosFixos = gastosFixosPerfil.reduce(
      (acc, g) => acc + Number(g.valor || 0),
      0
    );

    // DESPESA FINAL DO MÊS (transações + fixos)
    // Total de despesas usado no resumo geral
    const despesas = despesasTransacoes + totalGastosFixos;

    // fixos entram na pizza por categoria
    // Além de somar no total de despesas, os fixos também entram na divisão por categoria (pizza).
    gastosFixosPerfil.forEach((g) => {
      const v = Number(g.valor || 0);
      if (!v) return;

      const cat = (g.categoria || "").toLowerCase();
      if (cat === "essencial") categorias.essencial += v;
      if (cat === "lazer") categorias.lazer += v;
    });

    // Saldo simples do mês (receitas - despesas)
    const saldo = receitas - despesas;

    // ✅ TOP 5 gastos UNIFICADOS por NOME (no mês selecionado)
    // ✅ não conta valor 0
    // Cria um mapa para agrupar despesas por “nome normalizado” (ex.: “Uber”, “ uber ” -> “uber”)
    const mapa = new Map();

    // Varre transações e pega só as despesas do mês selecionado
    transacoes.forEach((t) => {
      const dt = new Date(t.dataHora);

      // Só despesas do mês/ano selecionado
      if (
        t.tipo === "despesa" &&
        dt.getMonth() === mes &&
        dt.getFullYear() === ano
      ) {
        const v = Number(t.valor || 0);

        // Ignora valor 0 (não soma e não conta)
        if (!v) return; // ✅ não soma e não conta quando for 0

        // Normaliza o nome para usar como chave de agrupamento
        const key = normalizarNome(t.descricao || "Sem descrição");

        // Pega o registro atual ou cria um novo
        const atual = mapa.get(key) || {
          descricao: t.descricao || "Sem descrição", // nome para exibir
          valor: 0, // soma total
          count: 0, // quantas vezes apareceu
        };

        // Soma valor e incrementa contagem
        atual.valor += v;
        atual.count += 1;

        // mantém uma descrição “bonita”
        // Se a descrição atual estiver vazia ou “Sem descrição” e vier uma descrição melhor, substitui
        if (
          (!atual.descricao || atual.descricao === "Sem descrição") &&
          t.descricao
        ) {
          atual.descricao = t.descricao;
        }

        // Salva/atualiza no mapa
        mapa.set(key, atual);
      }
    });

    // Converte o mapa em array, ordena por valor desc, pega os 5 maiores e cria um id estável
    const topDespesas = Array.from(mapa.values())
      .sort((a, b) => Number(b.valor) - Number(a.valor))
      .slice(0, 5)
      .map((x, idx) => ({
        id: `top-${idx}`, // id para o React key
        descricao: x.descricao, // nome para exibir
        valor: x.valor, // total gasto nesse item
        count: x.count, // quantas ocorrências
      }));

    // Total de categorias (evita divisão por zero colocando 1 se der 0)
    const totalCat = categorias.essencial + categorias.lazer || 1;

    // Retorna tudo o que a tela precisa mostrar
    return {
      receitas, // total receitas do mês
      despesas, // total despesas do mês (transações + fixos)
      saldo, // receitas - despesas
      gastosCartao, // total no crédito (apenas despesas com formaPagamento === "credito")
      categorias, // total por categoria
      // Percentual para a pizza (em %)
      pEssencial: (categorias.essencial / totalCat) * 100,
      pLazer: (categorias.lazer / totalCat) * 100,
      semanas, // gastos agrupados por semana (4 blocos)
      maxSemana: Math.max(...semanas, 1), // maior valor semanal (pra calcular altura das barras)
      topDespesas, // top 5 gastos agrupados por nome
      gastosFixos: gastosFixosPerfil, // lista de gastos fixos do mês
      totalGastosFixos, // DEBUG: soma fixos
      despesasTransacoes, // DEBUG: soma despesas só das transações
    };
  }, [transacoes, mesReferencia, profile?.gastosFixos]);

  /* VARIÁVEIS DO PERFIL */
  // Monta a chave do mês/ano atual da tela (ex.: "2026-01") para buscar salário específico por mês
  const chaveMes = `${mesReferencia.ano}-${String(mesReferencia.mes + 1).padStart(
    2,
    "0"
  )}`;

  // Objeto que guarda salários específicos por mês (se existir); senão fica {}
  const salariosPorMes = profile?.salariosPorMes || {};

  // Salário fixo do mês:
  // - se tiver saláriosPorMes[chaveMes], usa esse
  // - senão usa profile.rendaMensal
  // - senão 0
  const salarioFixo = Number(
    salariosPorMes[chaveMes] ?? profile?.rendaMensal ?? 0
  );

  // Limite de gasto mensal configurado no perfil
  const limiteGastoMensal = Number(profile?.limiteGastoMensal || 0);

  // Dia de pagamento configurado no perfil (string/number)
  const diaPagamento = profile?.diaPagamento || "";

  // ✅ agora o próximo pagamento é calculado só pelo diaPagamento (e hoje)
  // Se existir diaPagamento, calcula; senão fica null
  const proximoPag = diaPagamento ? calcularProximoPagamento(diaPagamento) : null;

  // Resultado em relação ao salário:
  // se salário estiver definido (>0), calcula salário - despesas.
  // se não tiver salário, deixa null para mostrar o aviso na UI.
  const resultadoSalario =
    salarioFixo > 0 ? salarioFixo - resumo.despesas : null;

  // Saldo que aparece na tela:
  // - se tiver salário fixo, soma salário + receitas - despesas
  // - se não tiver salário, usa o saldo simples (receitas - despesas)
  const saldoComSalario =
    salarioFixo > 0
      ? salarioFixo + resumo.receitas - resumo.despesas
      : resumo.saldo;

  // Estilo do gráfico de pizza (conic-gradient):
  // Essencial ocupa do 0 até pEssencial, e Lazer o restante
  const pizzaStyle = {
    backgroundImage: `conic-gradient(
      #8FA3FF 0 ${resumo.pEssencial}%,
      #4C5ACF ${resumo.pEssencial}% 100%
    )`,
  };

  // Percentual de uso do limite:
  // despesas / limite * 100, com teto de 100%
  const percLimite =
    limiteGastoMensal > 0
      ? Math.min(100, (resumo.despesas / limiteGastoMensal) * 100)
      : 0;

  // Nome do mês para exibir no título, baseado em mesReferencia.mes (0..11)
  const nomeMes = [
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
  ][mesReferencia.mes];

  // Retorno JSX (UI da página)
  return (
    <div className="page">
      {/* Título da página */}
      <h2 className="page-title">Visão geral do mês</h2>

      {/* NAVEGAÇÃO DO MÊS */}
      <div className="card" style={{ textAlign: "center", marginBottom: 12 }}>
        {/* Mostra nome do mês e ano selecionado */}
        <h3>
          {nomeMes} / {mesReferencia.ano}
        </h3>

        {/* Botões para trocar o mês da visualização */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 10,
          }}
        >
          {/* Volta 1 mês */}
          <button className="toggle-btn" onClick={() => mudarMesReferencia(-1)}>
            ◀ Mês anterior
          </button>

          {/* Vai para o mês atual */}
          <button className="toggle-btn toggle-active" onClick={irParaMesAtual}>
            ● Atual
          </button>

          {/* Avança 1 mês */}
          <button className="toggle-btn" onClick={() => mudarMesReferencia(1)}>
            Próximo mês ▶
          </button>
        </div>
      </div>

      {/* BLOCO PRINCIPAL JUNTO (SALÁRIO + DIA + RESULTADO) */}
      <div className="card resumo-card">
        {/* Parte de cima: salário e “pill” do dia de pagamento */}
        <div className="resumo-top">
          <div>
            {/* Label do salário */}
            <p className="resumo-label">Salário fixo</p>

            {/* Mostra salário formatado ou o texto pedindo para definir no Perfil */}
            <p className="resumo-value">
              {salarioFixo ? formatCurrency(salarioFixo) : "Defina na aba Perfil"}
            </p>
          </div>

          {/* “Pill” (selo) com o dia de pagamento e quantos dias faltam */}
          <div className="pill">
            {diaPagamento ? (
              <>
                {/* Exibe “Dia X” */}
                <span>Dia {diaPagamento}</span>

                {/* Se proximoPag foi calculado, exibe “Próx. em N dia(s)” */}
                {proximoPag && (
                  <span className="pill-sub">
                    Próx. em {proximoPag.diasRestantes} dia(s)
                  </span>
                )}
              </>
            ) : (
              // Se não tiver diaPagamento no perfil
              <span>Sem dia definido</span>
            )}
          </div>
        </div>

        {/* Parte de baixo: resultado “Sobrou/Faltou” considerando o salário */}
        <div className="resumo-footer">
          {resultadoSalario === null ? (
            // Se não tem salário fixo definido, mostra uma dica
            <p className="muted small">
              Defina sua renda mensal fixa na aba Perfil para calcular sobras.
            </p>
          ) : (
            // Se tem salário, mostra o badge positivo/negativo
            <span
              className={
                "badge badge-pill " +
                (resultadoSalario >= 0 ? "badge-positive" : "badge-negative")
              }
            >
              {/* Texto “Sobrou” ou “Faltou” + valor absoluto formatado */}
              {resultadoSalario >= 0 ? "Sobrou" : "Faltou"}{" "}
              {formatCurrency(Math.abs(resultadoSalario))}
            </span>
          )}
        </div>
      </div>

      {/* RECEITAS / DESPESAS / SALDO / CRÉDITO */}
      <div className="card mt">
        {/* Grid com 4 números principais */}
        <div className="resumo-grid">
          <div>
            <p className="resumo-label">Receitas do mês</p>
            <p className="resumo-number positive">
              {formatCurrency(resumo.receitas)}
            </p>
          </div>

          <div>
            <p className="resumo-label">Despesas do mês</p>
            <p className="resumo-number negative">
              {formatCurrency(resumo.despesas)}
            </p>
          </div>

          <div>
            <p className="resumo-label">Saldo</p>
            <p
              className={
                "resumo-number " + (saldoComSalario >= 0 ? "positive" : "negative")
              }
            >
              {formatCurrency(saldoComSalario)}
            </p>
          </div>

          <div>
            <p className="resumo-label">Crédito usado</p>
            <p className="resumo-number negative">
              {formatCurrency(resumo.gastosCartao)}
            </p>
          </div>
        </div>
      </div>

      {/* LIMITE */}
      <div className="card mt">
        <h3>Limite de gasto mensal</h3>

        {limiteGastoMensal ? (
          <>
            {/* Mostra o valor do limite */}
            <p className="muted small">Limite: {formatCurrency(limiteGastoMensal)}</p>

            {/* Barra de progresso, preenchida pelo percentual percLimite */}
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${percLimite}%` }} />
            </div>

            {/* Texto do percentual utilizado */}
            <span className="progress-label">{percLimite.toFixed(0)}% utilizado</span>
          </>
        ) : (
          // Se não tiver limite configurado
          <p className="muted small">Defina seu limite na aba Perfil.</p>
        )}
      </div>

      {/* GASTOS FIXOS */}
      <div className="card mt">
        <h3>Gastos fixos</h3>

        {/* Se não houver gastos fixos, mostra mensagem */}
        {resumo.gastosFixos.length === 0 ? (
          <p className="muted small">Nenhum gasto fixo marcado.</p>
        ) : (
          // Senão, lista cada gasto fixo com descrição e valor
          <ul className="list">
            {resumo.gastosFixos.map((t) => (
              <li key={t.id} className="list-item">
                <span>{t.descricao}</span>
                <span>{formatCurrency(t.valor)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* TOP GASTOS */}
      <div className="card mt">
        <h3>Top 5 gastos</h3>

        {/* Se não houver despesas, mostra mensagem */}
        {resumo.topDespesas.length === 0 ? (
          <p className="muted">Nenhuma despesa ainda.</p>
        ) : (
          // Senão, lista top 5 por valor, mostrando quantas vezes ocorreu (x)
          <ul className="list">
            {resumo.topDespesas.map((t) => (
              <li key={t.id} className="list-item">
                <span>
                  {t.descricao}
                  {t.count > 1 ? (
                    <span className="muted small"> · {t.count}x</span>
                  ) : null}
                </span>
                <span>{formatCurrency(t.valor)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* CATEGORIAS / SEMANAS */}
      <div className="grid-2 mt">
        {/* Card do gráfico de pizza por categoria */}
        <div className="card">
          <h3>Gasto por categoria</h3>

          {/* “pizza-chart” recebe o style com conic-gradient */}
          <div className="pizza-chart-wrapper">
            <div className="pizza-chart" style={pizzaStyle} />
          </div>

          {/* Legenda da pizza com percentuais */}
          <div className="legend">
            <div className="legend-item">
              <span className="legend-color legend-essential" />
              Essencial ({resumo.pEssencial.toFixed(0)}%)
            </div>
            <div className="legend-item">
              <span className="legend-color legend-leisure" />
              Lazer ({resumo.pLazer.toFixed(0)}%)
            </div>
          </div>
        </div>

        {/* Card do gráfico de barras por semana */}
        <div className="card">
          <h3>Gastos por semana</h3>

          {/* Monta 4 barras (Sem 1 a Sem 4) */}
          <div className="bar-chart">
            {resumo.semanas.map((v, i) => {
              // Altura relativa da barra em %
              // Divide pelo maior valor semanal (maxSemana) para a maior barra ter 100%
              const height = (v / resumo.maxSemana) * 100;

              return (
                <div className="bar-column" key={i}>
                  {/* A barra recebe a altura calculada (se for 0, usa 2% pra aparecer um “mínimo”) */}
                  <div className="bar" style={{ height: `${height || 2}%` }} />
                  {/* Label da semana */}
                  <span className="bar-label">Sem {i + 1}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
