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

function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

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
  const keys = ["uber", "99", "taxi", "táxi", "onibus", "ônibus", "passagem", "transporte", "corrida"];
  return keys.some((k) => d.includes(normalizeText(k)));
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

/* -------------------- helpers para lembretes + estudos -------------------- */
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

/* ✅ navegação sem depender de react-router */
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

/* ✅ Notificação topo */
async function showTopBarNotification(title, body, tag = "finance-agenda") {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, { body, tag, renotify: true });
        return;
      }
    }
  } catch {}

  try {
    new Notification(title, { body });
  } catch {}
}

/* -------------------- ✅ Recorrência (fallback) -------------------- */
function computeNextDueFallback(item, baseDate = new Date()) {
  // Fallback bem tolerante: tenta achar "a cada" + unidade, senão joga +1 dia
  const every =
    Number(item?.every ?? item?.aCada ?? item?.interval ?? item?.intervalo ?? item?.intervalDays ?? item?.dias ?? 0) || 1;

  const unitRaw = String(item?.unit ?? item?.unidade ?? item?.periodo ?? item?.freq ?? item?.frequencia ?? "dias").toLowerCase();

  const b = new Date(baseDate);
  if (Number.isNaN(b.getTime())) return new Date();

  if (unitRaw.includes("sem")) {
    b.setDate(b.getDate() + every * 7);
    return b;
  }
  if (unitRaw.includes("mes")) {
    b.setMonth(b.getMonth() + every);
    return b;
  }
  if (unitRaw.includes("ano")) {
    b.setFullYear(b.getFullYear() + every);
    return b;
  }
  // dias (padrão)
  b.setDate(b.getDate() + every);
  return b;
}

