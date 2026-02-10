// ✅ Arquivo: src/pages/DivisaoCasaPage.jsx
// ✅ Página: Divisão de Gastos da Casa (moradores editáveis + fixos + variáveis por mês + mês vira pelo diaPagamento do Perfil) + PDF
// ✅ Requer: npm i jspdf jspdf-autotable
//
// ✅ IMPORTANTE:
// - Esta página USA o mesReferencia do seu App.jsx (que já vira pelo diaPagamento do Perfil).
// - Gastos FIXOS ficam salvos e aparecem todo mês.
// - Gastos VARIÁVEIS ficam salvos POR MÊS (água/luz/internet variando todo mês).
// - Nome do morador dá pra trocar normalmente.
// - Nº de moradores não buga: tem botões + / - e o input também funciona.
//
// ✅ AJUSTES (SEU PEDIDO AGORA):
// - Tirado o textão “este mês está vindo blá blá blá…” (ficou clean).
// - “Configurações” e “Pessoas” viraram MODAIS (você clica e abre no meio da tela).
// - PDF: removeu VENCIMENTO, adicionou OBSERVAÇÕES e SEMPRE mostra FIXOS e VARIÁVEIS (sempre).

import React, { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useFinance } from "../App.jsx";

const LS_KEY = "pwa_divisao_casa_v2";

const SUGESTOES_GASTOS = [
  "Aluguel",
  "Condomínio",
  "IPTU (rateado)",
  "Água",
  "Luz",
  "Gás (encanado)",
  "Gás (botijão)",
  "Internet",
  "TV",
  "Telefone",
  "Taxa de lixo",
  "Esgoto",
  "Seguro residencial",
  "Diarista / Limpeza",
  "Materiais de limpeza",
  "Assinaturas compartilhadas (streaming)",
  "Compra do mês (itens comuns)",
  "Fundo de reserva da casa",
  "Pequenos reparos / Manutenção",
  "Dedetização",
  "Outros",
];

