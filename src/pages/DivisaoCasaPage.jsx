// ✅ Arquivo: src/pages/DivisaoCasaPage.jsx
// ✅ Página: Divisão de Gastos da Casa (1 a 5 pessoas) + PDF + assinaturas
// ✅ Requer: npm i jspdf jspdf-autotable

import React, { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const LS_KEY = "pwa_divisao_casa_v1";

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

function monthNowYYYYMM() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabel(yyyy_mm) {
  const [y, m] = String(yyyy_mm || "").split("-");
  if (!y || !m) return "-";
  return `${m}/${y}`;
}

function fmtBRDate(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return "-";
  const [y, m, d] = String(yyyy_mm_dd).split("-");
  if (!y || !m || !d) return "-";
  return `${d}/${m}/${y}`;
}

function formatBRL(value) {
  const n = Number(value || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function normalizeName(s) {
  return String(s || "").trim();
}

export default function DivisaoCasaPage() {
  const [state, setState] = useState(() => ({
    casaNome: "Gastos da Casa",
    mesRef: monthNowYYYYMM(),
    modoDivisao: "igual", // "igual" | "percentual"
    moradoresCount: 2, // 1..5
    moradores: [
      { id: uuid(), nome: "Morador 1", percentual: 50 },
      { id: uuid(), nome: "Morador 2", percentual: 50 },
    ],
    itens: [],
  }));

  // form item
  const [itemNome, setItemNome] = useState("");
  const [itemValor, setItemValor] = useState("");
  const [itemVencimento, setItemVencimento] = useState("");
  const [itemResponsavel, setItemResponsavel] = useState("");
  const [itemObs, setItemObs] = useState("");

  // edição
  const [editId, setEditId] = useState(null);

  // PDF opts
  const [pdfIncluirObs, setPdfIncluirObs] = useState(true);
  const [pdfIncluirVenc, setPdfIncluirVenc] = useState(true);

  // load
  useEffect(() => {
    const raw = safeJSONParse(localStorage.getItem(LS_KEY), null);
    if (raw && typeof raw === "object") {
      setState((prev) => ({
        ...prev,
        ...raw,
        moradoresCount: clamp(raw?.moradoresCount ?? prev.moradoresCount, 1, 5),
        moradores: Array.isArray(raw?.moradores) ? raw.moradores : prev.moradores,
        itens: Array.isArray(raw?.itens) ? raw.itens : prev.itens,
      }));
    }
  }, []);

  function persist(next) {
    setState(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  }

  const moradores = useMemo(() => {
    const c = clamp(state.moradoresCount, 1, 5);

    let arr = Array.isArray(state.moradores) ? [...state.moradores] : [];
    arr = arr.map((m, idx) => ({
      id: m?.id || uuid(),
      nome: normalizeName(m?.nome) || `Morador ${idx + 1}`,
      percentual: Number(m?.percentual ?? 0),
    }));

    if (arr.length < c) {
      const start = arr.length;
      for (let i = start; i < c; i++) {
        arr.push({
          id: uuid(),
          nome: `Morador ${i + 1}`,
          percentual: c > 0 ? 100 / c : 0,
        });
      }
    }
    if (arr.length > c) arr = arr.slice(0, c);

    return arr;
  }, [state.moradores, state.moradoresCount]);

  const itens = useMemo(() => (Array.isArray(state.itens) ? state.itens : []), [state.itens]);

  const totalGeral = useMemo(() => {
    return itens.reduce((acc, it) => acc + Number(it?.valor || 0), 0);
  }, [itens]);

  const percentuaisNormalizados = useMemo(() => {
    if (state.modoDivisao === "igual") {
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
  }, [state.modoDivisao, moradores]);

  const somaPercentuaisDigitados = useMemo(() => {
    return moradores.reduce((acc, m) => acc + Number(m?.percentual || 0), 0);
  }, [moradores]);

  const valorPorPessoa = useMemo(() => {
    return moradores.map((_, idx) => (totalGeral * (percentuaisNormalizados[idx] || 0)) / 100);
  }, [moradores, totalGeral, percentuaisNormalizados]);

  function setCasaNome(v) {
    persist({ ...state, casaNome: String(v || "") });
  }

  function setMesRef(v) {
    persist({ ...state, mesRef: String(v || "") });
  }

  function setMoradoresCount(v) {
    const c = clamp(v, 1, 5);
    let nextMoradores = [...moradores];

    if (nextMoradores.length < c) {
      for (let i = nextMoradores.length; i < c; i++) {
        nextMoradores.push({
          id: uuid(),
          nome: `Morador ${i + 1}`,
          percentual: c > 0 ? 100 / c : 0,
        });
      }
    }
    if (nextMoradores.length > c) nextMoradores = nextMoradores.slice(0, c);

    if (state.modoDivisao === "igual") {
      const eq = c > 0 ? 100 / c : 0;
      nextMoradores = nextMoradores.map((m) => ({ ...m, percentual: eq }));
    }

    persist({ ...state, moradoresCount: c, moradores: nextMoradores });
  }

  function setModoDivisao(v) {
    const modo = v === "percentual" ? "percentual" : "igual";
    const c = moradores.length || 1;

    let nextMoradores = [...moradores];
    if (modo === "igual") {
      const eq = 100 / c;
      nextMoradores = nextMoradores.map((m) => ({ ...m, percentual: eq }));
    } else {
      const sum = nextMoradores.reduce((acc, m) => acc + Number(m.percentual || 0), 0);
      if (sum <= 0) {
        const eq = 100 / c;
        nextMoradores = nextMoradores.map((m) => ({ ...m, percentual: eq }));
      }
    }

    persist({ ...state, modoDivisao: modo, moradores: nextMoradores });
  }

  function setMoradorNome(idx, nome) {
    const next = [...moradores];
    next[idx] = { ...next[idx], nome: normalizeName(nome) };
    persist({ ...state, moradores: next });
  }

  function setMoradorPercentual(idx, p) {
    const next = [...moradores];
    const val = Number(String(p || "").replace(",", "."));
    next[idx] = { ...next[idx], percentual: Number.isFinite(val) ? val : 0 };
    persist({ ...state, moradores: next });
  }

  function resetForm() {
    setItemNome("");
    setItemValor("");
    setItemVencimento("");
    setItemResponsavel("");
    setItemObs("");
    setEditId(null);
  }

  function startEdit(it) {
    setEditId(it.id);
    setItemNome(it.nome || "");
    setItemValor(String(it.valor ?? ""));
    setItemVencimento(it.vencimento || "");
    setItemResponsavel(it.responsavel || "");
    setItemObs(it.observacao || "");
  }

  function removeItem(id) {
    const nextItens = itens.filter((it) => it.id !== id);
    persist({ ...state, itens: nextItens });
    if (editId === id) resetForm();
  }

  function upsertItem() {
    const nome = String(itemNome || "").trim();
    const valor = Number(String(itemValor || "").replace(",", "."));
    const venc = String(itemVencimento || "").trim();
    const resp = String(itemResponsavel || "").trim();
    const obs = String(itemObs || "").trim();

    if (!nome) {
      alert("Digite o nome do gasto (ex.: Água).");
      return;
    }
    if (!Number.isFinite(valor) || valor < 0) {
      alert("Digite um valor válido (ex.: 120.50).");
      return;
    }

    const payload = {
      id: editId || uuid(),
      nome,
      valor,
      vencimento: venc,
      responsavel: resp,
      observacao: obs,
    };

    const nextItens = editId
      ? itens.map((it) => (it.id === editId ? payload : it))
      : [...itens, payload];

    persist({ ...state, itens: nextItens });
    resetForm();
  }

  function limparTudo() {
    const ok = window.confirm("Tem certeza que deseja apagar todos os dados desta divisão?");
    if (!ok) return;

    persist({
      casaNome: "Gastos da Casa",
      mesRef: monthNowYYYYMM(),
      modoDivisao: "igual",
      moradoresCount: 2,
      moradores: [
        { id: uuid(), nome: "Morador 1", percentual: 50 },
        { id: uuid(), nome: "Morador 2", percentual: 50 },
      ],
      itens: [],
    });
    resetForm();
  }

  function gerarPDF() {
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const titulo = "DIVISÃO DE GASTOS DA CASA";
    const sub = `${state.casaNome || "Gastos da Casa"} — Mês: ${monthLabel(state.mesRef)}`;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(titulo, 40, 50);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(sub, 40, 70);

    const cols = [
      "Gasto",
      "Valor",
      ...(pdfIncluirVenc ? ["Venc."] : []),
      "Responsável",
      ...(pdfIncluirObs ? ["Obs."] : []),
    ];

    const body = itens.map((it) => {
      return [
        String(it.nome || "-"),
        formatBRL(it.valor || 0),
        ...(pdfIncluirVenc ? [it.vencimento ? fmtBRDate(it.vencimento) : "-"] : []),
        String(it.responsavel || "-"),
        ...(pdfIncluirObs ? [String(it.observacao || "-")] : []),
      ];
    });

    autoTable(doc, {
      startY: 90,
      head: [cols],
      body:
        body.length > 0
          ? body
          : [
              [
                "(Sem gastos cadastrados)",
                "",
                ...(pdfIncluirVenc ? [""] : []),
                "",
                ...(pdfIncluirObs ? [""] : []),
              ],
            ],
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: 4,
        overflow: "linebreak",
      },
      headStyles: { fontStyle: "bold" },
      margin: { left: 40, right: 40 },
    });

    let y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 20 : 120;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("RESUMO", 40, y);
    y += 16;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(`Total geral: ${formatBRL(totalGeral)}`, 40, y);
    y += 14;

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

    const fileName = `divisao_gastos_${(state.casaNome || "casa").replace(/\s+/g, "_")}_${state.mesRef}.pdf`;
    doc.save(fileName);
  }

  return (
    <div className="page">
      <h2 className="page-title">🏠 Divisão de Gastos da Casa</h2>

      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Configuração</h3>

        <div className="field">
          <label>Nome da casa</label>
          <input
            value={state.casaNome}
            onChange={(e) => setCasaNome(e.target.value)}
            placeholder="Ex.: República do Centro"
          />
        </div>

        <div className="filters-grid">
          <div className="field">
            <label>Mês de referência</label>
            <input type="month" value={state.mesRef} onChange={(e) => setMesRef(e.target.value)} />
          </div>

          <div className="field">
            <label>Nº de pessoas (1 a 5)</label>
            <input
              type="number"
              min={1}
              max={5}
              value={state.moradoresCount}
              onChange={(e) => setMoradoresCount(e.target.value)}
            />
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

      <div className="card mt">
        <h3 style={{ marginBottom: 8 }}>Pessoas</h3>

        {moradores.map((m, idx) => (
          <div key={m.id} className="audio-card" style={{ padding: 12, marginBottom: 10 }}>
            <div className="filters-grid">
              <div className="field">
                <label>Nome</label>
                <input
                  value={m.nome}
                  onChange={(e) => setMoradorNome(idx, e.target.value)}
                  placeholder={`Morador ${idx + 1}`}
                />
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
              Pagará: <b>{(percentuaisNormalizados[idx] || 0).toFixed(2)}%</b> →{" "}
              <b>{formatBRL(valorPorPessoa[idx] || 0)}</b>
            </div>
          </div>
        ))}
      </div>

      <div className="card mt">
        <h3 style={{ marginBottom: 8 }}>{editId ? "Editar gasto" : "Adicionar gasto fixo"}</h3>

        <div className="field">
          <label>Gasto</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select
              value={itemNome}
              onChange={(e) => setItemNome(e.target.value)}
              style={{ flex: 1, minWidth: 240 }}
            >
              <option value="">Selecione uma sugestão…</option>
              {SUGESTOES_GASTOS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <input
              value={itemNome}
              onChange={(e) => setItemNome(e.target.value)}
              placeholder="Ou digite (ex.: Água)"
              style={{ flex: 2, minWidth: 240 }}
            />
          </div>
        </div>

        <div className="filters-grid">
          <div className="field">
            <label>Valor (R$)</label>
            <input
              value={itemValor}
              onChange={(e) => setItemValor(e.target.value)}
              placeholder="Ex.: 120,50"
              inputMode="decimal"
            />
          </div>

          <div className="field">
            <label>Vencimento (opcional)</label>
            <input type="date" value={itemVencimento} onChange={(e) => setItemVencimento(e.target.value)} />
          </div>
        </div>

        <div className="filters-grid">
          <div className="field">
            <label>Responsável</label>
            <input
              value={itemResponsavel}
              onChange={(e) => setItemResponsavel(e.target.value)}
              placeholder="Quem vai pagar / responsável"
            />
          </div>

          <div className="field">
            <label>Observação (opcional)</label>
            <input
              value={itemObs}
              onChange={(e) => setItemObs(e.target.value)}
              placeholder="Ex.: veio mais alto esse mês"
            />
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

      <div className="card mt">
        <h3 style={{ marginBottom: 8 }}>Gastos cadastrados</h3>

        {itens.length === 0 ? (
          <p className="muted small">Nenhum gasto cadastrado ainda.</p>
        ) : (
          <ul className="list">
            {itens.map((it) => (
              <li key={it.id} className="list-item">
                <div style={{ flex: 1 }}>
                  <div className="muted">
                    <b>{it.nome}</b> — {formatBRL(it.valor || 0)}
                    {it.vencimento ? (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        Venc: {fmtBRDate(it.vencimento)}
                      </span>
                    ) : null}
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
                  <button type="button" className="chip" style={{ width: "auto" }} onClick={() => startEdit(it)}>
                    Editar
                  </button>
                  <button type="button" className="chip" style={{ width: "auto" }} onClick={() => removeItem(it.id)}>
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt">
          <div className="muted small">
            Total geral: <b>{formatBRL(totalGeral)}</b>
          </div>
        </div>
      </div>

      <div className="card mt">
        <h3 style={{ marginBottom: 8 }}>Quanto cada um paga</h3>

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
      </div>

      <div className="card mt">
        <h3 style={{ marginBottom: 8 }}>Gerar PDF</h3>

        <div className="field">
          <label>Opções do PDF</label>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={pdfIncluirVenc}
                onChange={(e) => setPdfIncluirVenc(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              <span className="muted small">Incluir vencimento</span>
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={pdfIncluirObs}
                onChange={(e) => setPdfIncluirObs(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              <span className="muted small">Incluir observações</span>
            </label>
          </div>
        </div>

        <button type="button" className="primary-btn" onClick={gerarPDF}>
          📄 Gerar PDF com assinaturas
        </button>

        <div className="muted small" style={{ marginTop: 8 }}>
          O PDF sai com: tabela de gastos, total, quanto cada um paga e linhas de assinatura.
        </div>
      </div>
    </div>
  );
}
