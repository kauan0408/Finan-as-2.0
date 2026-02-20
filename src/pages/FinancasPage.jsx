// src/pages/FinancasPage.jsx

import React, { useEffect, useMemo, useRef, useState } from "react";
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

/* -------------------- lembretes helpers (mesmo padrão do seu LembretesPage) -------------------- */

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

/* ✅ navegação sem depender de router */
function safeNavigateTo(path) {
  try {
    const p = String(path || "/");
    if (window.location.hash && window.location.hash.startsWith("#/")) {
      window.location.hash = "#" + (p.startsWith("/") ? p : "/" + p);
      return;
    }
    window.history.pushState({}, "", p.startsWith("/") ? p : "/" + p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    try {
      window.location.href = path;
    } catch {}
  }
}

/* ✅ notificação: tenta SW primeiro; cai no Notification normal */
async function showNotify(title, body) {
  if (!("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;

  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, {
          body,
          tag: "financas-lembretes",
          renotify: true,
        });
        return true;
      }
    }
  } catch {}

  try {
    new Notification(title, { body });
    return true;
  } catch {
    return false;
  }
}

export default function FinancasPage() {
  const {
    transacoes,
    profile,
    mesReferencia,
    mudarMesReferencia,
    irParaMesAtual,
    lembretes, // ✅ vindo do contexto
  } = useFinance();

  const [modalCategorias, setModalCategorias] = useState(false);

  // ✅ status de notificações + checagem do SW
  const [notifPerm, setNotifPerm] = useState(
    "Notification" in window ? Notification.permission : "unsupported"
  );
  const [swInfo, setSwInfo] = useState({ hasSW: false, scope: "" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!("serviceWorker" in navigator)) {
          if (alive) setSwInfo({ hasSW: false, scope: "" });
          return;
        }
        const reg = await navigator.serviceWorker.getRegistration();
        if (!alive) return;
        setSwInfo({ hasSW: !!reg, scope: reg?.scope || "" });
      } catch {
        if (!alive) return;
        setSwInfo({ hasSW: false, scope: "" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function ativarNotificacoes() {
    if (!("Notification" in window)) {
      alert("Seu navegador não suporta notificações.");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      setNotifPerm(perm);

      if (perm === "granted") {
        await showNotify("🔔 Notificações ativadas!", "Agora você pode receber avisos dos seus lembretes.");
      }
    } catch {
      alert("Não consegui ativar notificações. Verifique as permissões do navegador.");
    }
  }

  async function testarNotificacao() {
    if (!("Notification" in window)) return alert("Sem suporte a notificações.");
    if (Notification.permission !== "granted") return alert("Permissão não concedida. Clique em “Ativar notificações”.");

    const ok = await showNotify("✅ Teste de notificação", "Se você viu isso, está funcionando.");
    if (!ok) alert("Não consegui disparar a notificação.");
  }

  // ✅ agenda local (apenas enquanto o app está aberto)
  const notifTimersRef = useRef([]);

  function clearAllTimers() {
    const arr = notifTimersRef.current || [];
    arr.forEach((id) => {
      try {
        clearTimeout(id);
      } catch {}
    });
    notifTimersRef.current = [];
  }

  function scheduleNotifyAt(title, whenDate, body) {
    if (!whenDate) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const ms = whenDate.getTime() - Date.now();
    if (ms <= 0) return;

    // evita timers absurdos
    const MAX_MS = 7 * 24 * 60 * 60 * 1000;
    if (ms > MAX_MS) return;

    const id = setTimeout(() => {
      showNotify(title, body || "");
    }, ms);

    notifTimersRef.current.push(id);
  }

  const lembretesList = Array.isArray(lembretes) ? lembretes : [];

  // ✅ puxa MAIS informações (pendentes hoje, concluídos hoje, pagos hoje, próximos)
  const lembretesResumo = useMemo(() => {
    const list = lembretesList;

    const now = new Date();
    const from = startOfDay(now);
    const to = endOfDay(now);

    const pendentesHoje = [];
    const concluidosHoje = []; // avulsos doneAt hoje
    const pagosHoje = []; // recorrentes paidAt hoje (apenas informação)

    const proximos = []; // próximos (pendentes)
    const proximosConcluidos = []; // últimos concluídos (avulsos)
    const proximosPagos = []; // últimos pagos (recorrentes)

    for (const it of list) {
      if (!it) continue;

      if (it.tipo === "avulso") {
        const dt = parseLocalDateTime(it.quando);
        if (!dt) continue;

        if (it.done) {
          // concluído
          const doneAt = it.doneAt ? new Date(it.doneAt) : null;
          if (doneAt && doneAt.getTime() >= from.getTime() && doneAt.getTime() <= to.getTime()) {
            concluidosHoje.push({ ...it, _when: dt, _doneAt: doneAt });
          }
          proximosConcluidos.push({ ...it, _when: dt, _doneAt: doneAt });
        } else {
          // pendente
          if (dt.getTime() >= from.getTime() && dt.getTime() <= to.getTime()) {
            pendentesHoje.push({ ...it, _when: dt });
          }
          if (dt.getTime() > to.getTime()) {
            proximos.push({ ...it, _when: dt });
          }
        }
        continue;
      }

      if (it.tipo === "recorrente") {
        if (it.enabled === false) continue;

        const due = new Date(it.nextDueISO || "");
        if (Number.isNaN(due.getTime())) continue;

        if (due.getTime() >= from.getTime() && due.getTime() <= to.getTime()) {
          pendentesHoje.push({ ...it, _when: due, _rec: true });
        } else if (due.getTime() > to.getTime()) {
          proximos.push({ ...it, _when: due, _rec: true });
        }

        const paidAt = it.paidAt ? new Date(it.paidAt) : null;
        if (paidAt && paidAt.getTime() >= from.getTime() && paidAt.getTime() <= to.getTime()) {
          pagosHoje.push({ ...it, _when: due, _paidAt: paidAt, _rec: true });
        }
        proximosPagos.push({ ...it, _when: due, _paidAt: paidAt, _rec: true });
      }
    }

    pendentesHoje.sort((a, b) => a._when.getTime() - b._when.getTime());
    concluidosHoje.sort((a, b) => (b._doneAt?.getTime?.() || 0) - (a._doneAt?.getTime?.() || 0));
    pagosHoje.sort((a, b) => (b._paidAt?.getTime?.() || 0) - (a._paidAt?.getTime?.() || 0));

    proximos.sort((a, b) => a._when.getTime() - b._when.getTime());
    proximosConcluidos.sort((a, b) => {
      const ax = a._doneAt ? a._doneAt.getTime() : 0;
      const bx = b._doneAt ? b._doneAt.getTime() : 0;
      return bx - ax;
    });
    proximosPagos.sort((a, b) => {
      const ax = a._paidAt ? a._paidAt.getTime() : 0;
      const bx = b._paidAt ? b._paidAt.getTime() : 0;
      return bx - ax;
    });

    // ✅ 7 dias (contagem pendentes por dia)
    const days = Array.from({ length: 7 }).map((_, idx) => {
      const d = addDays(from, idx);
      const key = toLocalDateKey(d);
      let count = 0;
      for (const it of list) {
        if (it.tipo === "avulso") {
          if (it.done) continue;
          const dt = parseLocalDateTime(it.quando);
          if (!dt) continue;
          if (toLocalDateKey(dt) === key) count++;
          continue;
        }
        if (it.tipo === "recorrente") {
          if (it.enabled === false) continue;
          const dt = new Date(it.nextDueISO || "");
          if (Number.isNaN(dt.getTime())) continue;
          if (toLocalDateKey(dt) === key) count++;
        }
      }
      return { key, date: d, count };
    });

    return {
      pendentesHoje,
      concluidosHoje,
      pagosHoje,
      proximos,
      ultimosConcluidos: proximosConcluidos.slice(0, 4),
      ultimosPagos: proximosPagos.slice(0, 4),
      days,
    };
  }, [lembretesList]);

  // ✅ agenda os avisos do “hoje” (somente enquanto o app está aberto)
  useEffect(() => {
    clearAllTimers();

    // agenda pendentes de hoje e próximos próximos (até 7 dias)
    const now = new Date();
    const to = endOfDay(now);
    const limit = addDays(now, 7);

    for (const it of lembretesList) {
      if (!it) continue;

      if (it.tipo === "avulso") {
        if (it.done) continue;
        const dt = parseLocalDateTime(it.quando);
        if (!dt) continue;

        // só agenda se estiver no intervalo “agora até 7 dias”
        if (dt.getTime() >= Date.now() && dt.getTime() <= limit.getTime()) {
          scheduleNotifyAt("⏰ Lembrete", dt, it.titulo || "Lembrete");
        }
        continue;
      }

      if (it.tipo === "recorrente") {
        if (it.enabled === false) continue;
        const dt = new Date(it.nextDueISO || "");
        if (Number.isNaN(dt.getTime())) continue;

        if (dt.getTime() >= Date.now() && dt.getTime() <= limit.getTime()) {
          scheduleNotifyAt("📌 Lembrete do dia", dt, `${it.titulo || "Lembrete"} hoje`);
        }

        // extra: se já está vencido hoje, notifica uma vez ao abrir (sem girar data)
        if (dt.getTime() <= to.getTime() && dt.getTime() <= Date.now()) {
          // não spammar: só se não tiver lastNotifiedDate hoje
          const todayKey = toLocalDateKey(new Date());
          if (it.lastNotifiedDate !== todayKey) {
            // não alteramos a lista aqui (Finanças só mostra), só avisamos
            showNotify("📌 Lembrete pendente", `${it.titulo || "Lembrete"} (vencido hoje)`);
          }
        }
      }
    }

    return () => clearAllTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lembretesList, notifPerm]);

  /* -------------------- resumo financeiro (mantém sua lógica) -------------------- */

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

      let categorias = { essencial: 0, lazer: 0, burrice: 0, investido: 0 };
      const semanas = [0, 0, 0, 0];

      const chaveMes = monthKey(ano, mes0);

      const gastosFixosPerfil = (Array.isArray(profile?.gastosFixos) ? profile.gastosFixos : [])
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

            const dia = dt.getDate();
            const semanaIndex = Math.min(3, Math.floor((dia - 1) / 7));
            semanas[semanaIndex] += valor;
          }
        }
      });

      const totalGastosFixos = gastosFixosPerfil.reduce((acc, g) => acc + Number(g.valor || 0), 0);
      const despesas = despesasTransacoes + totalGastosFixos;
      const saldo = receitas - despesas;

      return {
        receitas,
        despesas,
        saldo,
        gastosCartao,
        categorias,
        semanas,
        maxSemana: Math.max(...semanas, 1),
        gastosFixos: gastosFixosPerfil,
        totalGastosFixos,
        despesasTransacoes,
        pEssencial:
          ((categorias.essencial || 0) /
            ((categorias.essencial || 0) +
              (categorias.lazer || 0) +
              (categorias.burrice || 0) +
              (categorias.investido || 0) ||
              1)) *
          100,
        pLazer:
          ((categorias.lazer || 0) /
            ((categorias.essencial || 0) +
              (categorias.lazer || 0) +
              (categorias.burrice || 0) +
              (categorias.investido || 0) ||
              1)) *
          100,
        pBurrice:
          ((categorias.burrice || 0) /
            ((categorias.essencial || 0) +
              (categorias.lazer || 0) +
              (categorias.burrice || 0) +
              (categorias.investido || 0) ||
              1)) *
          100,
        pInvestido:
          ((categorias.investido || 0) /
            ((categorias.essencial || 0) +
              (categorias.lazer || 0) +
              (categorias.burrice || 0) +
              (categorias.investido || 0) ||
              1)) *
          100,
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
  }, [transacoes, mesReferencia, profile?.gastosFixos, profile?.rendaMensal, profile?.salariosPorMes]);

  const { resumoAtual, pendenteAnterior } = resumo;

  const chaveMesAtual = monthKey(mesReferencia.ano, mesReferencia.mes);
  const salarioFixo = Number((profile?.salariosPorMes || {})[chaveMesAtual] ?? profile?.rendaMensal ?? 0);

  const limiteGastoMensal = Number(profile?.limiteGastoMensal || 0);

  const diaPagamento = profile?.diaPagamento || "";
  const proximoPag = diaPagamento ? calcularProximoPagamento(diaPagamento) : null;

  const resultadoSalario = salarioFixo > 0 ? salarioFixo - resumoAtual.despesas - pendenteAnterior : null;

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
        <div className="resumo-footer">
          {resultadoSalario !== null && (
            <span className={"badge badge-pill " + (resultadoSalario >= 0 ? "badge-positive" : "badge-negative")}>
              {resultadoSalario >= 0 ? "Sobrou" : "Faltou"} {formatCurrency(Math.abs(resultadoSalario))}
            </span>
          )}
        </div>

        {/* pendente + próximo pagamento */}
        {pendenteAnterior > 0 && (
          <div
            style={{
              marginTop: 10,
              display: "flex",
              gap: 8,
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="badge badge-pill badge-negative">
                Pendente do mês anterior: {formatCurrency(pendenteAnterior)}
              </span>

              {diaPagamento ? (
                <span className="pill" style={{ padding: "8px 10px" }}>
                  <span>Dia {diaPagamento}</span>
                  {proximoPag && (
                    <span className="pill-sub" style={{ marginLeft: 8 }}>
                      Próx. em {proximoPag.diasRestantes} dia(s)
                    </span>
                  )}
                </span>
              ) : null}
            </div>
          </div>
        )}

        {pendenteAnterior <= 0 && (
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
            <div className="pill">
              {diaPagamento ? (
                <>
                  <span>Dia {diaPagamento}</span>
                  {proximoPag && <span className="pill-sub">Próx. em {proximoPag.diasRestantes} dia(s)</span>}
                </>
              ) : (
                <span>Sem dia definido</span>
              )}
            </div>
          </div>
        )}

        {/* ✅ Lembretes (mais completo + status de notificação) */}
        <div style={{ marginTop: 12 }}>
          <div
            className="card"
            role="button"
            tabIndex={0}
            onClick={() => safeNavigateTo("/lembretes")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") safeNavigateTo("/lembretes");
            }}
            style={{
              padding: 10,
              background: "rgba(255,255,255,.03)",
              border: "1px solid rgba(255,255,255,.08)",
              cursor: "pointer",
            }}
            title="Clique para abrir Lembretes"
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>📌 Lembretes</div>

                <div className="muted small" style={{ marginTop: 2 }}>
                  Pendentes hoje: <b>{lembretesResumo.pendentesHoje.length}</b>{" "}
                  {lembretesResumo.concluidosHoje.length > 0 ? (
                    <>
                      • Concluídos hoje: <b>{lembretesResumo.concluidosHoje.length}</b>
                    </>
                  ) : null}
                  {lembretesResumo.pagosHoje.length > 0 ? (
                    <>
                      {" "}
                      • Pagos hoje: <b>{lembretesResumo.pagosHoje.length}</b>
                    </>
                  ) : null}
                </div>

                {/* ✅ botões de notificação */}
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {notifPerm === "granted" ? (
                    <span className="badge badge-pill badge-positive">🔔 Ativas</span>
                  ) : notifPerm === "unsupported" ? (
                    <span className="badge badge-pill badge-negative">🔕 Sem suporte</span>
                  ) : (
                    <button
                      className="toggle-btn"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ativarNotificacoes();
                      }}
                      type="button"
                      style={{ padding: "8px 10px" }}
                    >
                      🔔 Ativar notificações
                    </button>
                  )}

                  <button
                    className="toggle-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setNotifPerm("Notification" in window ? Notification.permission : "unsupported");
                      testarNotificacao();
                    }}
                    type="button"
                    style={{ padding: "8px 10px" }}
                  >
                    📩 Testar
                  </button>

                  <span className="muted small" style={{ opacity: 0.9 }}>
                    SW: {swInfo.hasSW ? "✅" : "❌"}
                  </span>
                </div>

                <div className="muted small" style={{ marginTop: 6, opacity: 0.9 }}>
                  Obs.: sem push/FCM, os avisos automáticos só funcionam enquanto o app está aberto.
                </div>
              </div>

              {/* bolinhas 7 dias */}
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "nowrap" }}>
                {lembretesResumo.days.map((d, idx) => {
                  const isToday = idx === 0;
                  const count = d.count || 0;
                  const dotOpacity = count ? 1 : 0.25;

                  return (
                    <div
                      key={d.key}
                      title={`${fmtShortBR(d.date)} • ${count} pendente(s)`}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 34 }}
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

            {/* Pendentes de hoje */}
            {lembretesResumo.pendentesHoje.length === 0 ? (
              <div className="muted small" style={{ marginTop: 8 }}>
                Nada pendente para hoje 🎉
              </div>
            ) : (
              <ul className="list" style={{ marginTop: 8 }}>
                {lembretesResumo.pendentesHoje.slice(0, 4).map((t) => (
                  <li key={t.id} className="list-item" style={{ padding: "8px 10px" }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.titulo || "Sem título"}{" "}
                      <span className="muted small" style={{ fontWeight: 600 }}>
                        • {t.tipo === "recorrente" ? "recorrente" : "avulso"}
                      </span>
                    </span>
                    <span className="muted small" style={{ whiteSpace: "nowrap" }}>
                      {fmtTimeHHmm(t._when)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* ✅ Concluídos hoje (avulsos) */}
            {lembretesResumo.concluidosHoje.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="muted small" style={{ marginBottom: 6 }}>
                  Concluídos hoje:
                </div>
                <ul className="list">
                  {lembretesResumo.concluidosHoje.slice(0, 3).map((t) => (
                    <li key={t.id} className="list-item" style={{ padding: "8px 10px", opacity: 0.8 }}>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        ✅ {t.titulo || "Sem título"}
                      </span>
                      <span className="muted small" style={{ whiteSpace: "nowrap" }}>
                        {t._doneAt ? fmtTimeHHmm(t._doneAt) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ✅ Pagos hoje (recorrentes) */}
            {lembretesResumo.pagosHoje.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="muted small" style={{ marginBottom: 6 }}>
                  Pagos hoje:
                </div>
                <ul className="list">
                  {lembretesResumo.pagosHoje.slice(0, 3).map((t) => (
                    <li key={t.id} className="list-item" style={{ padding: "8px 10px", opacity: 0.85 }}>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        💳 {t.titulo || "Sem título"}
                      </span>
                      <span className="muted small" style={{ whiteSpace: "nowrap" }}>
                        {t._paidAt ? fmtTimeHHmm(t._paidAt) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Próximos */}
            {lembretesResumo.proximos.length > 0 && (
              <div className="muted small" style={{ marginTop: 10, lineHeight: 1.35 }}>
                Próximos:{" "}
                {lembretesResumo.proximos.slice(0, 3).map((u, idx) => (
                  <span key={u.id}>
                    <b>{fmtShortBR(u._when)}</b> {fmtTimeHHmm(u._when)} — {u.titulo || "Sem título"}
                    {idx < Math.min(3, lembretesResumo.proximos.length) - 1 ? " • " : ""}
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

      {/* CATEGORIAS / SEMANAS */}
      <div className="grid-2 mt">
        <div
          className="card"
          onClick={() => setModalCategorias(true)}
          style={{ cursor: "pointer" }}
          title="Clique para abrir detalhes"
        >
          <h3>Gasto por categoria</h3>

          <div className="pizza-chart-wrapper">
            <div className="pizza-chart" style={pizzaStyle} />
          </div>

          <div className="legend">
            <div className="legend-item">
              <span className="legend-color legend-essential" />
              Essencial ({(resumoAtual.pEssencial || 0).toFixed(0)}%)
            </div>
            <div className="legend-item">
              <span className="legend-color legend-leisure" />
              Lazer ({(resumoAtual.pLazer || 0).toFixed(0)}%)
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

          <div className="weeks-grid">
            {resumoAtual.semanas.map((v, i) => {
              const pct = resumoAtual.maxSemana > 0 ? Math.max(2, (v / resumoAtual.maxSemana) * 100) : 2;

              return (
                <div className="week-cell" key={i}>
                  <div className="muted small week-value">{formatCurrency(v)}</div>

                  <div
                    style={{
                      width: "100%",
                      height: 6,
                      borderRadius: 999,
                      background: "rgba(255,255,255,.08)",
                      overflow: "hidden",
                      marginTop: 6,
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ width: `${pct}%`, height: "100%", background: "rgba(143,163,255,.85)" }} />
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

      {/* MODAL DETALHADO (mantido simples: você pode plugar seu modal completo aqui se quiser) */}
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
                  <b>Receitas</b>
                </span>
                <span>
                  <b>{formatCurrency(resumoAtual.receitas)}</b>
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
                <span>
                  <b>Despesas</b>
                </span>
                <span>
                  <b>{formatCurrency(resumoAtual.despesas)}</b>
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
                <span>
                  <b>Saldo</b>
                </span>
                <span>
                  <b>{formatCurrency(saldoComSalario)}</b>
                </span>
              </div>
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
