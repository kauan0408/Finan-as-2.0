// src/pages/FinancasPage.jsx

import React, { useMemo } from "react";
import { useFinance } from "../App.jsx";

function formatCurrency(value) {
  const num = Number(value || 0);
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/* ✅ Próximo pagamento (dia do perfil + hoje) */
function calcularProximoPagamento(diaPagamento) {
  const dia = Number(diaPagamento);
  if (!dia || dia < 1 || dia > 31) return null;

  const hoje = new Date();

  const criarDataCerta = (ano, mes, diaDesejado) => {
    const ultimoDiaDoMes = new Date(ano, mes + 1, 0).getDate();
    const d = Math.min(diaDesejado, ultimoDiaDoMes);
    return new Date(ano, mes, d);
  };

  let proximo = criarDataCerta(hoje.getFullYear(), hoje.getMonth(), dia);

  if (proximo < hoje) {
    const ano2 = hoje.getFullYear();
    const mes2 = hoje.getMonth() + 1;
    proximo = criarDataCerta(ano2, mes2, dia);
  }

  const diffMs = proximo - hoje;
  const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return { data: proximo, diasRestantes: diffDias };
}

function getValorFixo(valoresPorMes = {}, chaveMes) {
  if (valoresPorMes && valoresPorMes[chaveMes] != null) {
    return Number(valoresPorMes[chaveMes]);
  }

  const meses = Object.keys(valoresPorMes || {}).sort();
  let ultimo = null;
  for (const m of meses) {
    if (m <= chaveMes) ultimo = m;
  }
  return ultimo ? Number(valoresPorMes[ultimo]) : 0;
}

function normalizarNome(descricao) {
  return String(descricao || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// helpers de mês
function monthKey(ano, mes0) {
  return `${ano}-${String(mes0 + 1).padStart(2, "0")}`;
}

function prevMonth(ano, mes0) {
  let y = ano;
  let m = mes0 - 1;
  if (m < 0) {
    m = 11;
    y = ano - 1;
  }
  return { ano: y, mes: m };
}

export default function FinancasPage() {
  // ✅ importante: irParaMesAtual agora usa o “mês financeiro” (ajustado no App.jsx)
  const { transacoes, profile, mesReferencia, mudarMesReferencia, irParaMesAtual } =
    useFinance();

  const salariosPorMes = profile?.salariosPorMes || {};

  function getSalarioMes(ano, mes0) {
    const k = monthKey(ano, mes0);
    return Number(salariosPorMes[k] ?? profile?.rendaMensal ?? 0);
  }

  const resumo = useMemo(() => {
    const montarResumoMes = (mes0, ano) => {
      let receitas = 0;
      let despesasTransacoes = 0;
      let gastosCartao = 0;

      let categorias = { essencial: 0, lazer: 0 };
      const semanas = [0, 0, 0, 0];

      const chaveMes = monthKey(ano, mes0);

      const gastosFixosPerfil = (Array.isArray(profile?.gastosFixos)
        ? profile.gastosFixos
        : []
      )
        .filter((g) => g.ativo !== false)
        .filter(
          (g) =>
            (g.nome || "").toLowerCase() !== "educacao" &&
            (g.categoria || "").toLowerCase() !== "educacao"
        )
        .map((g) => ({
          id: g.id,
          descricao: g.nome,
          categoria: (g.categoria || "").toLowerCase(),
          valor: getValorFixo(g.valoresPorMes || {}, chaveMes),
        }))
        .filter((g) => Number(g.valor) > 0);

      transacoes.forEach((t) => {
        const dt = new Date(t.dataHora);

        if (dt.getMonth() === mes0 && dt.getFullYear() === ano) {
          const valor = Number(t.valor || 0);

          if (t.tipo === "receita") {
            receitas += valor;
          } else if (t.tipo === "despesa") {
            despesasTransacoes += valor;

            if (t.formaPagamento === "credito") {
              gastosCartao += valor;
            }

            const cat = (t.categoria || "").toLowerCase();
            if (cat === "essencial") categorias.essencial += valor;
            if (cat === "lazer") categorias.lazer += valor;

            const dia = dt.getDate(); // 1..31
            const semanaIndex = Math.min(3, Math.floor((dia - 1) / 7)); // 0..3
            semanas[semanaIndex] += valor;
          }
        }
      });

      const totalGastosFixos = gastosFixosPerfil.reduce(
        (acc, g) => acc + Number(g.valor || 0),
        0
      );

      const despesas = despesasTransacoes + totalGastosFixos;

      gastosFixosPerfil.forEach((g) => {
        const v = Number(g.valor || 0);
        if (!v) return;
        const cat = (g.categoria || "").toLowerCase();
        if (cat === "essencial") categorias.essencial += v;
        if (cat === "lazer") categorias.lazer += v;
      });

      const saldo = receitas - despesas;

      // Top 5
      const mapa = new Map();
      transacoes.forEach((t) => {
        const dt = new Date(t.dataHora);
        if (t.tipo === "despesa" && dt.getMonth() === mes0 && dt.getFullYear() === ano) {
          const v = Number(t.valor || 0);
          if (!v) return;

          const key = normalizarNome(t.descricao || "Sem descrição");
          const atual =
            mapa.get(key) || { descricao: t.descricao || "Sem descrição", valor: 0, count: 0 };
          atual.valor += v;
          atual.count += 1;

          if ((!atual.descricao || atual.descricao === "Sem descrição") && t.descricao) {
            atual.descricao = t.descricao;
          }
          mapa.set(key, atual);
        }
      });

      const topDespesas = Array.from(mapa.values())
        .sort((a, b) => Number(b.valor) - Number(a.valor))
        .slice(0, 5)
        .map((x, idx) => ({
          id: `top-${ano}-${mes0}-${idx}`,
          descricao: x.descricao,
          valor: x.valor,
          count: x.count,
        }));

      const totalCat = categorias.essencial + categorias.lazer || 1;

      // ✅✅✅ ADICIONADO: Parcelas do mês (se tiver) + mínimo para pagar as contas
      // Regra: considera "parcela" quando existir parcelasTotal>1 ou parcelaNumero>0
      // E ignora compras no crédito (porque crédito é controlado na tela de cartões)
      const totalParcelasMes = transacoes.reduce((acc, t) => {
        const dt = new Date(t.dataHora);
        if (dt.getMonth() !== mes0 || dt.getFullYear() !== ano) return acc;
        if (t.tipo !== "despesa") return acc;
        if (t.formaPagamento === "credito") return acc;

        const parcelasTotal = Number(t?.parcelasTotal ?? t?.parcelas ?? 0);
        const parcelaNumero = Number(t?.parcelaNumero ?? 0);

        const ehParcela = parcelasTotal > 1 || parcelaNumero > 0;
        if (!ehParcela) return acc;

        const v = Number(t.valor || 0);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0);

      const minimoParaPagarContas = totalGastosFixos + totalParcelasMes;

      return {
        receitas,
        despesas,
        saldo,
        gastosCartao,
        categorias,
        pEssencial: (categorias.essencial / totalCat) * 100,
        pLazer: (categorias.lazer / totalCat) * 100,
        semanas,
        maxSemana: Math.max(...semanas, 1),
        topDespesas,
        gastosFixos: gastosFixosPerfil,
        totalGastosFixos,
        despesasTransacoes,

        // ✅✅✅ ADICIONADO
        totalParcelasMes,
        minimoParaPagarContas,
      };
    };

    const { mes, ano } = mesReferencia;
    const resumoAtual = montarResumoMes(mes, ano);

    const { ano: anoPrev, mes: mesPrev } = prevMonth(ano, mes);
    const resumoPrev = montarResumoMes(mesPrev, anoPrev);

    const salarioPrev = getSalarioMes(anoPrev, mesPrev);
    const saldoPrevComSalario =
      salarioPrev > 0 ? salarioPrev + resumoPrev.receitas - resumoPrev.despesas : resumoPrev.saldo;

    const pendenteAnterior = saldoPrevComSalario < 0 ? Math.abs(saldoPrevComSalario) : 0;

    return { resumoAtual, pendenteAnterior };
  }, [
    transacoes,
    mesReferencia,
    profile?.gastosFixos,
    profile?.rendaMensal,
    profile?.salariosPorMes,
  ]);

  const { resumoAtual, pendenteAnterior } = resumo;

  const chaveMesAtual = monthKey(mesReferencia.ano, mesReferencia.mes);
  const salarioFixo = Number(
    (profile?.salariosPorMes || {})[chaveMesAtual] ?? profile?.rendaMensal ?? 0
  );

  const limiteGastoMensal = Number(profile?.limiteGastoMensal || 0);

  const diaPagamento = profile?.diaPagamento || "";
  const proximoPag = diaPagamento ? calcularProximoPagamento(diaPagamento) : null;

  const resultadoSalario =
    salarioFixo > 0 ? salarioFixo - resumoAtual.despesas - pendenteAnterior : null;

  const saldoComSalario =
    salarioFixo > 0
      ? salarioFixo + resumoAtual.receitas - resumoAtual.despesas - pendenteAnterior
      : resumoAtual.saldo - pendenteAnterior;

  const pizzaStyle = {
    backgroundImage: `conic-gradient(
      #8FA3FF 0 ${resumoAtual.pEssencial}%,
      #4C5ACF ${resumoAtual.pEssencial}% 100%
    )`,
  };

  const percLimite =
    limiteGastoMensal > 0 ? Math.min(100, (resumoAtual.despesas / limiteGastoMensal) * 100) : 0;

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

  return (
    <div className="page">
      <h2 className="page-title">Visão geral do mês</h2>

      {/* NAVEGAÇÃO DO MÊS */}
      <div className="card" style={{ textAlign: "center", marginBottom: 12 }}>
        <h3>
          {nomeMes} / {mesReferencia.ano}
        </h3>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
          <button className="toggle-btn" onClick={() => mudarMesReferencia(-1)}>
            ◀ Mês anterior
          </button>

          {/* ✅ AGORA: “Atual” leva pro mês financeiro, calculado no App.jsx pelo diaPagamento */}
          <button className="toggle-btn toggle-active" onClick={irParaMesAtual}>
            ● Atual
          </button>

          <button className="toggle-btn" onClick={() => mudarMesReferencia(1)}>
            Próximo mês ▶
          </button>
        </div>
      </div>

      {/* BLOCO PRINCIPAL */}
      <div className="card resumo-card">
        <div className="resumo-top">
          <div>
            <p className="resumo-label">Salário fixo</p>
            <p className="resumo-value">
              {salarioFixo ? formatCurrency(salarioFixo) : "Defina na aba Perfil"}
            </p>
          </div>

          <div className="pill">
            {diaPagamento ? (
              <>
                <span>Dia {diaPagamento}</span>
                {proximoPag && (
                  <span className="pill-sub">Próx. em {proximoPag.diasRestantes} dia(s)</span>
                )}
              </>
            ) : (
              <span>Sem dia definido</span>
            )}
          </div>
        </div>

        <div className="resumo-footer">
          {resultadoSalario === null ? (
            <p className="muted small">
              Defina sua renda mensal fixa na aba Perfil para calcular sobras.
            </p>
          ) : (
            <span
              className={
                "badge badge-pill " + (resultadoSalario >= 0 ? "badge-positive" : "badge-negative")
              }
            >
              {resultadoSalario >= 0 ? "Sobrou" : "Faltou"}{" "}
              {formatCurrency(Math.abs(resultadoSalario))}
            </span>
          )}
        </div>

        {/* ✅ PENDENTE */}
        {pendenteAnterior > 0 && (
          <div style={{ marginTop: 10 }}>
            <span className="badge badge-pill badge-negative">
              Pendente do mês anterior: {formatCurrency(pendenteAnterior)}
            </span>
            <p className="muted small" style={{ marginTop: 6 }}>
              Esse valor foi carregado automaticamente porque o mês anterior fechou negativo.
            </p>
          </div>
        )}
      </div>

      {/* ✅✅✅ ADICIONADO: MÍNIMO PARA PAGAR AS CONTAS */}
      <div className="card mt">
        <h3>Mínimo para pagar as contas</h3>
        <p className="muted small" style={{ marginTop: 6 }}>
          Soma de <strong>gastos fixos</strong> + <strong>parcelas do mês</strong> (se existir).
        </p>

        <div className="resumo-grid" style={{ marginTop: 10 }}>
          <div>
            <p className="resumo-label">Gastos fixos</p>
            <p className="resumo-number negative">{formatCurrency(resumoAtual.totalGastosFixos)}</p>
          </div>

          <div>
            <p className="resumo-label">Parcelas do mês</p>
            <p className="resumo-number negative">{formatCurrency(resumoAtual.totalParcelasMes)}</p>
          </div>

          <div>
            <p className="resumo-label">Total mínimo</p>
            <p className="resumo-number negative">
              {formatCurrency(resumoAtual.minimoParaPagarContas)}
            </p>
          </div>
        </div>
      </div>

      {/* RECEITAS / DESPESAS / SALDO / CRÉDITO */}
      <div className="card mt">
        <div className="resumo-grid">
          <div>
            <p className="resumo-label">Receitas do mês</p>
            <p className="resumo-number positive">{formatCurrency(resumoAtual.receitas)}</p>
          </div>

          <div>
            <p className="resumo-label">Despesas do mês</p>
            <p className="resumo-number negative">{formatCurrency(resumoAtual.despesas)}</p>
          </div>

          <div>
            <p className="resumo-label">Saldo</p>
            <p className={"resumo-number " + (saldoComSalario >= 0 ? "positive" : "negative")}>
              {formatCurrency(saldoComSalario)}
            </p>
          </div>

          <div>
            <p className="resumo-label">Crédito usado</p>
            <p className="resumo-number negative">{formatCurrency(resumoAtual.gastosCartao)}</p>
          </div>
        </div>
      </div>

      {/* LIMITE */}
      <div className="card mt">
        <h3>Limite de gasto mensal</h3>

        {limiteGastoMensal ? (
          <>
            <p className="muted small">Limite: {formatCurrency(limiteGastoMensal)}</p>

            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${percLimite}%` }} />
            </div>

            <span className="progress-label">{percLimite.toFixed(0)}% utilizado</span>
          </>
        ) : (
          <p className="muted small">Defina seu limite na aba Perfil.</p>
        )}
      </div>

      {/* GASTOS FIXOS */}
      <div className="card mt">
        <h3>Gastos fixos</h3>

        {resumoAtual.gastosFixos.length === 0 ? (
          <p className="muted small">Nenhum gasto fixo marcado.</p>
        ) : (
          <ul className="list">
            {resumoAtual.gastosFixos.map((t) => (
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

        {resumoAtual.topDespesas.length === 0 ? (
          <p className="muted">Nenhuma despesa ainda.</p>
        ) : (
          <ul className="list">
            {resumoAtual.topDespesas.map((t) => (
              <li key={t.id} className="list-item">
                <span>
                  {t.descricao}
                  {t.count > 1 ? <span className="muted small"> · {t.count}x</span> : null}
                </span>
                <span>{formatCurrency(t.valor)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* CATEGORIAS / SEMANAS */}
      <div className="grid-2 mt">
        <div className="card">
          <h3>Gasto por categoria</h3>

          <div className="pizza-chart-wrapper">
            <div className="pizza-chart" style={pizzaStyle} />
          </div>

          <div className="legend">
            <div className="legend-item">
              <span className="legend-color legend-essential" />
              Essencial ({resumoAtual.pEssencial.toFixed(0)}%)
            </div>
            <div className="legend-item">
              <span className="legend-color legend-leisure" />
              Lazer ({resumoAtual.pLazer.toFixed(0)}%)
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Gastos por semana</h3>

          <div className="bar-chart">
            {resumoAtual.semanas.map((v, i) => {
              const height = (v / resumoAtual.maxSemana) * 100;

              return (
                <div className="bar-column" key={i} style={{ alignItems: "center" }}>
                  <div className="muted small" style={{ marginBottom: 6 }}>
                    {formatCurrency(v)}
                  </div>

                  <div className="bar" style={{ height: `${height || 2}%` }} />

                  <span className="bar-label">Sem {i + 1}</span>
                </div>
              );
            })}
          </div>

          <p className="muted small" style={{ marginTop: 8 }}>
            (Os valores acima são o total gasto em cada semana do mês.)
          </p>
        </div>
      </div>
    </div>
  );
}
