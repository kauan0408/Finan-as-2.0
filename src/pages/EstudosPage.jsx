// src/pages/EstudosPage.jsx
import React, { useMemo, useState } from "react";
import { useFinance } from "../App.jsx";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymdFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDurationToMinutes(s) {
  const raw = String(s || "").trim().toLowerCase();
  if (!raw) return 0;

  // exemplos aceitos:
  // "2h", "2 h", "1h30", "1h 30", "40min", "40 min", "1:30"
  // fallback: número puro = minutos

  // 1:30
  const mClock = raw.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (mClock) {
    const h = Number(mClock[1] || 0);
    const mm = Number(mClock[2] || 0);
    return h * 60 + mm;
  }

  let minutes = 0;

  const mh = raw.match(/(\d+)\s*h/);
  if (mh) minutes += Number(mh[1]) * 60;

  const mmin = raw.match(/(\d+)\s*min/);
  if (mmin) minutes += Number(mmin[1]);

  // "1h30" (sem "min")
  const mhm = raw.match(/(\d+)\s*h\s*(\d{1,2})\b/);
  if (mhm) {
    const extra = Number(mhm[2] || 0);
    // evita dobrar se já capturou min
    if (!mmin) minutes += extra;
  }

  if (minutes > 0) return minutes;

  // número puro = minutos
  if (/^\d+$/.test(raw)) return Number(raw);

  return 0;
}

// resolve "Dia 14" -> YYYY-MM-DD (mês atual; se já passou, joga pro próximo mês)
function resolveDayOfMonthToYMD(day) {
  const d = Number(day);
  if (!Number.isFinite(d) || d < 1 || d > 31) return null;

  const today = new Date();
  let y = today.getFullYear();
  let m = today.getMonth();

  // tenta no mês atual
  let last = new Date(y, m + 1, 0).getDate();
  let dd = Math.min(last, d);
  let candidate = new Date(y, m, dd);

  // se já passou (antes de hoje), usa próximo mês
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const c0 = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate());
  if (c0 < t0) {
    const next = new Date(y, m + 1, 1);
    y = next.getFullYear();
    m = next.getMonth();
    last = new Date(y, m + 1, 0).getDate();
    dd = Math.min(last, d);
    candidate = new Date(y, m, dd);
  }

  return ymdFromDate(candidate);
}

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/**
 * Parser do cronograma colado:
 * Aceita formatos como:
 *
 * Dia 14:
 * - Matemática: Função do 2º grau (2h)
 * - Física: Cinemática (1h30)
 * - Redação: Tema ENEM (1h)
 * - Revisão: Química orgânica (40min)
 *
 * Também aceita:
 * 2026-02-18:
 * - ...
 *
 * E linha com horário:
 * - 09:00 Matemática: Equações (60min)
 */