export default function FinancasPage() {
  // ✅ pega tudo sem quebrar caso alguma função não exista no contexto
  const finance = useFinance() || {};

  const {
    transacoes,
    profile,
    mesReferencia,
    mudarMesReferencia,
    irParaMesAtual,
    lembretes,
    estudos,
    user,

    // ✅ se existir no seu App.jsx, a gente usa:
    setLembretes,
    salvarLembretes,
    updateLembrete,
    marcarLembreteComoFeito,
    setEstudos,
    salvarEstudos,
    updateTarefaEstudo,
    marcarTarefaEstudoComoFeita,
  } = finance;

  const [modalCategorias, setModalCategorias] = useState(false);

  // ✅ NOVO: modal por item (não por lista)
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemModal, setItemModal] = useState(null);
  // itemModal = { tipo: "lembrete"|"estudo", id, titulo, when, raw, extra... }

  const openItemModal = (payload) => {
    setItemModal(payload);
    setItemModalOpen(true);
  };
  const closeItemModal = () => {
    setItemModalOpen(false);
    setItemModal(null);
  };

  // ✅ notificações (só pede permissão ao clicar)
  const [notifStatus, setNotifStatus] = useState(
    "Notification" in window ? Notification.permission : "unsupported"
  );

  async function ativarNotificacoes() {
    if (!("Notification" in window)) {
      alert("Seu navegador não suporta notificações.");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      setNotifStatus(perm);
      if (perm === "granted") {
        await showTopBarNotification("🔔 Notificações ativadas!", "Agora você pode receber avisos do seu dia.");
      }
    } catch {
      alert("Não consegui ativar notificações. Verifique as permissões do navegador.");
    }
  }

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

      (Array.isArray(transacoes) ? transacoes : []).forEach((t) => {
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

      const mapa = new Map();
      (Array.isArray(transacoes) ? transacoes : []).forEach((t) => {
        const dt = new Date(t.dataHora);
        if (t.tipo === "despesa" && dt.getMonth() === mes0 && dt.getFullYear() === ano) {
          const v = Number(t.valor || 0);
          if (!v) return;
          const key = normalizarNome(t.descricao || "Sem descrição");
          const atual = mapa.get(key) || { descricao: t.descricao || "Sem descrição", valor: 0, count: 0 };
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

      const totalCat = categorias.essencial + categorias.lazer + categorias.burrice + categorias.investido || 1;

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

    const { mes, ano } = mesReferencia || { mes: new Date().getMonth(), ano: new Date().getFullYear() };
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

  const chaveMesAtual = monthKey(mesReferencia?.ano ?? new Date().getFullYear(), mesReferencia?.mes ?? new Date().getMonth());
  const salarioFixo = Number((profile?.salariosPorMes || {})[chaveMesAtual] ?? profile?.rendaMensal ?? 0);
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
  ][mesReferencia?.mes ?? new Date().getMonth()];

  const detalhesCategorias = useMemo(() => {
    const mes0 = mesReferencia?.mes ?? new Date().getMonth();
    const ano = mesReferencia?.ano ?? new Date().getFullYear();

    const despesasMes = (Array.isArray(transacoes) ? transacoes : [])
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
        if ((!cur.descricao || cur.descricao === "Sem descrição") && t.descricao) cur.descricao = t.descricao;
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
      tudoCount: tudo.length,
    };
  }, [transacoes, mesReferencia, resumoAtual.gastosFixos]);

  /* -------------------- lembretes (compacto) + fallback + sync local -------------------- */
  const [lembretesFallback, setLembretesFallback] = useState([]);
  const [lembretesOverride, setLembretesOverride] = useState(null);

  useEffect(() => {
    try {
      if (Array.isArray(lembretes) && lembretes.length) {
        setLembretesOverride(null);
        return;
      }
      const raw = localStorage.getItem("pwa_lembretes_v1") || "[]";
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setLembretesFallback(parsed);
    } catch {}
  }, [lembretes]);

  const lembretesList = useMemo(() => {
    if (Array.isArray(lembretesOverride)) return lembretesOverride;
    if (Array.isArray(lembretes) && lembretes.length) return lembretes;
    return lembretesFallback;
  }, [lembretesOverride, lembretes, lembretesFallback]);

  /* -------------------- estudos (local override opcional) -------------------- */
  const [estudosOverride, setEstudosOverride] = useState(null);
  const estudosBase = estudosOverride || estudos || null;

  /* -------------------- ✅ AÇÕES: marcar como feito (com refletir nas abas) -------------------- */
  async function marcarFeitoAtual() {
    if (!itemModal) return;

    // ===== LEMBRETES =====
    if (itemModal.tipo === "lembrete") {
      const id = itemModal.id;
      const raw = itemModal.raw || {};

      // 1) Se o contexto tiver função, usa
      try {
        if (typeof marcarLembreteComoFeito === "function") {
          await marcarLembreteComoFeito(id);
          closeItemModal();
          return;
        }
        if (typeof updateLembrete === "function") {
          // tentativa genérica: updateLembrete(id, patch)
          if (raw.tipo === "avulso") {
            await updateLembrete(id, { done: true });
          } else {
            const now = new Date();
            const next = computeNextDueFallback(raw, now);
            await updateLembrete(id, {
              lastDoneISO: now.toISOString(),
              nextDueISO: next.toISOString(),
            });
          }
          closeItemModal();
          return;
        }
      } catch {}

      // 2) Fallback localStorage (pwa_lembretes_v1)
      try {
        const list = Array.isArray(lembretesList) ? [...lembretesList] : [];
        const idx = list.findIndex((x) => x && String(x.id) === String(id));
        if (idx >= 0) {
          const it = { ...(list[idx] || {}) };
          if (it.tipo === "avulso") {
            it.done = true;
            it.doneAtISO = new Date().toISOString();
          } else {
            const now = new Date();
            const next = computeNextDueFallback(it, now);
            it.lastDoneISO = now.toISOString();
            it.nextDueISO = next.toISOString();
          }
          list[idx] = it;

          // salva
          localStorage.setItem("pwa_lembretes_v1", JSON.stringify(list));

          // reflete na UI aqui
          setLembretesOverride(list);

          // se tiver setLembretes/salvarLembretes, tenta sincronizar
          try {
            if (typeof setLembretes === "function") setLembretes(list);
            if (typeof salvarLembretes === "function") salvarLembretes(list);
          } catch {}
        }
      } catch {}

      closeItemModal();
      return;
    }

    // ===== ESTUDOS =====
    if (itemModal.tipo === "estudo") {
      const id = itemModal.id;

      // 1) Se o contexto tiver função, usa
      try {
        if (typeof marcarTarefaEstudoComoFeita === "function") {
          await marcarTarefaEstudoComoFeita(id);
          closeItemModal();
          return;
        }
        if (typeof updateTarefaEstudo === "function") {
          await updateTarefaEstudo(id, { status: "feito", feitoEmISO: new Date().toISOString() });
          closeItemModal();
          return;
        }
      } catch {}

      // 2) Fallback: tenta editar a estrutura estudos.tarefas e guardar em localStorage
      try {
        const base = estudosBase && typeof estudosBase === "object" ? { ...estudosBase } : { tarefas: [] };
        const tarefas = Array.isArray(base.tarefas) ? [...base.tarefas] : [];
        const idx = tarefas.findIndex((t) => t && String(t.id) === String(id));
        if (idx >= 0) {
          tarefas[idx] = { ...(tarefas[idx] || {}), status: "feito", feitoEmISO: new Date().toISOString() };
          base.tarefas = tarefas;

          // tenta salvar em LS (caso seu EstudosPage use outro, você pode trocar aqui)
          localStorage.setItem("pwa_estudos_v1", JSON.stringify(base));

          setEstudosOverride(base);

          try {
            if (typeof setEstudos === "function") setEstudos(base);
            if (typeof salvarEstudos === "function") salvarEstudos(base);
          } catch {}
        }
      } catch {}

      closeItemModal();
      return;
    }
  }

  /* -------------------- lembretesCompact (agora guarda raw + permite modal por item) -------------------- */
  const lembretesCompact = useMemo(() => {
    const list = Array.isArray(lembretesList) ? lembretesList : [];
    const now = new Date();
    const from = startOfDay(now);
    const to = endOfDay(now);

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
            raw: it,
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
            raw: it,
          };
        }

        return null;
      })
      .filter(Boolean)
      .sort((a, b) => a.when.getTime() - b.when.getTime());

    const todayAll = events.filter((e) => e.when.getTime() >= from.getTime() && e.when.getTime() <= to.getTime());
    const today = todayAll.slice(0, 6); // aqui é só pra preview, mas você pediu só título mesmo
    const upcoming = events.filter((e) => e.when.getTime() > to.getTime()).slice(0, 6);

    const days = Array.from({ length: 7 }).map((_, idx) => {
      const d = addDays(from, idx);
      const key = toLocalDateKey(d);
      let count = 0;
      for (const ev of events) {
        if (toLocalDateKey(ev.when) === key) count++;
      }
      return { key, date: d, count };
    });

    return { today, todayCount: todayAll.length, upcoming, days, todayAll };
  }, [lembretesList]);

  /* -------------------- estudosCompact (também guarda raw) -------------------- */
  const estudosCompact = useMemo(() => {
    const tarefas = Array.isArray(estudosBase?.tarefas) ? estudosBase.tarefas : [];
    const now = new Date();
    const from = startOfDay(now);
    const to = endOfDay(now);
    const todayKey = toLocalDateKey(now);

    const all = tarefas
      .filter((t) => t && t.ymd)
      .map((t) => ({
        id: t.id,
        ymd: String(t.ymd),
        hora: String(t.hora || ""),
        materia: String(t.materia || "Estudos"),
        conteudo: String(t.conteudo || ""),
        status: String(t.status || "pendente"),
        minutos: Number(t.minutos || 0),
        tipo: String(t.tipo || "conteudo"),
        nota: String(t.nota || ""),
        raw: t,
      }));

    const todayAll = all
      .filter((t) => t.ymd === todayKey)
      .sort((a, b) => (a.hora || "99:99").localeCompare(b.hora || "99:99"));

    const todayPendingAll = todayAll.filter((t) => t.status !== "feito");
    const todayPending = todayPendingAll.slice(0, 6);

    const next7 = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(from, i);
      const key = toLocalDateKey(d);
      const itens = all
        .filter((t) => t.ymd === key && t.status !== "feito")
        .sort((a, b) => (a.hora || "99:99").localeCompare(b.hora || "99:99"));
      next7.push({ key, date: d, count: itens.length, itens: itens.slice(0, 6) });
    }

    const afterToday = all
      .filter((t) => t.status !== "feito")
      .filter((t) => {
        const dt = new Date(t.ymd + "T00:00:00");
        if (Number.isNaN(dt.getTime())) return false;
        return dt.getTime() > to.getTime();
      })
      .sort((a, b) => {
        const ad = String(a.ymd || "");
        const bd = String(b.ymd || "");
        if (ad !== bd) return ad.localeCompare(bd);
        return (a.hora || "99:99").localeCompare(b.hora || "99:99");
      })
      .slice(0, 6);

    return {
      todayAll,
      todayPendingAll,
      todayPending,
      todayPendingCount: todayPendingAll.length,
      days: next7.map((x) => ({ key: x.key, date: x.date, count: x.count })),
      upcoming: afterToday,
      todayKey,
    };
  }, [estudosBase]);

  /* -------------------- ✅ Notificação ao abrir (1x por dia) -------------------- */
  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const todayKey = toLocalDateKey(new Date());
    const keyLS = user?.uid ? `pwa_fin_today_notif_${user.uid}` : "pwa_fin_today_notif_local";
    const last = localStorage.getItem(keyLS) || "";
    if (last === todayKey) return;

    const lembHoje = (lembretesCompact.todayAll || []).length;
    const estHoje = Number(estudosCompact.todayPendingCount || 0);

    if (lembHoje <= 0 && estHoje <= 0) return;

    const lines = [];

    if (lembHoje > 0) {
      const top = (lembretesCompact.todayAll || [])
        .slice(0, 6)
        .map((t) => `• ${t.titulo}${t.when ? ` (${fmtTimeHHmm(t.when)})` : ""}`);
      lines.push(`📌 Lembretes hoje: ${lembHoje}`);
      lines.push(...top);
    }

    if (estHoje > 0) {
      const top = (estudosCompact.todayPendingAll || [])
        .slice(0, 6)
        .map((t) => `• ${t.hora ? t.hora + " " : ""}${t.materia}: ${t.conteudo}`.trim());
      if (lines.length) lines.push("");
      lines.push(`📚 Estudos hoje: ${estHoje}`);
      lines.push(...top);
    }

    const body = lines.join("\n").slice(0, 900);
    showTopBarNotification("✅ Seu dia (Finanças)", body, "financas-dia");

    try {
      localStorage.setItem(keyLS, todayKey);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lembretesCompact.todayCount, estudosCompact.todayPendingCount, notifStatus]);

  return (
    <div className="page">
      <h2 className="page-title">Visão geral do mês</h2>

      {/* NAVEGAÇÃO DO MÊS */}
      <div className="card" style={{ textAlign: "center", marginBottom: 12 }}>
        <h3>
          {nomeMes} / {mesReferencia?.ano ?? new Date().getFullYear()}
        </h3>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
          <button className="toggle-btn" onClick={() => mudarMesReferencia?.(-1)}>
            ◀ Mês anterior
          </button>
          <button className="toggle-btn toggle-active" onClick={irParaMesAtual}>
            ● Atual
          </button>
          <button className="toggle-btn" onClick={() => mudarMesReferencia?.(1)}>
            Próximo mês ▶
          </button>
        </div>
      </div>

      {/* BLOCO PRINCIPAL */}
      <div className="card resumo-card">
        <div className="resumo-footer">
          {resultadoSalario !== null && (
            <span
              className={
                "badge badge-pill " + (resultadoSalario >= 0 ? "badge-positive" : "badge-negative")
              }
            >
              {resultadoSalario >= 0 ? "Sobrou" : "Faltou"} {formatCurrency(Math.abs(resultadoSalario))}
            </span>
          )}
        </div>

        {/* ✅ AGENDA (HOJE) */}
        <div style={{ marginTop: 10 }}>
          <div
            className="card"
            style={{
              padding: 10,
              background: "rgba(255,255,255,.03)",
              border: "1px solid rgba(255,255,255,.08)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 240 }}>
                <div style={{ fontWeight: 900, fontSize: 14 }}>📅 Hoje</div>

                <div className="muted small" style={{ marginTop: 4 }}>
                  {pendenteAnterior > 0 ? (
                    <>
                      <b>Pendente:</b> {formatCurrency(pendenteAnterior)}{" "}
                    </>
                  ) : (
                    <>
                      <b>Pendente:</b> R$ 0,00{" "}
                    </>
                  )}
                  {" • "}
                  {diaPagamento ? (
                    <>
                      <b>Dia {diaPagamento}</b>
                      {proximoPag ? <> • Próx. em {proximoPag.diasRestantes} dia(s)</> : null}
                    </>
                  ) : (
                    <>Sem dia definido</>
                  )}
                </div>

                {/* ✅ Botão de notificações */}
                <div style={{ marginTop: 8 }}>
                  {notifStatus === "granted" ? (
                    <span className="badge badge-pill badge-positive">🔔 Notificações ativas</span>
                  ) : notifStatus === "unsupported" ? (
                    <span className="badge badge-pill badge-negative">🔕 Sem suporte a notificações</span>
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
                </div>
              </div>

              {/* dots semana - lembretes + estudos (somado) */}
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "nowrap" }}>
                {Array.from({ length: 7 }).map((_, idx) => {
                  const d = addDays(startOfDay(new Date()), idx);
                  const key = toLocalDateKey(d);

                  const lembCount = (lembretesCompact.days || []).find((x) => x.key === key)?.count || 0;
                  const estCount = (estudosCompact.days || []).find((x) => x.key === key)?.count || 0;

                  const count = lembCount + estCount;
                  const isToday = idx === 0;
                  const dotOpacity = count ? 1 : 0.25;

                  return (
                    <div
                      key={key}
                      title={`${fmtShortBR(d)} • ${count} (📌 ${lembCount} + 📚 ${estCount})`}
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
                        {fmtShortBR(d)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ✅ AGORA: na parte de lembretes e estudos aparece SÓ os TÍTULOS.
                CLICOU NO TÍTULO -> ABRE MODAL do item, com detalhes + "Marcar como feito" + botão pra ir pra página */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginTop: 10,
              }}
            >
              {/* LEMBRETES */}
              <div
                className="card"
                style={{
                  padding: 10,
                  background: "rgba(255,255,255,.02)",
                  border: "1px solid rgba(255,255,255,.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>📌 Lembretes</div>
                    <div className="muted small" style={{ marginTop: 2 }}>
                      Hoje: <b>{lembretesCompact.todayCount}</b>
                    </div>
                  </div>
                  <button className="toggle-btn" type="button" onClick={() => safeNavigateTo("/lembretes")}>
                    Abrir
                  </button>
                </div>

                {lembretesCompact.todayAll.length === 0 ? (
                  <div className="muted small" style={{ marginTop: 8 }}>
                    Nada para hoje 🎉
                  </div>
                ) : (
                  <ul className="list" style={{ marginTop: 8 }}>
                    {lembretesCompact.todayAll.map((t) => (
                      <li
                        key={t.id}
                        className="list-item"
                        style={{ padding: "8px 10px", cursor: "pointer" }}
                        onClick={() =>
                          openItemModal({
                            tipo: "lembrete",
                            id: t.id,
                            titulo: t.titulo,
                            when: t.when,
                            subtipo: t.tipo,
                            raw: t.raw,
                          })
                        }
                        title="Clique para ver detalhes"
                      >
                        <span
                          style={{
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontWeight: 800,
                          }}
                        >
                          {t.titulo}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* ESTUDOS */}
              <div
                className="card"
                style={{
                  padding: 10,
                  background: "rgba(255,255,255,.02)",
                  border: "1px solid rgba(255,255,255,.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>📚 Estudos</div>
                    <div className="muted small" style={{ marginTop: 2 }}>
                      Hoje (pendente): <b>{estudosCompact.todayPendingCount}</b>
                    </div>
                  </div>
                  <button className="toggle-btn" type="button" onClick={() => safeNavigateTo("/estudos")}>
                    Abrir
                  </button>
                </div>

                {estudosCompact.todayPendingAll.length === 0 ? (
                  <div className="muted small" style={{ marginTop: 8 }}>
                    Nada pendente para hoje 🎉
                  </div>
                ) : (
                  <ul className="list" style={{ marginTop: 8 }}>
                    {estudosCompact.todayPendingAll.map((t) => {
                      const title = `${t.materia}${t.conteudo ? ": " + t.conteudo : ""}`;
                      return (
                        <li
                          key={t.id}
                          className="list-item"
                          style={{ padding: "8px 10px", cursor: "pointer" }}
                          onClick={() =>
                            openItemModal({
                              tipo: "estudo",
                              id: t.id,
                              titulo: title,
                              raw: t.raw,
                              materia: t.materia,
                              conteudo: t.conteudo,
                              hora: t.hora,
                              minutos: t.minutos,
                              nota: t.nota,
                              ymd: t.ymd,
                            })
                          }
                          title="Clique para ver detalhes"
                        >
                          <span
                            style={{
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontWeight: 800,
                            }}
                          >
                            {title}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* ✅ FIM AGENDA */}
      </div>

      {/* ✅ MODAL DO ITEM (UM POR VEZ) */}
      {itemModalOpen && itemModal && (
        <div className="modal-overlay" onClick={closeItemModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>
                {itemModal.tipo === "lembrete" ? "📌 Lembrete" : "📚 Estudo"}
              </h3>
              <button className="toggle-btn" type="button" onClick={closeItemModal}>
                Fechar
              </button>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 16, overflowWrap: "anywhere" }}>{itemModal.titulo}</div>

              {itemModal.tipo === "lembrete" ? (
                <>
                  <div className="muted small" style={{ marginTop: 6 }}>
                    Tipo: <b>{itemModal.subtipo === "recorrente" ? "Recorrente" : "Avulso"}</b>
                    {" • "}
                    Quando: <b>{fmtShortBR(itemModal.when)} {fmtTimeHHmm(itemModal.when)}</b>
                  </div>

                  {/* mostra campos extras se existirem */}
                  {itemModal.raw?.descricao ? (
                    <div className="muted small" style={{ marginTop: 8 }}>
                      <b>Descrição:</b> {String(itemModal.raw.descricao)}
                    </div>
                  ) : null}
                  {itemModal.raw?.categoria ? (
                    <div className="muted small" style={{ marginTop: 6 }}>
                      <b>Categoria:</b> {String(itemModal.raw.categoria)}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="muted small" style={{ marginTop: 6 }}>
                    Data: <b>{String(itemModal.ymd || "")}</b>
                    {itemModal.hora ? (
                      <>
                        {" • "}Hora: <b>{String(itemModal.hora)}</b>
                      </>
                    ) : null}
                    {itemModal.minutos ? (
                      <>
                        {" • "}Duração: <b>{Number(itemModal.minutos)} min</b>
                      </>
                    ) : null}
                  </div>

                  <div className="muted small" style={{ marginTop: 8 }}>
                    <b>Matéria:</b> {String(itemModal.materia || "Estudos")}
                  </div>

                  {itemModal.conteudo ? (
                    <div className="muted small" style={{ marginTop: 6 }}>
                      <b>Conteúdo:</b> {String(itemModal.conteudo)}
                    </div>
                  ) : null}

                  {itemModal.nota ? (
                    <div className="muted small" style={{ marginTop: 6 }}>
                      <b>Nota:</b> {String(itemModal.nota)}
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button
                className="toggle-btn toggle-active"
                type="button"
                onClick={() => safeNavigateTo(itemModal.tipo === "lembrete" ? "/lembretes" : "/estudos")}
              >
                Ir para página
              </button>

              <button className="toggle-btn" type="button" onClick={marcarFeitoAtual}>
                ✅ Marcar como feito
              </button>
            </div>

            <p className="muted small" style={{ marginTop: 10 }}>
              Obs.: Se o seu App.jsx tiver funções de salvar/marcar como feito, isso vai refletir automaticamente nas abas.
              Se não tiver, eu já deixei fallback em localStorage para não “sumir” aqui.
            </p>
          </div>
        </div>
      )}

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
        {(resumoAtual.gastosFixos || []).length === 0 ? (
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
        {(resumoAtual.topDespesas || []).length === 0 ? (
          <p className="muted">Nenhuma despesa ainda.</p>
        ) : (
          <ul className="list">
            {resumoAtual.topDespesas.map((t) => (
              <li key={t.id} className="list-item">
                <span>
                  {t.descricao} {t.count > 1 ? <span className="muted small"> · {t.count}x</span> : null}
                </span>
                <span>{formatCurrency(t.valor)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* CATEGORIAS / SEMANAS */}
      <div className="grid-2 mt">
        <div className="card" onClick={() => setModalCategorias(true)} style={{ cursor: "pointer" }} title="Clique para abrir detalhes">
          <h3>Gasto por categoria</h3>
          <div className="pizza-chart-wrapper">
            <div className="pizza-chart" style={pizzaStyle} />
          </div>
          <div className="legend">
            <div className="legend-item">
              <span className="legend-color legend-essential" /> Essencial ({resumoAtual.pEssencial.toFixed(0)}%)
            </div>
            <div className="legend-item">
              <span className="legend-color legend-leisure" /> Lazer ({resumoAtual.pLazer.toFixed(0)}%)
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ background: "#F59E0B" }} /> Burrice ({(resumoAtual.pBurrice || 0).toFixed(0)}%)
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ background: "#10B981" }} /> Investido ({(resumoAtual.pInvestido || 0).toFixed(0)}%)
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              (Clique para abrir detalhes)
            </p>
          </div>
        </div>

        <div className="card" onClick={() => setModalCategorias(true)} style={{ cursor: "pointer" }} title="Clique para abrir detalhes">
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

      {/* MODAL DETALHADO */}
      {modalCategorias && (
        <div className="modal-overlay" onClick={() => setModalCategorias(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Detalhes do mês</h3>
            <p className="muted small" style={{ marginTop: 4 }}>
              {nomeMes} / {mesReferencia?.ano ?? new Date().getFullYear()}
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

            <div className="card" style={{ marginTop: 10 }}>
              <h4 style={{ marginBottom: 8 }}>🍔 Comida</h4>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>Total</span>
                <span>
                  <b>{formatCurrency(detalhesCategorias.totalFood)}</b>
                </span>
              </div>

              <p className="muted small" style={{ marginTop: 8 }}>
                Itens de comida (somados):
              </p>

              {detalhesCategorias.foodByDesc.length === 0 ? (
                <p className="muted small">Nenhum gasto de comida encontrado.</p>
              ) : (
                <ul className="list" style={{ marginTop: 6 }}>
                  {detalhesCategorias.foodByDesc.map((x, idx) => (
                    <li key={idx} className="list-item">
                      <span>
                        {x.descricao}{" "}
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
                        {x.descricao}{" "}
                        {x.count > 1 ? <span className="muted small"> · {x.count}x</span> : null}
                      </span>
                      <span>{formatCurrency(x.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
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
