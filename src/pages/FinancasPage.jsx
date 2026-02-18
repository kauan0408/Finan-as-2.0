// src/pages/FinancasPage.jsx

import React, { useMemo, useState, useEffect } from "react";
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

// ✅ ADICIONADO: normaliza texto para regras automáticas
function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

// ✅ ADICIONADO: regras automáticas (comida / transporte)
function isFood(desc) {
  const d = normalizeText(desc);
  const keys = [
    "ifood",
    "i food",
    "lanche",
    "comida",
    "cafe",
    "café",
    "cafe da tarde",
    "café da tarde",
    "almoco",
    "almoço",
    "jantar",
    "refri",
    "refrigerante",
    "coca",
    "guarana",
    "guaraná",
    "miojo",
    "doce",
    "pudim",
    "risoto",
    "salgado",
    "pizza",
    "hamburguer",
    "hambúrguer",
    "sorvete",
    "acai",
    "açaí",
  ];
  return keys.some((k) => d.includes(normalizeText(k)));
}

function isTransport(desc) {
  const d = normalizeText(desc);
  const keys = [
    "uber",
    "99",
    "taxi",
    "táxi",
    "onibus",
    "ônibus",
    "passagem",
    "transporte",
    "corrida",
  ];
  return keys.some((k) => d.includes(normalizeText(k)));
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

/* -------------------- ✅ ADICIONADO: helpers para lembretes (compacto) -------------------- */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toLocalDateKey(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

function startOfDay(dateObj) {
  const d = new Date(dateObj);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(dateObj) {
  const d = new Date(dateObj);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(dateObj, days) {
  const d = new Date(dateObj);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function parseLocalDateTime(v) {
  try {
    const [datePart, timePart] = String(v || "").split("T");
    if (!datePart || !timePart) return null;
    const [y, m, d] = datePart.split("-").map(Number);
    const [hh, mm] = timePart.split(":").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
  } catch {
    return null;
  }
}

function fmtShortBR(d) {
  try {
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return "";
    return x.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
}

function fmtTimeHHmm(d) {
  try {
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return "";
    return x.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/* ---------------------------------------------------------------------------------------- */

export default function FinancasPage() {
  // ✅ importante: irParaMesAtual agora usa o “mês financeiro” (ajustado no App.jsx)
  const {
    transacoes,
    profile,
    mesReferencia,
    mudarMesReferencia,
    irParaMesAtual,

    // ✅ ADICIONADO: puxar lembretes do mesmo contexto do app
    lembretes,
  } = useFinance();

  // ✅ modal ao clicar em "Gasto por categoria"
  const [modalCategorias, setModalCategorias] = useState(false);

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

      // ✅ categorias
      let categorias = { essencial: 0, lazer: 0, burrice: 0, investido: 0 };
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
            if (cat === "burrice") categorias.burrice += valor;
            if (cat === "investido") categorias.investido += valor;

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
        if (cat === "burrice") categorias.burrice += v;
        if (cat === "investido") categorias.investido += v;
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

      const totalCat =
        categorias.essencial + categorias.lazer + categorias.burrice + categorias.investido || 1;

      return {
        receitas,
        despesas,
        saldo,
        gastosCartao,
        categorias,
        pEssencial: (categorias.essencial / totalCat) * 100,
        pLazer: (categorias.lazer / totalCat) * 100,
        pBurrice: (categorias.burrice / totalCat) * 100,
        pInvestido: (categorias.investido / totalCat) * 100,
        semanas,
        maxSemana: Math.max(...semanas, 1),
        topDespesas,
        gastosFixos: gastosFixosPerfil,
        totalGastosFixos,
        despesasTransacoes,
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

  const pE = resumoAtual.pEssencial || 0;
  const pL = resumoAtual.pLazer || 0;
  const pB = resumoAtual.pBurrice || 0;

  const cut1 = pE;
  const cut2 = pE + pL;
  const cut3 = pE + pL + pB;

  const pizzaStyle = {
    backgroundImage: `conic-gradient(
      #8FA3FF 0 ${cut1}%,
      #4C5ACF ${cut1}% ${cut2}%,
      #F59E0B ${cut2}% ${cut3}%,
      #10B981 ${cut3}% 100%
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

  // ✅ dados do modal de categorias (organiza sozinho)
  const detalhesCategorias = useMemo(() => {
    const mes0 = mesReferencia.mes;
    const ano = mesReferencia.ano;

    const despesasMes = transacoes
      .filter((t) => {
        const dt = new Date(t.dataHora);
        return t.tipo === "despesa" && dt.getMonth() === mes0 && dt.getFullYear() === ano;
      })
      .map((t) => ({
        id: t.id,
        descricao: t.descricao || "Sem descrição",
        valor: Number(t.valor || 0),
        categoria: String(t.categoria || "").trim() || "Sem categoria",
      }));

    const fixos = (resumoAtual.gastosFixos || []).map((g) => ({
      id: `fixo_${g.id}`,
      descricao: g.descricao || "Gasto fixo",
      valor: Number(g.valor || 0),
      categoria: (g.categoria || "Sem categoria").trim(),
      _fixo: true,
    }));

    const tudo = [...despesasMes, ...fixos].filter((x) => Number(x.valor) > 0);

    const food = [];
    const transport = [];
    const other = [];

    tudo.forEach((t) => {
      if (isFood(t.descricao)) food.push(t);
      else if (isTransport(t.descricao)) transport.push(t);
      else other.push(t);
    });

    const sum = (arr) => arr.reduce((s, x) => s + Number(x.valor || 0), 0);

    const groupByDesc = (arr) => {
      const m = new Map();
      arr.forEach((t) => {
        const k = normalizarNome(t.descricao);
        const cur = m.get(k) || { descricao: t.descricao, total: 0, count: 0 };
        cur.total += Number(t.valor || 0);
        cur.count += 1;
        if ((!cur.descricao || cur.descricao === "Sem descrição") && t.descricao) {
          cur.descricao = t.descricao;
        }
        m.set(k, cur);
      });
      return Array.from(m.values()).sort((a, b) => b.total - a.total);
    };

    const foodByDesc = groupByDesc(food);
    const transportByDesc = groupByDesc(transport);

    const foodPorCategoria = { essencial: 0, lazer: 0, burrice: 0, investido: 0, outras: 0 };
    food.forEach((t) => {
      const c = String(t.categoria || "").toLowerCase();
      if (c === "essencial") foodPorCategoria.essencial += t.valor;
      else if (c === "lazer") foodPorCategoria.lazer += t.valor;
      else if (c === "burrice") foodPorCategoria.burrice += t.valor;
      else if (c === "investido") foodPorCategoria.investido += t.valor;
      else foodPorCategoria.outras += t.valor;
    });

    const totalPorCategoria = { essencial: 0, lazer: 0, burrice: 0, investido: 0, outras: 0 };
    tudo.forEach((t) => {
      const c = String(t.categoria || "").toLowerCase();
      if (c === "essencial") totalPorCategoria.essencial += t.valor;
      else if (c === "lazer") totalPorCategoria.lazer += t.valor;
      else if (c === "burrice") totalPorCategoria.burrice += t.valor;
      else if (c === "investido") totalPorCategoria.investido += t.valor;
      else totalPorCategoria.outras += t.valor;
    });

    return {
      totalMes: sum(tudo),
      totalFood: sum(food),
      totalTransport: sum(transport),
      totalOther: sum(other),
      foodByDesc,
      transportByDesc,
      foodPorCategoria,
      totalPorCategoria,
    };
  }, [transacoes, mesReferencia, resumoAtual.gastosFixos]);

  /* -------------------- ✅ ADICIONADO: dados compactos de lembretes para o card principal -------------------- */

  // fallback (se por algum motivo não vier do contexto, tenta pegar do localStorage antigo)
  const [lembretesFallback, setLembretesFallback] = useState([]);
  useEffect(() => {
    try {
      if (Array.isArray(lembretes) && lembretes.length) return;
      const raw = localStorage.getItem("pwa_lembretes_v1") || "[]";
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setLembretesFallback(parsed);
    } catch {}
  }, [lembretes]);

  const lembretesList = Array.isArray(lembretes) && lembretes.length ? lembretes : lembretesFallback;

  const lembretesCompact = useMemo(() => {
    const list = Array.isArray(lembretesList) ? lembretesList : [];

    const now = new Date();
    const from = startOfDay(now);
    const to = endOfDay(now);

    // transforma tudo em “eventos” comparáveis
    const events = list
      .map((it) => {
        if (!it) return null;

        if (it.tipo === "avulso") {
          if (it.done) return null;
          const dt = parseLocalDateTime(it.quando);
          if (!dt || Number.isNaN(dt.getTime())) return null;
          return {
            id: it.id,
            tipo: "avulso",
            titulo: it.titulo || "Sem título",
            when: dt,
            whenISO: dt.toISOString(),
          };
        }

        if (it.tipo === "recorrente") {
          if (it.enabled === false) return null;
          const dt = new Date(it.nextDueISO || "");
          if (!dt || Number.isNaN(dt.getTime())) return null;
          return {
            id: it.id,
            tipo: "recorrente",
            titulo: it.titulo || "Sem título",
            when: dt,
            whenISO: dt.toISOString(),
            scheduleType: it.scheduleType || "intervalo",
          };
        }

        return null;
      })
      .filter(Boolean)
      .sort((a, b) => a.when.getTime() - b.when.getTime());

    const today = events.filter(
      (e) => e.when.getTime() >= from.getTime() && e.when.getTime() <= to.getTime()
    );

    const upcoming = events.filter((e) => e.when.getTime() > to.getTime()).slice(0, 6);

    // “mini calendário” 7 dias (hoje + 6)
    const days = Array.from({ length: 7 }).map((_, idx) => {
      const d = addDays(from, idx);
      const key = toLocalDateKey(d);

      let count = 0;
      for (const ev of events) {
        if (toLocalDateKey(ev.when) === key) count++;
      }

      return {
        key,
        date: d,
        count,
      };
    });

    return {
      today: today.slice(0, 3), // compacto (máx 3)
      todayCount: today.length,
      upcoming,
      days,
    };
  }, [lembretesList]);

  /* ----------------------------------------------------------------------------------------------------------- */

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
          {/* ✅ aqui fica só o pill do pagamento (removeu "Salário fixo" + "Defina na aba Perfil") */}
          <div className="pill" style={{ marginLeft: "auto" }}>
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
          {/* ✅ removeu a frase "Defina sua renda..." */}
          {resultadoSalario !== null && (
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

        {pendenteAnterior > 0 && (
          <div style={{ marginTop: 10 }}>
            <span className="badge badge-pill badge-negative">
              Pendente do mês anterior: {formatCurrency(pendenteAnterior)}
            </span>

            {/* ✅ removeu: "Esse valor foi carregado automaticamente..." */}
          </div>
        )}

        {/* ✅ ADICIONADO: Lembretes do dia + mini calendário (compacto, sem ocupar muito espaço) */}
        <div style={{ marginTop: 12 }}>
          <div
            className="card"
            style={{
              padding: 10,
              background: "rgba(255,255,255,.03)",
              border: "1px solid rgba(255,255,255,.08)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>📌 Lembretes</div>
                <div className="muted small" style={{ marginTop: 2 }}>
                  Hoje: <b>{lembretesCompact.todayCount}</b>
                  {lembretesCompact.todayCount > 3 ? " (mostrando 3)" : ""}
                </div>
              </div>

              {/* mini calendário 7 dias */}
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "nowrap" }}>
                {lembretesCompact.days.map((d, idx) => {
                  const isToday = idx === 0;
                  const count = d.count || 0;
                  const dotOpacity = count ? 1 : 0.25;

                  return (
                    <div
                      key={d.key}
                      title={`${fmtShortBR(d.date)} • ${count} lembrete(s)`}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        width: 34,
                      }}
                    >
                      <div
                        style={{
                          width: isToday ? 10 : 8,
                          height: isToday ? 10 : 8,
                          borderRadius: 999,
                          background: "rgba(143,163,255,.95)",
                          opacity: dotOpacity,
                          boxShadow: isToday ? "0 0 0 2px rgba(143,163,255,.25)" : "none",
                        }}
                      />
                      <div className="muted small" style={{ marginTop: 4, fontSize: 11 }}>
                        {fmtShortBR(d.date)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* lista compacta do dia */}
            {lembretesCompact.today.length === 0 ? (
              <div className="muted small" style={{ marginTop: 8 }}>
                Nada para hoje 🎉
              </div>
            ) : (
              <ul className="list" style={{ marginTop: 8 }}>
                {lembretesCompact.today.map((t) => (
                  <li key={t.id} className="list-item" style={{ padding: "8px 10px" }}>
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.titulo}{" "}
                      <span className="muted small" style={{ fontWeight: 600 }}>
                        • {t.tipo === "recorrente" ? "recorrente" : "avulso"}
                      </span>
                    </span>
                    <span className="muted small" style={{ whiteSpace: "nowrap" }}>
                      {fmtTimeHHmm(t.when)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* próximos (bem compacto) */}
            {lembretesCompact.upcoming.length > 0 && (
              <div className="muted small" style={{ marginTop: 8, lineHeight: 1.35 }}>
                Próximos:{" "}
                {lembretesCompact.upcoming.slice(0, 3).map((u, idx) => (
                  <span key={u.id}>
                    <b>{fmtShortBR(u.when)}</b> {fmtTimeHHmm(u.when)} — {u.titulo}
                    {idx < Math.min(3, lembretesCompact.upcoming.length) - 1 ? " • " : ""}
                  </span>
                ))}
              </div>
            )}
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
        <div
          className="card"
          onClick={() => setModalCategorias(true)}
          style={{ cursor: "pointer" }}
          title="Clique para ver detalhes"
        >
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

            <div className="legend-item">
              <span className="legend-color" style={{ background: "#F59E0B" }} />
              Burrice ({(resumoAtual.pBurrice || 0).toFixed(0)}%)
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ background: "#10B981" }} />
              Investido ({(resumoAtual.pInvestido || 0).toFixed(0)}%)
            </div>

            <p className="muted small" style={{ marginTop: 8 }}>
              (Clique para abrir detalhes)
            </p>
          </div>
        </div>

        <div className="card">
          <h3>Gastos por semana</h3>

          {/* ✅ 2x2 (Sem 1 e 2 em cima / 3 e 4 em baixo) */}
          <div className="weeks-grid">
            {resumoAtual.semanas.map((v, i) => {
              const height = (v / resumoAtual.maxSemana) * 100;

              return (
                <div className="week-cell" key={i}>
                  <div className="muted small week-value">{formatCurrency(v)}</div>

                  <div className="week-bar-wrap">
                    <div className="bar week-bar" style={{ height: `${height || 2}%` }} />
                  </div>

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

      {/* MODAL DETALHADO */}
      {modalCategorias && (
        <div className="modal-overlay" onClick={() => setModalCategorias(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Detalhes do mês</h3>
            <p className="muted small" style={{ marginTop: 4 }}>
              {nomeMes} / {mesReferencia.ano}
            </p>

            <div className="card" style={{ marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>
                  <b>Total de despesas</b>
                </span>
                <span>
                  <b>{formatCurrency(detalhesCategorias.totalMes)}</b>
                </span>
              </div>
              <p className="muted small" style={{ marginTop: 6 }}>
                (Inclui despesas do histórico + gastos fixos ativos)
              </p>
            </div>

            <div className="card" style={{ marginTop: 10 }}>
              <h4 style={{ marginBottom: 8 }}>🍔 Comida</h4>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>Total</span>
                <span>
                  <b>{formatCurrency(detalhesCategorias.totalFood)}</b>
                </span>
              </div>

              <p className="muted small" style={{ marginTop: 8 }}>
                Comida por categoria:
              </p>
              <ul className="list" style={{ marginTop: 6 }}>
                <li className="list-item">
                  <span>Essencial</span>
                  <span>{formatCurrency(detalhesCategorias.foodPorCategoria.essencial)}</span>
                </li>
                <li className="list-item">
                  <span>Lazer</span>
                  <span>{formatCurrency(detalhesCategorias.foodPorCategoria.lazer)}</span>
                </li>
                <li className="list-item">
                  <span>Burrice</span>
                  <span>{formatCurrency(detalhesCategorias.foodPorCategoria.burrice)}</span>
                </li>
                <li className="list-item">
                  <span>Investido</span>
                  <span>{formatCurrency(detalhesCategorias.foodPorCategoria.investido)}</span>
                </li>
                {detalhesCategorias.foodPorCategoria.outras > 0 && (
                  <li className="list-item">
                    <span>Outras</span>
                    <span>{formatCurrency(detalhesCategorias.foodPorCategoria.outras)}</span>
                  </li>
                )}
              </ul>

              <p className="muted small" style={{ marginTop: 10 }}>
                Itens de comida (somados):
              </p>
              {detalhesCategorias.foodByDesc.length === 0 ? (
                <p className="muted small">Nenhum gasto de comida encontrado.</p>
              ) : (
                <ul className="list" style={{ marginTop: 6 }}>
                  {detalhesCategorias.foodByDesc.map((x, idx) => (
                    <li key={idx} className="list-item">
                      <span>
                        {x.descricao}
                        {x.count > 1 ? <span className="muted small"> · {x.count}x</span> : null}
                      </span>
                      <span>{formatCurrency(x.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card" style={{ marginTop: 10 }}>
              <h4 style={{ marginBottom: 8 }}>🚗 Transporte</h4>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>Total</span>
                <span>
                  <b>{formatCurrency(detalhesCategorias.totalTransport)}</b>
                </span>
              </div>

              <p className="muted small" style={{ marginTop: 10 }}>
                Itens de transporte (somados):
              </p>
              {detalhesCategorias.transportByDesc.length === 0 ? (
                <p className="muted small">Nenhum gasto de transporte encontrado.</p>
              ) : (
                <ul className="list" style={{ marginTop: 6 }}>
                  {detalhesCategorias.transportByDesc.map((x, idx) => (
                    <li key={idx} className="list-item">
                      <span>
                        {x.descricao}
                        {x.count > 1 ? <span className="muted small"> · {x.count}x</span> : null}
                      </span>
                      <span>{formatCurrency(x.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card" style={{ marginTop: 10 }}>
              <h4 style={{ marginBottom: 8 }}>📌 Total por categoria</h4>
              <ul className="list">
                <li className="list-item">
                  <span>Essencial</span>
                  <span>{formatCurrency(detalhesCategorias.totalPorCategoria.essencial)}</span>
                </li>
                <li className="list-item">
                  <span>Lazer</span>
                  <span>{formatCurrency(detalhesCategorias.totalPorCategoria.lazer)}</span>
                </li>
                <li className="list-item">
                  <span>Burrice</span>
                  <span>{formatCurrency(detalhesCategorias.totalPorCategoria.burrice)}</span>
                </li>
                <li className="list-item">
                  <span>Investido</span>
                  <span>{formatCurrency(detalhesCategorias.totalPorCategoria.investido)}</span>
                </li>
                {detalhesCategorias.totalPorCategoria.outras > 0 && (
                  <li className="list-item">
                    <span>Outras</span>
                    <span>{formatCurrency(detalhesCategorias.totalPorCategoria.outras)}</span>
                  </li>
                )}
              </ul>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button className="toggle-btn" type="button" onClick={() => setModalCategorias(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