function parseCronogramaText(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let currentYMD = null;
  const items = [];

  for (const line of lines) {
    // cabeçalho "Dia 14" / "Dia 14:" / "DIA 14"
    const mDia = line.match(/^dia\s+(\d{1,2})\s*:?\s*$/i);
    if (mDia) {
      currentYMD = resolveDayOfMonthToYMD(mDia[1]);
      continue;
    }

    // cabeçalho "2026-02-18"
    const mYMD = line.match(/^(\d{4})-(\d{2})-(\d{2})\s*:?\s*$/);
    if (mYMD) {
      currentYMD = `${mYMD[1]}-${mYMD[2]}-${mYMD[3]}`;
      continue;
    }

    // itens: pode começar com "-" ou "•"
    const clean = line.replace(/^[-•]\s*/, "");

    // tenta pegar horário no começo
    let hora = null;
    let rest = clean;
    const mHora = clean.match(/^(\d{1,2}:\d{2})\s+(.*)$/);
    if (mHora) {
      hora = mHora[1];
      rest = mHora[2];
    }

    // detectar se é "Revisão:"
    let tipo = /revis[aã]o/i.test(rest) ? "revisao" : "conteudo";

    // padrões comuns:
    // "Matéria: Conteúdo (2h)"
    // "Revisão: Conteúdo (40min)" -> matéria vira "Revisão" (vamos normalizar)
    let materia = "";
    let conteudo = "";
    let minutos = 0;

    // tempo entre parênteses no final
    const mTime = rest.match(/\(([^)]+)\)\s*$/);
    if (mTime) {
      minutos = parseDurationToMinutes(mTime[1]);
      rest = rest.replace(/\(([^)]+)\)\s*$/, "").trim();
    } else {
      // tempo no final " - 2h" ou " 2h"
      const mTime2 = rest.match(/(?:-|—)?\s*(\d+\s*h(?:\s*\d{1,2})?|\d+\s*min|\d{1,2}:\d{2}|\d+)\s*$/i);
      if (mTime2) {
        minutos = parseDurationToMinutes(mTime2[1]);
        rest = rest.replace(mTime2[0], "").trim();
      }
    }

    // split matéria/conteúdo
    // "Matéria: Conteúdo"
    const mSplit = rest.match(/^([^:]+)\s*:\s*(.+)$/);
    if (mSplit) {
      materia = String(mSplit[1]).trim();
      conteudo = String(mSplit[2]).trim();
    } else {
      // "Matéria - Conteúdo"
      const mSplit2 = rest.match(/^([^-–—]+)\s*[-–—]\s*(.+)$/);
      if (mSplit2) {
        materia = String(mSplit2[1]).trim();
        conteudo = String(mSplit2[2]).trim();
      } else {
        // fallback: vira conteúdo geral
        materia = "Estudos";
        conteudo = rest.trim();
      }
    }

    // normaliza "Revisão" como tipo e tenta matéria real dentro do conteúdo
    if (/^revis[aã]o$/i.test(materia)) {
      tipo = "revisao";
      // tenta puxar matéria do começo do conteúdo "Química - orgânica"
      const mMat = conteudo.match(/^([A-Za-zÀ-ÿ0-9 ]+)\s*[:\-–—]\s*(.+)$/);
      if (mMat) {
        materia = mMat[1].trim();
        conteudo = mMat[2].trim();
      } else {
        // se não der, mantém "Revisão"
        materia = "Revisão";
      }
    }

    items.push({
      id: makeId(),
      ymd: currentYMD || ymdFromDate(new Date()),
      hora: hora || "",
      materia,
      conteudo,
      minutos: Number(minutos || 0),
      tipo, // "revisao" | "conteudo"
      status: "pendente", // "pendente" | "feito"
      createdAtISO: new Date().toISOString(),
      doneAtISO: "",
    });
  }

  return items;
}