function safeJSONParse(v, fallback) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function clamp(n, a, b) {
  const v = Number(n);
  if (Number.isNaN(v)) return a;
  return Math.min(b, Math.max(a, v));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function mesKeyFromRef(mesReferencia) {
  const now = new Date();
  const ano = Number(mesReferencia?.ano ?? now.getFullYear());
  const mes0 = Number(mesReferencia?.mes ?? now.getMonth());
  return `${ano}-${pad2(mes0 + 1)}`; // YYYY-MM
}

function monthLabel(yyyy_mm) {
  const [y, m] = String(yyyy_mm || "").split("-");
  if (!y || !m) return "-";
  return `${m}/${y}`;
}

function formatBRL(value) {
  const n = Number(value || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function normalizeName(s) {
  return String(s || "").trim();
}

function parseMoneyToNumber(v) {
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function ensureMoradores(arr, count) {
  const c = clamp(count, 1, 5);
  let out = Array.isArray(arr) ? [...arr] : [];

  out = out.map((m, idx) => ({
    id: m?.id || uuid(),
    nome: normalizeName(m?.nome) || `Morador ${idx + 1}`,
    percentual: Number(m?.percentual ?? 0),
  }));

  if (out.length < c) {
    for (let i = out.length; i < c; i++) {
      out.push({
        id: uuid(),
        nome: `Morador ${i + 1}`,
        percentual: 100 / c,
      });
    }
  }
  if (out.length > c) out = out.slice(0, c);

  return out;
}

function normalizePercentuais(modoDivisao, moradores) {
  if (modoDivisao === "igual") {
    const c = moradores.length || 1;
    return moradores.map(() => 100 / c);
  }

  const raw = moradores.map((m) => Number(m?.percentual || 0));
  const sum = raw.reduce((a, b) => a + b, 0);

  if (sum <= 0) {
    const c = moradores.length || 1;
    return moradores.map(() => 100 / c);
  }

  return raw.map((p) => (p / sum) * 100);
}

// ✅ Helpers mês anterior / retenção 2 meses
function monthKeyToIndex(key) {
  const [y, m] = String(key || "").split("-");
  const yy = Number(y);
  const mm = Number(m);
  if (!Number.isFinite(yy) || !Number.isFinite(mm)) return null;
  return yy * 12 + (mm - 1);
}

function indexToMonthKey(idx) {
  const y = Math.floor(idx / 12);
  const m0 = ((idx % 12) + 12) % 12;
  return `${y}-${pad2(m0 + 1)}`;
}

function prevMonthKey(key) {
  const idx = monthKeyToIndex(key);
  if (idx === null) return null;
  return indexToMonthKey(idx - 1);
}

function keepOnlyTwoMonths(porMes, realCurrentKey) {
  const obj = porMes && typeof porMes === "object" ? porMes : {};
  const curIdx = monthKeyToIndex(realCurrentKey);
  if (curIdx === null) return obj;

  const keep = new Set([realCurrentKey, indexToMonthKey(curIdx - 1)]);
  const next = {};
  for (const k of Object.keys(obj)) {
    if (keep.has(k)) next[k] = obj[k];
  }
  return next;
}

/**
 * Estrutura:
 * {
 *  casaNome,
 *  modoDivisao,
 *  moradoresCount,
 *  moradores: [{id,nome,percentual}],
 *  fixos: [{id,nome,valor,vencimento,responsavel,observacao}],
 *  porMes: {
 *    "YYYY-MM": {
 *      variaveis: [{id,nome,valor,vencimento,responsavel,observacao}]
 *    }
 *  }
 * }
 */
const DEFAULT_STATE = {
  casaNome: "Gastos da Casa",
  modoDivisao: "igual", // "igual" | "percentual"
  moradoresCount: 2,
  moradores: [
    { id: uuid(), nome: "Morador 1", percentual: 50 },
    { id: uuid(), nome: "Morador 2", percentual: 50 },
  ],
  fixos: [],
  porMes: {},
};

export default function DivisaoCasaPage() {
  const finance = useFinance() || {};
  const { profile, mesReferencia, mudarMesReferencia, setMesAuto } = finance;

  // 🔎 mês que você está VISUALIZANDO (mesReferencia)
  const mesKey = useMemo(() => mesKeyFromRef(mesReferencia), [mesReferencia]);

  // ✅ mês REAL (não depende de você voltar/avançar) — baseado no relógio + regra do diaPagamento
  const mesKeyReal = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();

    const diaRaw = String(profile?.diaPagamento || "").trim().toLowerCase();
    if (!diaRaw) return `${y}-${pad2(m + 1)}`;

    const isBusiness =
      diaRaw.includes("dia util") ||
      diaRaw.includes("dia útil") ||
      /^\d{1,2}$/.test(diaRaw);

    let paydayDate = null;

    const getNthBusinessDayDate = (year, monthIndex, n) => {
      let count = 0;
      const d = new Date(year, monthIndex, 1);
      while (d.getMonth() === monthIndex) {
        const day = d.getDay();
        const isBusinessDay = day !== 0 && day !== 6;
        if (isBusinessDay) {
          count++;
          if (count === n) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        }
        d.setDate(d.getDate() + 1);
      }
      return null;
    };

    if (isBusiness) {
      const mm = diaRaw.match(/(\d+)/);
      const n = mm ? Number(mm[1]) : NaN;
      if (Number.isFinite(n) && n >= 1 && n <= 31) {
        paydayDate = getNthBusinessDayDate(y, m, n);
      }
    } else {
      const mm = diaRaw.match(/\bdia\s+(\d{1,2})\b/);
      const day = mm ? Number(mm[1]) : NaN;
      if (Number.isFinite(day) && day >= 1 && day <= 31) {
        const lastDay = new Date(y, m + 1, 0).getDate();
        paydayDate = new Date(y, m, Math.min(lastDay, day));
      }
    }

    if (!paydayDate) return `${y}-${pad2(m + 1)}`;

    const t0 = new Date(y, m, today.getDate());
    const p0 = new Date(y, m, paydayDate.getDate());

    if (t0 < p0) {
      const prev = new Date(y, m - 1, 1);
      return `${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}`;
    }
    return `${y}-${pad2(m + 1)}`;
  }, [profile?.diaPagamento]);

  const prevRealKey = useMemo(() => prevMonthKey(mesKeyReal), [mesKeyReal]);

  const [state, setState] = useState(() => DEFAULT_STATE);

  // modal (seu “bagulho que clica e abre no meio da tela”)
  const [modal, setModal] = useState(null); // "config" | "pessoas" | null

  // form item
  const [tipoGasto, setTipoGasto] = useState("variavel"); // "fixo" | "variavel"
  const [itemNome, setItemNome] = useState("");
  const [itemValor, setItemValor] = useState("");
  const [itemVencimento, setItemVencimento] = useState(""); // continua existindo no dado (se você quiser usar depois)
  const [itemResponsavel, setItemResponsavel] = useState("");
  const [itemObs, setItemObs] = useState("");

  // edição
  const [editId, setEditId] = useState(null);
  const [editTipo, setEditTipo] = useState("variavel");

  // ====== persist helpers (evita bug por "state" antigo) ======
  function persist(updater) {
    setState((prev) => {
      let next = typeof updater === "function" ? updater(prev) : updater;

      next = {
        ...next,
        porMes: keepOnlyTwoMonths(next.porMes, mesKeyReal),
      };

      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch (e) {
        console.error("Erro ao salvar divisão casa:", e);
      }
      return next;
    });
  }

  // load
  useEffect(() => {
    const raw = safeJSONParse(localStorage.getItem(LS_KEY), null);
    if (raw && typeof raw === "object") {
      const merged = { ...DEFAULT_STATE, ...raw };

      merged.moradoresCount = clamp(merged.moradoresCount ?? 2, 1, 5);
      merged.moradores = ensureMoradores(merged.moradores, merged.moradoresCount);
      merged.fixos = Array.isArray(merged.fixos) ? merged.fixos : [];
      merged.porMes = merged.porMes && typeof merged.porMes === "object" ? merged.porMes : {};

      merged.porMes = keepOnlyTwoMonths(merged.porMes, mesKeyReal);

      setState(merged);
    } else {
      setState({
        ...DEFAULT_STATE,
        porMes: keepOnlyTwoMonths(DEFAULT_STATE.porMes, mesKeyReal),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // garante que o mês VISUALIZADO exista no porMes (sem quebrar navegação)
  useEffect(() => {
    if (!mesKey) return;
    persist((prev) => {
      const porMes = prev.porMes && typeof prev.porMes === "object" ? { ...prev.porMes } : {};
      if (!porMes[mesKey]) porMes[mesKey] = { variaveis: [] };
      if (!Array.isArray(porMes[mesKey].variaveis)) porMes[mesKey].variaveis = [];
      return { ...prev, porMes };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesKey]);

  // ✅ quando o mês REAL muda, limpa automático mantendo só mês real e anterior
  useEffect(() => {
    persist((prev) => ({
      ...prev,
      porMes: keepOnlyTwoMonths(prev.porMes, mesKeyReal),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesKeyReal]);

  // ====== derivados ======
  const moradores = useMemo(() => ensureMoradores(state.moradores, state.moradoresCount), [state.moradores, state.moradoresCount]);

  const percentuaisNormalizados = useMemo(() => normalizePercentuais(state.modoDivisao, moradores), [state.modoDivisao, moradores]);

  const somaPercentuaisDigitados = useMemo(() => moradores.reduce((acc, m) => acc + Number(m?.percentual || 0), 0), [moradores]);

  const fixos = useMemo(() => (Array.isArray(state.fixos) ? state.fixos : []), [state.fixos]);

  const variaveisMes = useMemo(() => {
    const obj = state.porMes && typeof state.porMes === "object" ? state.porMes : {};
    const registro = obj[mesKey] || { variaveis: [] };
    return Array.isArray(registro.variaveis) ? registro.variaveis : [];
  }, [state.porMes, mesKey]);

  const variaveisMesPassado = useMemo(() => {
    const obj = state.porMes && typeof state.porMes === "object" ? state.porMes : {};
    if (!prevRealKey) return [];
    const registro = obj[prevRealKey] || { variaveis: [] };
    return Array.isArray(registro.variaveis) ? registro.variaveis : [];
  }, [state.porMes, prevRealKey]);

  const totalFixos = useMemo(() => fixos.reduce((acc, it) => acc + Number(it?.valor || 0), 0), [fixos]);
  const totalVariaveis = useMemo(() => variaveisMes.reduce((acc, it) => acc + Number(it?.valor || 0), 0), [variaveisMes]);
  const totalGeral = useMemo(() => totalFixos + totalVariaveis, [totalFixos, totalVariaveis]);

  const totalVariaveisMesPassado = useMemo(
    () => variaveisMesPassado.reduce((acc, it) => acc + Number(it?.valor || 0), 0),
    [variaveisMesPassado]
  );

  const valorPorPessoa = useMemo(() => {
    return moradores.map((_, idx) => (totalGeral * (percentuaisNormalizados[idx] || 0)) / 100);
  }, [moradores, totalGeral, percentuaisNormalizados]);

  // ====== setters principais ======
  function setCasaNome(v) {
    persist((prev) => ({ ...prev, casaNome: String(v || "") }));
  }

  function setMoradoresCount(v) {
    const c = clamp(v, 1, 5);
    persist((prev) => {
      let nextMoradores = ensureMoradores(prev.moradores, c);

      if (prev.modoDivisao === "igual") {
        const eq = 100 / c;
        nextMoradores = nextMoradores.map((m) => ({ ...m, percentual: eq }));
      } else {
        const sum = nextMoradores.reduce((acc, m) => acc + Number(m?.percentual || 0), 0);
        if (sum <= 0) {
          const eq = 100 / c;
          nextMoradores = nextMoradores.map((m) => ({ ...m, percentual: eq }));
        }
      }

      return { ...prev, moradoresCount: c, moradores: nextMoradores };
    });
  }

  function incMoradores(delta) {
    setMoradoresCount(clamp(Number(state.moradoresCount) + delta, 1, 5));
  }

  function setModoDivisao(v) {
    const modo = v === "percentual" ? "percentual" : "igual";
    persist((prev) => {
      const c = clamp(prev.moradoresCount ?? 2, 1, 5);
      let nextMoradores = ensureMoradores(prev.moradores, c);

      if (modo === "igual") {
        const eq = 100 / c;
        nextMoradores = nextMoradores.map((m) => ({ ...m, percentual: eq }));
      } else {
        const sum = nextMoradores.reduce((acc, m) => acc + Number(m?.percentual || 0), 0);
        if (sum <= 0) {
          const eq = 100 / c;
          nextMoradores = nextMoradores.map((m) => ({ ...m, percentual: eq }));
        }
      }

      return { ...prev, modoDivisao: modo, moradores: nextMoradores };
    });
  }

  function setMoradorNome(idx, nome) {
    persist((prev) => {
      const c = clamp(prev.moradoresCount ?? 2, 1, 5);
      const arr = ensureMoradores(prev.moradores, c);
      const next = [...arr];
      next[idx] = { ...next[idx], nome: normalizeName(nome) || `Morador ${idx + 1}` };
      return { ...prev, moradores: next };
    });
  }

  function setMoradorPercentual(idx, p) {
    persist((prev) => {
      const c = clamp(prev.moradoresCount ?? 2, 1, 5);
      const arr = ensureMoradores(prev.moradores, c);
      const next = [...arr];
      const val = Number(String(p || "").replace(",", "."));
      next[idx] = { ...next[idx], percentual: Number.isFinite(val) ? val : 0 };
      return { ...prev, moradores: next };
    });
  }

  // ====== itens (fixos/variáveis) ======
  function resetForm() {
    setTipoGasto("variavel");
    setItemNome("");
    setItemValor("");
    setItemVencimento("");
    setItemResponsavel("");
    setItemObs("");
    setEditId(null);
    setEditTipo("variavel");
  }

  function startEdit(it, tipo) {
    setEditId(it.id);
    setEditTipo(tipo);
    setTipoGasto(tipo);

    setItemNome(it.nome || "");
    setItemValor(String(it.valor ?? ""));
    setItemVencimento(it.vencimento || "");
    setItemResponsavel(it.responsavel || "");
    setItemObs(it.observacao || "");
  }

  function removeItem(id, tipo) {
    persist((prev) => {
      if (tipo === "fixo") {
        const nextFixos = (Array.isArray(prev.fixos) ? prev.fixos : []).filter((it) => it.id !== id);
        return { ...prev, fixos: nextFixos };
      }

      const porMes = prev.porMes && typeof prev.porMes === "object" ? { ...prev.porMes } : {};
      const reg = porMes[mesKey] || { variaveis: [] };
      const nextVar = (Array.isArray(reg.variaveis) ? reg.variaveis : []).filter((it) => it.id !== id);
      porMes[mesKey] = { ...reg, variaveis: nextVar };
      return { ...prev, porMes };
    });

    if (editId === id) resetForm();
  }

  function upsertItem() {
    const nome = String(itemNome || "").trim();
    const valor = parseMoneyToNumber(itemValor);
    const venc = String(itemVencimento || "").trim();
    const resp = String(itemResponsavel || "").trim();
    const obs = String(itemObs || "").trim();

    if (!nome) {
      alert("Digite o nome do gasto (ex.: Água).");
      return;
    }
    if (!Number.isFinite(valor) || valor < 0) {
      alert("Digite um valor válido (ex.: 120,50).");
      return;
    }

    const payload = {
      id: editId || uuid(),
      nome,
      valor,
      vencimento: venc, // guardado (mesmo não indo pro PDF)
      responsavel: resp,
      observacao: obs,
    };

    const tipo = editId ? editTipo : tipoGasto;

    persist((prev) => {
      if (tipo === "fixo") {
        const list = Array.isArray(prev.fixos) ? prev.fixos : [];
        const nextFixos = editId ? list.map((it) => (it.id === editId ? payload : it)) : [...list, payload];
        return { ...prev, fixos: nextFixos };
      }

      const porMes = prev.porMes && typeof prev.porMes === "object" ? { ...prev.porMes } : {};
      const reg = porMes[mesKey] || { variaveis: [] };
      const list = Array.isArray(reg.variaveis) ? reg.variaveis : [];
      const nextVar = editId ? list.map((it) => (it.id === editId ? payload : it)) : [...list, payload];
      porMes[mesKey] = { ...reg, variaveis: nextVar };
      return { ...prev, porMes };
    });

    resetForm();
  }

  function copiarVariaveisMesAnterior() {
    const ok = window.confirm(
      "Copiar os gastos VARIÁVEIS do mês anterior para este mês?\n(Água, luz, etc. Você pode editar depois.)"
    );
    if (!ok) return;

    const prevKey = prevMonthKey(mesKey);
    if (!prevKey) return;

    persist((prev) => {
      const porMes = prev.porMes && typeof prev.porMes === "object" ? { ...prev.porMes } : {};
      const prevReg = porMes[prevKey] || { variaveis: [] };
      const prevVar = Array.isArray(prevReg.variaveis) ? prevReg.variaveis : [];

      const cloned = prevVar.map((it) => ({ ...it, id: uuid() }));
      const reg = porMes[mesKey] || { variaveis: [] };
      porMes[mesKey] = { ...reg, variaveis: cloned };

      return { ...prev, porMes };
    });
  }

  function limparSomenteVariaveisDoMes() {
    const ok = window.confirm(`Apagar SOMENTE os gastos VARIÁVEIS do mês ${monthLabel(mesKey)}?`);
    if (!ok) return;

    persist((prev) => {
      const porMes = prev.porMes && typeof prev.porMes === "object" ? { ...prev.porMes } : {};
      const reg = porMes[mesKey] || { variaveis: [] };
      porMes[mesKey] = { ...reg, variaveis: [] };
      return { ...prev, porMes };
    });

    resetForm();
  }

  function limparTudo() {
    const ok = window.confirm("Tem certeza que deseja apagar TODOS os dados (fixos + todos os meses + moradores)?");
    if (!ok) return;
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
    setState(DEFAULT_STATE);
    resetForm();
  }

  // ✅ botões de navegação por mês dentro da Casa
  function voltarUmMes() {
    if (typeof setMesAuto === "function") setMesAuto(false);
    if (typeof mudarMesReferencia === "function") mudarMesReferencia(-1);
  }

  function avancarUmMes() {
    if (typeof setMesAuto === "function") setMesAuto(false);
    if (typeof mudarMesReferencia === "function") mudarMesReferencia(+1);
  }

  // ====== PDF (SEM VENCIMENTO, COM OBS, SEMPRE FIXOS+VARIÁVEIS) ======
  function gerarPDF() {
    if (!jsPDF || !autoTable) {
      alert("PDF indisponível. Instale: npm i jspdf jspdf-autotable");
      return;
    }

    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const titulo = "DIVISÃO DE GASTOS DA CASA";
    const sub1 = `${state.casaNome || "Gastos da Casa"} — Mês: ${monthLabel(mesKey)}`;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(titulo, 40, 50);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(sub1, 40, 70);

    // ✅ Sempre sem vencimento, sempre com observações e sempre com fixos+variáveis
    const cols = ["Tipo", "Gasto", "Valor", "Responsável", "Obs."];

    const linhasFixos = fixos.map((it) => [
      "Fixo",
      String(it.nome || "-"),
      formatBRL(it.valor || 0),
      String(it.responsavel || "-"),
      String(it.observacao || "-"),
    ]);

    const linhasVar = variaveisMes.map((it) => [
      "Variável",
      String(it.nome || "-"),
      formatBRL(it.valor || 0),
      String(it.responsavel || "-"),
      String(it.observacao || "-"),
    ]);

    const body = [
      ...(linhasFixos.length
        ? linhasFixos
        : [["Fixo", "(Sem fixos cadastrados)", "", "", ""]]),
      ...(linhasVar.length
        ? linhasVar
        : [["Variável", "(Sem variáveis deste mês)", "", "", ""]]),
    ];

    autoTable(doc, {
      startY: 90,
      head: [cols],
      body,
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: 4,
        overflow: "linebreak",
      },
      headStyles: { fontStyle: "bold" },
      margin: { left: 40, right: 40 },
    });

    let y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 18 : 140;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("RESUMO", 40, y);
    y += 16;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(`Total FIXOS: ${formatBRL(totalFixos)}`, 40, y);
    y += 14;
    doc.text(`Total VARIÁVEIS (${monthLabel(mesKey)}): ${formatBRL(totalVariaveis)}`, 40, y);
    y += 14;
    doc.text(`Total GERAL: ${formatBRL(totalGeral)}`, 40, y);
    y += 18;

    doc.text(`Modo de divisão: ${state.modoDivisao === "percentual" ? "Percentual" : "Igual"}`, 40, y);
    y += 18;

    autoTable(doc, {
      startY: y,
      head: [["Pessoa", "Percentual", "Valor a pagar"]],
      body: moradores.map((m, i) => [
        m.nome || `Morador ${i + 1}`,
        `${(percentuaisNormalizados[i] || 0).toFixed(2)}%`,
        formatBRL(valorPorPessoa[i] || 0),
      ]),
      styles: { font: "helvetica", fontSize: 10, cellPadding: 4 },
      headStyles: { fontStyle: "bold" },
      margin: { left: 40, right: 40 },
    });

    y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 24 : y + 80;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("ASSINATURAS", 40, y);
    y += 16;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);

    const pageH = doc.internal.pageSize.getHeight();
    const lineW = 220;

    moradores.forEach((m, i) => {
      if (y > pageH - 80) {
        doc.addPage();
        y = 60;
      }

      const nome = m.nome || `Morador ${i + 1}`;

      doc.text(nome, 40, y);
      y += 10;

      doc.line(40, y, 40 + lineW, y);
      doc.text("Assinatura", 40 + lineW + 10, y + 4);

      y += 22;

      doc.text("Data:", 40, y);
      doc.line(80, y + 2, 200, y + 2);

      y += 24;
    });

    const fileName = `divisao_gastos_${(state.casaNome || "casa").replace(/\s+/g, "_")}_${mesKey}.pdf`;
    doc.save(fileName);
  }

  // ====== modal helper ======
  function Modal({ title, children, onClose }) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <h3 style={{ margin: 0 }}>{title}</h3>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar" title="Fechar" style={{ width: "auto", padding: "8px 12px" }}>
              ✕
            </button>
          </div>
          <div style={{ marginTop: 12 }}>{children}</div>
        </div>
      </div>
    );
  }

  // ====== UI ======
  return (
    <div className="page">
      <h2 className="page-title">🏠 Casa — Divisão de Gastos</h2>

      {/* topo clean */}
      <div className="card">
        <div className="filters-grid">
          <div className="field">
            <label>Mês (na tela)</label>
            <input type="text" value={monthLabel(mesKey)} readOnly />
          </div>

          <div className="field">
            <label>Dia de pagamento (Perfil)</label>
            <input type="text" value={String(profile?.diaPagamento || "")} readOnly placeholder="Defina no Perfil" />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <button type="button" className="chip" style={{ width: "auto" }} onClick={voltarUmMes}>
            ◀ Voltar 1 mês
          </button>
          <button type="button" className="chip" style={{ width: "auto" }} onClick={avancarUmMes}>
            Avançar 1 mês ▶
          </button>

          <button type="button" className="chip" style={{ width: "auto", marginLeft: "auto" }} onClick={() => setModal("config")}>
            ⚙️ Configurações
          </button>
          <button type="button" className="chip" style={{ width: "auto" }} onClick={() => setModal("pessoas")}>
            👥 Pessoas
          </button>
        </div>

        <div className="muted small" style={{ marginTop: 10 }}>
          Retenção automática: fica salvo <b>{monthLabel(mesKeyReal)}</b> e <b>{monthLabel(prevRealKey)}</b>.
        </div>
      </div>

      {/* ✅ Contas do mês passado (somente do mês passado) */}
      <div className="card mt">
        <h3 style={{ marginBottom: 8 }}>Contas do mês passado</h3>
        <div className="muted small" style={{ marginBottom: 10 }}>
          Mostrando variáveis do mês passado real: <b>{monthLabel(prevRealKey)}</b>
        </div>

        {variaveisMesPassado.length === 0 ? (
          <p className="muted small">Nenhuma conta variável encontrada no mês passado.</p>
        ) : (
          <>
            <ul className="list">
              {variaveisMesPassado.map((it) => (
                <li key={it.id} className="list-item">
                  <div style={{ flex: 1 }}>
                    <div className="muted">
                      <b>{it.nome}</b> — {formatBRL(it.valor || 0)}
                      {it.responsavel ? (
                        <span className="badge" style={{ marginLeft: 8 }}>
                          Resp: {it.responsavel}
                        </span>
                      ) : null}
                    </div>

                    {it.observacao ? (
                      <div className="muted small" style={{ marginTop: 4 }}>
                        {it.observacao}
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt">
              <div className="muted small">
                Total variáveis (mês passado): <b>{formatBRL(totalVariaveisMesPassado)}</b>
              </div>
            </div>
          </>
        )}
      </div>

      {/* modal Configurações */}
      {modal === "config" && (
        <Modal title="⚙️ Configurações" onClose={() => setModal(null)}>
          <div className="field">
            <label>Nome da casa</label>
            <input value={state.casaNome} onChange={(e) => setCasaNome(e.target.value)} placeholder="Ex.: República do Centro" />
          </div>

          <div className="filters-grid">
            <div className="field">
              <label>Nº de pessoas (1 a 5)</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" className="chip" style={{ width: "auto" }} onClick={() => incMoradores(-1)}>
                  −
                </button>

                <input type="number" min={1} max={5} value={Number(state.moradoresCount)} onChange={(e) => setMoradoresCount(e.target.value)} />

                <button type="button" className="chip" style={{ width: "auto" }} onClick={() => incMoradores(+1)}>
                  +
                </button>
              </div>
            </div>

            <div className="field">
              <label>Modo de divisão</label>
              <select value={state.modoDivisao} onChange={(e) => setModoDivisao(e.target.value)}>
                <option value="igual">Igual (divide por partes iguais)</option>
                <option value="percentual">Percentual (cada um paga uma %)</option>
              </select>

              {state.modoDivisao === "percentual" && (
                <div className="muted small" style={{ marginTop: 6 }}>
                  Soma digitada (o app normaliza): <b>{somaPercentuaisDigitados.toFixed(2)}%</b>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button type="button" className="toggle-btn" onClick={() => setModal(null)} style={{ width: "auto" }}>
              Fechar
            </button>
          </div>
        </Modal>
      )}

      {/* modal Pessoas */}
      {modal === "pessoas" && (
        <Modal title="👥 Pessoas" onClose={() => setModal(null)}>
          {moradores.map((m, idx) => (
            <div key={m.id} className="audio-card" style={{ padding: 12, marginBottom: 10 }}>
              <div className="filters-grid">
                <div className="field">
                  <label>Nome</label>
                  <input value={m.nome} onChange={(e) => setMoradorNome(idx, e.target.value)} placeholder={`Morador ${idx + 1}`} />
                </div>

                <div className="field">
                  <label>% (se percentual)</label>
                  <input
                    type="number"
                    step="0.01"
                    disabled={state.modoDivisao !== "percentual"}
                    value={Number(m.percentual || 0)}
                    onChange={(e) => setMoradorPercentual(idx, e.target.value)}
                  />
                </div>
              </div>

              <div className="muted small">
                Pagará: <b>{(percentuaisNormalizados[idx] || 0).toFixed(2)}%</b> → <b>{formatBRL(valorPorPessoa[idx] || 0)}</b>
              </div>
            </div>
          ))}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button type="button" className="toggle-btn" onClick={() => setModal(null)} style={{ width: "auto" }}>
              Fechar
            </button>
          </div>
        </Modal>
      )}

      {/* adicionar/editar gasto */}
      <div className="card mt">
        <h3 style={{ marginBottom: 8 }}>{editId ? "Editar gasto" : "Adicionar gasto (fixo ou variável)"}</h3>

        <div className="filters-grid">
          <div className="field">
            <label>Tipo</label>
            <select value={tipoGasto} onChange={(e) => setTipoGasto(e.target.value === "fixo" ? "fixo" : "variavel")} disabled={!!editId}>
              <option value="variavel">Variável (muda todo mês: água, luz…)</option>
              <option value="fixo">Fixo (repete todo mês: aluguel, condomínio…)</option>
            </select>
            <div className="muted small" style={{ marginTop: 6 }}>
              {tipoGasto === "fixo" ? "Fixo aparece em TODOS os meses." : `Variável fica SOMENTE no mês ${monthLabel(mesKey)}.`}
            </div>
          </div>

          <div className="field">
            <label>Sugestões</label>
            <select value={itemNome} onChange={(e) => setItemNome(e.target.value)}>
              <option value="">Selecione…</option>
              {SUGESTOES_GASTOS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label>Nome do gasto</label>
          <input value={itemNome} onChange={(e) => setItemNome(e.target.value)} placeholder="Ex.: Água" />
        </div>

        <div className="filters-grid">
          <div className="field">
            <label>Valor (R$)</label>
            <input value={itemValor} onChange={(e) => setItemValor(e.target.value)} placeholder="Ex.: 120,50" inputMode="decimal" />
          </div>

          <div className="field">
            <label>Vencimento (opcional)</label>
            <input type="date" value={itemVencimento} onChange={(e) => setItemVencimento(e.target.value)} />
          </div>
        </div>

        <div className="filters-grid">
          <div className="field">
            <label>Responsável</label>
            <input value={itemResponsavel} onChange={(e) => setItemResponsavel(e.target.value)} placeholder="Quem vai pagar / responsável" />
          </div>

          <div className="field">
            <label>Observação</label>
            <input value={itemObs} onChange={(e) => setItemObs(e.target.value)} placeholder="Ex.: veio mais alto esse mês" />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="primary-btn" style={{ width: "auto", padding: "10px 12px" }} onClick={upsertItem}>
            {editId ? "Salvar edição" : "Adicionar"}
          </button>

          {editId && (
            <button type="button" className="chip" style={{ width: "auto" }} onClick={resetForm}>
              Cancelar edição
            </button>
          )}

          <button type="button" className="chip" style={{ width: "auto", marginLeft: "auto" }} onClick={limparTudo}>
            Apagar tudo
          </button>
        </div>
      </div>

      {/* fixos */}
      <div className="card mt">
        <h3 style={{ marginBottom: 8 }}>Gastos FIXOS</h3>

        {fixos.length === 0 ? (
          <p className="muted small">Nenhum gasto fixo cadastrado ainda.</p>
        ) : (
          <ul className="list">
            {fixos.map((it) => (
              <li key={it.id} className="list-item">
                <div style={{ flex: 1 }}>
                  <div className="muted">
                    <b>{it.nome}</b> — {formatBRL(it.valor || 0)}
                    {it.responsavel ? (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        Resp: {it.responsavel}
                      </span>
                    ) : null}
                  </div>

                  {it.observacao ? (
                    <div className="muted small" style={{ marginTop: 4 }}>
                      {it.observacao}
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="chip" style={{ width: "auto" }} onClick={() => startEdit(it, "fixo")}>
                    Editar
                  </button>
                  <button type="button" className="chip" style={{ width: "auto" }} onClick={() => removeItem(it.id, "fixo")}>
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt">
          <div className="muted small">
            Total fixos: <b>{formatBRL(totalFixos)}</b>
          </div>
        </div>
      </div>

      {/* variáveis */}
      <div className="card mt">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h3 style={{ marginBottom: 0 }}>Gastos VARIÁVEIS — {monthLabel(mesKey)}</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="chip" style={{ width: "auto" }} onClick={copiarVariaveisMesAnterior}>
              Copiar mês anterior
            </button>
            <button type="button" className="chip" style={{ width: "auto" }} onClick={limparSomenteVariaveisDoMes}>
              Limpar variáveis do mês
            </button>
          </div>
        </div>

        {variaveisMes.length === 0 ? (
          <p className="muted small" style={{ marginTop: 10 }}>
            Nenhum gasto variável cadastrado para este mês ainda.
          </p>
        ) : (
          <ul className="list mt">
            {variaveisMes.map((it) => (
              <li key={it.id} className="list-item">
                <div style={{ flex: 1 }}>
                  <div className="muted">
                    <b>{it.nome}</b> — {formatBRL(it.valor || 0)}
                    {it.responsavel ? (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        Resp: {it.responsavel}
                      </span>
                    ) : null}
                  </div>

                  {it.observacao ? (
                    <div className="muted small" style={{ marginTop: 4 }}>
                      {it.observacao}
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="chip" style={{ width: "auto" }} onClick={() => startEdit(it, "variavel")}>
                    Editar
                  </button>
                  <button type="button" className="chip" style={{ width: "auto" }} onClick={() => removeItem(it.id, "variavel")}>
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt">
          <div className="muted small">
            Total variáveis ({monthLabel(mesKey)}): <b>{formatBRL(totalVariaveis)}</b>
          </div>
        </div>
      </div>

      {/* quanto cada um paga */}
      <div className="card mt">
        <h3 style={{ marginBottom: 8 }}>Quanto cada um paga (fixos + variáveis do mês)</h3>

        <ul className="list">
          {moradores.map((m, i) => (
            <li key={m.id} className="list-item">
              <div className="muted">
                <b>{m.nome || `Morador ${i + 1}`}</b> — {(percentuaisNormalizados[i] || 0).toFixed(2)}% →{" "}
                <span className="number">{formatBRL(valorPorPessoa[i] || 0)}</span>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt">
          <div className="muted small">
            Total geral: <b>{formatBRL(totalGeral)}</b> (Fixos: {formatBRL(totalFixos)} + Variáveis: {formatBRL(totalVariaveis)})
          </div>
        </div>
      </div>

      {/* PDF */}
      <div className="card mt">
        <h3 style={{ marginBottom: 8 }}>Gerar PDF</h3>

        <button type="button" className="primary-btn" onClick={gerarPDF}>
          📄 Gerar PDF com assinaturas
        </button>

        <div className="muted small" style={{ marginTop: 8 }}>
          O PDF sai com: <b>Fixos + Variáveis</b>, <b>Observações</b>, totais, quanto cada um paga e linhas de assinatura.
          <br />
          (Vencimento foi removido do PDF.)
        </div>
      </div>
    </div>
  );
}