function formatMinutes(min) {
  const m = Number(min || 0);
  if (!m) return "—";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${mm} min`;
  if (mm === 0) return `${h}h`;
  return `${h}h${pad2(mm)}`;
}

export default function EstudosPage() {
  const { estudos, setEstudos } = useFinance();

  const [texto, setTexto] = useState("");
  const [filtroDia, setFiltroDia] = useState(() => ymdFromDate(new Date()));
  const [busca, setBusca] = useState("");

  const listaDoDia = useMemo(() => {
    const q = String(busca || "").trim().toLowerCase();
    return (estudos || [])
      .filter((it) => it.ymd === filtroDia)
      .filter((it) => {
        if (!q) return true;
        const blob = `${it.materia} ${it.conteudo}`.toLowerCase();
        return blob.includes(q);
      })
      .sort((a, b) => {
        // hora primeiro (se tiver), depois criação
        const ah = a.hora || "99:99";
        const bh = b.hora || "99:99";
        if (ah < bh) return -1;
        if (ah > bh) return 1;
        return String(a.createdAtISO).localeCompare(String(b.createdAtISO));
      });
  }, [estudos, filtroDia, busca]);

  const resumoDia = useMemo(() => {
    const items = (estudos || []).filter((it) => it.ymd === filtroDia);
    const total = items.reduce((acc, it) => acc + Number(it.minutos || 0), 0);
    const feitos = items.filter((it) => it.status === "feito").length;
    const pend = items.filter((it) => it.status !== "feito").length;
    return { total, feitos, pend, qtd: items.length };
  }, [estudos, filtroDia]);

  function adicionarPorTexto() {
    const parsed = parseCronogramaText(texto);
    if (!parsed.length) {
      alert("Não encontrei itens no texto. Cole no formato: Dia 14: - Matemática: ... (2h)");
      return;
    }
    setEstudos((prev) => [...parsed, ...(prev || [])]);
    setTexto("");
    // após colar, joga o filtro para o primeiro dia encontrado
    const first = parsed[0]?.ymd;
    if (first) setFiltroDia(first);
  }

  function marcarFeito(id) {
    setEstudos((prev) =>
      (prev || []).map((it) =>
        it.id === id
          ? { ...it, status: "feito", doneAtISO: new Date().toISOString() }
          : it
      )
    );
  }

  function desfazerFeito(id) {
    setEstudos((prev) =>
      (prev || []).map((it) =>
        it.id === id ? { ...it, status: "pendente", doneAtISO: "" } : it
      )
    );
  }

  function removerItem(id) {
    if (!confirm("Remover este item?")) return;
    setEstudos((prev) => (prev || []).filter((it) => it.id !== id));
  }

  function limparDia() {
    if (!confirm(`Apagar TODOS os itens de ${filtroDia}?`)) return;
    setEstudos((prev) => (prev || []).filter((it) => it.ymd !== filtroDia));
  }

  return (
    <div className="card">
      <h2 className="page-title">📚 Estudos</h2>
      <p className="muted small" style={{ marginTop: 6 }}>
        Cole aqui o cronograma que você pegar comigo e o app transforma em tarefas automaticamente.
      </p>

      {/* filtro do dia */}
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label className="muted small">Dia:</label>
          <input
            type="date"
            value={filtroDia}
            onChange={(e) => setFiltroDia(e.target.value)}
            className="input"
            style={{ maxWidth: 180 }}
          />

          <input
            type="text"
            placeholder="Buscar (matéria ou conteúdo)..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="input"
            style={{ flex: 1, minWidth: 200 }}
          />

          <button type="button" className="toggle-btn" onClick={limparDia} style={{ width: "auto" }}>
            🧹 Limpar dia
          </button>
        </div>

        {/* resumo */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div><b>Total:</b> {formatMinutes(resumoDia.total)}</div>
            <div><b>Pendentes:</b> {resumoDia.pend}</div>
            <div><b>Feitos:</b> {resumoDia.feitos}</div>
            <div><b>Itens:</b> {resumoDia.qtd}</div>
          </div>
        </div>

        {/* colar cronograma */}
        <div className="card" style={{ padding: 12 }}>
          <h3 style={{ margin: 0 }}>📥 Colar cronograma</h3>
          <p className="muted small" style={{ marginTop: 6 }}>
            Exemplos:
            <br />
            <span className="muted small">
              Dia 14: <br />- Matemática: Função do 2º grau (2h) <br />- Revisão: Química - orgânica (40min)
            </span>
          </p>

          <textarea
            className="input"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={7}
            placeholder={`Cole aqui seu cronograma...`}
            style={{ width: "100%", resize: "vertical" }}
          />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button type="button" className="toggle-btn" onClick={() => setTexto("")} style={{ width: "auto" }}>
              Limpar texto
            </button>
            <button type="button" className="primary-btn" onClick={adicionarPorTexto} style={{ width: "auto" }}>
              ➕ Importar cronograma
            </button>
          </div>
        </div>

        {/* lista do dia */}
        <div className="card" style={{ padding: 12 }}>
          <h3 style={{ margin: 0 }}>✅ Tarefas do dia</h3>

          {listaDoDia.length === 0 ? (
            <p className="muted small" style={{ marginTop: 10 }}>
              Nada programado para este dia.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {listaDoDia.map((it) => {
                const feito = it.status === "feito";
                return (
                  <div
                    key={it.id}
                    className="card"
                    style={{
                      padding: 12,
                      opacity: feito ? 0.7 : 1,
                      borderLeft: it.tipo === "revisao" ? "4px solid rgba(255,255,255,0.25)" : "4px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 240 }}>
                        <div style={{ fontWeight: 700 }}>
                          {it.hora ? `🕘 ${it.hora} — ` : ""}
                          {it.materia} {it.tipo === "revisao" ? "🔁" : ""}
                        </div>
                        <div className="muted small" style={{ marginTop: 4 }}>
                          {it.conteudo}
                        </div>
                        <div className="muted small" style={{ marginTop: 6 }}>
                          ⏱ {formatMinutes(it.minutos)} • 📅 {it.ymd}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        {!feito ? (
                          <button type="button" className="primary-btn" onClick={() => marcarFeito(it.id)} style={{ width: "auto" }}>
                            ✅ Feito
                          </button>
                        ) : (
                          <button type="button" className="toggle-btn" onClick={() => desfazerFeito(it.id)} style={{ width: "auto" }}>
                            ↩️ Desfazer
                          </button>
                        )}

                        <button type="button" className="toggle-btn" onClick={() => removerItem(it.id)} style={{ width: "auto" }}>
                          🗑 Remover
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
