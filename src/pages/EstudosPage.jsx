// src/pages/EstudosPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useFinance } from "../App.jsx";

/* -------------------- helpers -------------------- */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymdFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
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

function parseDurationToMinutes(s) {
  const raw = String(s || "").trim().toLowerCase();
  if (!raw) return 0;

  // "1:30"
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

  // "1h30" sem "min"
  const mhm = raw.match(/(\d+)\s*h\s*(\d{1,2})\b/);
  if (mhm && !mmin) minutes += Number(mhm[2] || 0);

  if (minutes > 0) return minutes;

  // número puro = minutos
  if (/^\d+$/.test(raw)) return Number(raw);

  return 0;
}

/**
 * Cronograma “de ano” precisa de data.
 * Suporta cabeçalhos:
 * - 2026-02-18:
 * - 02/2026:  (define mês base; depois "Dia 14:" usa esse mês/ano)
 * - Mês 02/2026:
 * - Dia 14:
 *
 * Itens:
 * - 09:00 Matemática: ... (60min)
 * - Matemática: ... (2h)
 * - Revisão: Física - Newton (30min)
 */
function parseCronogramaText(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let currentYMD = null;
  let baseYear = null;
  let baseMonth0 = null; // 0-11

  const items = [];

  const today = new Date();
  const todayYMD = ymdFromDate(today);

  const resolveDayOfMonth = (day) => {
    const d = Number(day);
    if (!Number.isFinite(d) || d < 1 || d > 31) return null;

    // se tiver base mês/ano, usa ela
    if (Number.isFinite(baseYear) && Number.isFinite(baseMonth0)) {
      const last = new Date(baseYear, baseMonth0 + 1, 0).getDate();
      const dd = Math.min(last, d);
      return `${baseYear}-${pad2(baseMonth0 + 1)}-${pad2(dd)}`;
    }

    // fallback: mês atual; se já passou, joga para próximo mês
    let y = today.getFullYear();
    let m = today.getMonth();
    let last = new Date(y, m + 1, 0).getDate();
    let dd = Math.min(last, d);
    let candidate = new Date(y, m, dd);

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
  };

  for (const line of lines) {
    // base "02/2026" ou "2/2026"
    const mMY = line.match(/^(\d{1,2})\/(\d{4})\s*:?\s*$/);
    if (mMY) {
      const mm = Number(mMY[1]);
      const yy = Number(mMY[2]);
      if (mm >= 1 && mm <= 12 && yy >= 1900) {
        baseYear = yy;
        baseMonth0 = mm - 1;
        currentYMD = null;
      }
      continue;
    }

    // "Mês 02/2026"
    const mMes = line.match(/^m[eê]s\s+(\d{1,2})\/(\d{4})\s*:?\s*$/i);
    if (mMes) {
      const mm = Number(mMes[1]);
      const yy = Number(mMes[2]);
      if (mm >= 1 && mm <= 12 && yy >= 1900) {
        baseYear = yy;
        baseMonth0 = mm - 1;
        currentYMD = null;
      }
      continue;
    }

    // cabeçalho "2026-02-18"
    const mYMD = line.match(/^(\d{4})-(\d{2})-(\d{2})\s*:?\s*$/);
    if (mYMD) {
      currentYMD = `${mYMD[1]}-${mYMD[2]}-${mYMD[3]}`;
      // também seta base mês/ano automaticamente (ajuda quando usa "Dia X" depois)
      baseYear = Number(mYMD[1]);
      baseMonth0 = Number(mYMD[2]) - 1;
      continue;
    }

    // cabeçalho "Dia 14"
    const mDia = line.match(/^dia\s+(\d{1,2})\s*:?\s*$/i);
    if (mDia) {
      currentYMD = resolveDayOfMonth(mDia[1]) || todayYMD;
      continue;
    }

    // itens: pode começar com "-" ou "•"
    const clean = line.replace(/^[-•]\s*/, "");

    // hora no começo
    let hora = "";
    let rest = clean;
    const mHora = clean.match(/^(\d{1,2}:\d{2})\s+(.*)$/);
    if (mHora) {
      hora = mHora[1];
      rest = mHora[2];
    }

    let tipo = /revis[aã]o/i.test(rest) ? "revisao" : "conteudo";

    // tempo entre parênteses no final
    let minutos = 0;
    const mTime = rest.match(/\(([^)]+)\)\s*$/);
    if (mTime) {
      minutos = parseDurationToMinutes(mTime[1]);
      rest = rest.replace(/\(([^)]+)\)\s*$/, "").trim();
    } else {
      const mTime2 = rest.match(/(?:-|—)?\s*(\d+\s*h(?:\s*\d{1,2})?|\d+\s*min|\d{1,2}:\d{2}|\d+)\s*$/i);
      if (mTime2) {
        minutos = parseDurationToMinutes(mTime2[1]);
        rest = rest.replace(mTime2[0], "").trim();
      }
    }

    // split matéria/conteúdo
    let materia = "";
    let conteudo = "";

    const mSplit = rest.match(/^([^:]+)\s*:\s*(.+)$/);
    if (mSplit) {
      materia = String(mSplit[1]).trim();
      conteudo = String(mSplit[2]).trim();
    } else {
      const mSplit2 = rest.match(/^([^-–—]+)\s*[-–—]\s*(.+)$/);
      if (mSplit2) {
        materia = String(mSplit2[1]).trim();
        conteudo = String(mSplit2[2]).trim();
      } else {
        materia = "Estudos";
        conteudo = rest.trim();
      }
    }

    // normaliza "Revisão:" como tipo e tenta matéria real dentro do conteúdo
    if (/^revis[aã]o$/i.test(materia)) {
      tipo = "revisao";
      const mMat = conteudo.match(/^([A-Za-zÀ-ÿ0-9 ]+)\s*[:\-–—]\s*(.+)$/);
      if (mMat) {
        materia = mMat[1].trim();
        conteudo = mMat[2].trim();
      } else {
        materia = "Revisão";
      }
    }

    items.push({
      id: makeId(),
      ymd: currentYMD || todayYMD,
      hora,
      materia,
      conteudo,
      minutos: Number(minutos || 0),
      tipo, // revisao|conteudo
      status: "pendente", // pendente|feito
      createdAtISO: new Date().toISOString(),
      doneAtISO: "",
      nota: "", // anotação por tarefa (opcional)
    });
  }

  return items;
}

/* -------------------- toast -------------------- */

function Toast({ text, onClose }) {
  if (!text) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 9999,
        padding: "10px 12px",
        borderRadius: 12,
        background: "rgba(0,0,0,0.75)",
        color: "#fff",
        fontSize: 14,
        maxWidth: 320,
        boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
      }}
      onClick={onClose}
      role="status"
      aria-live="polite"
      title="Clique para fechar"
    >
      {text}
    </div>
  );
}

/* -------------------- pie (sem libs) -------------------- */

function PieChart({ data }) {
  // data: [{label, value}]
  const total = data.reduce((acc, d) => acc + Number(d.value || 0), 0);
  if (!total) {
    return <p className="muted small" style={{ marginTop: 10 }}>Sem dados suficientes para o gráfico.</p>;
  }

  // gera conic-gradient com cores estáveis
  const colors = [
    "#4f8cff", "#9b6bff", "#ff7aa2", "#ffb86b", "#63d297",
    "#39c6d6", "#ffd36b", "#b9c0ff", "#ff6b6b", "#6bffb2"
  ];

  let acc = 0;
  const stops = data.map((d, i) => {
    const v = Number(d.value || 0);
    const start = (acc / total) * 360;
    acc += v;
    const end = (acc / total) * 360;
    const color = colors[i % colors.length];
    return `${color} ${start}deg ${end}deg`;
  });

  const bg = `conic-gradient(${stops.join(",")})`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, alignItems: "center", marginTop: 10 }}>
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: "50%",
          background: bg,
          boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        }}
        aria-label="Gráfico de pizza"
        title="Gráfico de pizza"
      />
      <div style={{ display: "grid", gap: 6 }}>
        {data.map((d, i) => {
          const color = colors[i % colors.length];
          const pct = Math.round((Number(d.value || 0) / total) * 100);
          return (
            <div key={d.label} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: "inline-block" }} />
                <span style={{ fontSize: 14 }}>{d.label}</span>
              </div>
              <span className="muted small">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------- page -------------------- */

export default function EstudosPage() {
  const { estudos, setEstudos } = useFinance();

  // estado em 2 partes: tarefas + materias
  const tarefas = estudos?.tarefas || [];
  const materias = estudos?.materias || [];

  const hojeYMD = useMemo(() => ymdFromDate(new Date()), []);

  // modais
  const [menuAberto, setMenuAberto] = useState(false);
  const [modalHoje, setModalHoje] = useState(false);
  const [modalColar, setModalColar] = useState(false);
  const [modalAnalises, setModalAnalises] = useState(false);

  const [modalLimpar, setModalLimpar] = useState(false);
  const [limparTipo, setLimparTipo] = useState("dia"); // dia|tudo

  const [toast, setToast] = useState("");

  const [textoCronograma, setTextoCronograma] = useState("");
  const [diaSelecionado, setDiaSelecionado] = useState(hojeYMD);
  const [busca, setBusca] = useState("");

  // editor de matéria (observação + auto-avaliação)
  const [materiaSelecionada, setMateriaSelecionada] = useState("");
  const [notaMateria, setNotaMateria] = useState("");
  const [nivelMateria, setNivelMateria] = useState("medio"); // bom|medio|ruim

  // toast auto-fecha 3s
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  const setTarefas = (updater) => {
    setEstudos((prev) => {
      const base = prev && typeof prev === "object" ? prev : { tarefas: [], materias: [] };
      const nextTarefas = typeof updater === "function" ? updater(base.tarefas || []) : updater;
      return { ...base, tarefas: nextTarefas };
    });
  };

  const setMaterias = (updater) => {
    setEstudos((prev) => {
      const base = prev && typeof prev === "object" ? prev : { tarefas: [], materias: [] };
      const nextMaterias = typeof updater === "function" ? updater(base.materias || []) : updater;
      return { ...base, materias: nextMaterias };
    });
  };

  const tarefasDoDiaSelecionado = useMemo(() => {
    const q = String(busca || "").trim().toLowerCase();
    return (tarefas || [])
      .filter((t) => t.ymd === diaSelecionado)
      .filter((t) => {
        if (!q) return true;
        const blob = `${t.materia} ${t.conteudo} ${t.nota || ""}`.toLowerCase();
        return blob.includes(q);
      })
      .sort((a, b) => {
        const ah = a.hora || "99:99";
        const bh = b.hora || "99:99";
        if (ah < bh) return -1;
        if (ah > bh) return 1;
        return String(a.createdAtISO).localeCompare(String(b.createdAtISO));
      });
  }, [tarefas, diaSelecionado, busca]);

  const tarefasHoje = useMemo(() => {
    return (tarefas || [])
      .filter((t) => t.ymd === hojeYMD)
      .sort((a, b) => (a.hora || "99:99").localeCompare(b.hora || "99:99"));
  }, [tarefas, hojeYMD]);

  const resumoHoje = useMemo(() => {
    const itens = tarefasHoje;
    const pend = itens.filter((t) => t.status !== "feito").length;
    const feitos = itens.filter((t) => t.status === "feito").length;
    const totalMin = itens.reduce((acc, t) => acc + Number(t.minutos || 0), 0);
    return { pend, feitos, totalMin, qtd: itens.length };
  }, [tarefasHoje]);

  function abrirModal(tipo) {
    setMenuAberto(false);
    if (tipo === "hoje") setModalHoje(true);
    if (tipo === "colar") setModalColar(true);
    if (tipo === "analises") setModalAnalises(true);
  }

  function importarCronograma() {
    const parsed = parseCronogramaText(textoCronograma);

    if (!parsed.length) {
      setToast("Não consegui ler. Use: 2026-02-18: e itens com (2h) ou (40min).");
      return;
    }

    setTarefas((prev) => [...parsed, ...(prev || [])]);
    setTextoCronograma("");
    setToast(`Importado: ${parsed.length} item(ns).`);

    // vai pro primeiro dia do texto (pra você ver que entrou)
    if (parsed[0]?.ymd) setDiaSelecionado(parsed[0].ymd);
  }

  function marcarFeito(id) {
    setTarefas((prev) =>
      (prev || []).map((t) =>
        t.id === id ? { ...t, status: "feito", doneAtISO: new Date().toISOString() } : t
      )
    );
    setToast("Marcado como feito.");
  }

  function desfazerFeito(id) {
    setTarefas((prev) =>
      (prev || []).map((t) => (t.id === id ? { ...t, status: "pendente", doneAtISO: "" } : t))
    );
    setToast("Desfeito.");
  }

  function removerTarefa(id) {
    setTarefas((prev) => (prev || []).filter((t) => t.id !== id));
    setToast("Removido.");
  }

  function abrirLimpar(tipo) {
    setLimparTipo(tipo); // "dia" | "tudo"
    setModalLimpar(true);
  }

  function executarLimpeza() {
    setModalLimpar(false);

    if (limparTipo === "dia") {
      setTarefas((prev) => (prev || []).filter((t) => t.ymd !== diaSelecionado));
      setToast(`Dia ${diaSelecionado} limpo.`);
      return;
    }

    // limpar tudo
    setEstudos({ tarefas: [], materias: [] });
    setToast("Tudo foi limpo.");
  }

  function salvarNotaTarefa(id, nota) {
    setTarefas((prev) =>
      (prev || []).map((t) => (t.id === id ? { ...t, nota: String(nota || "") } : t))
    );
  }

  // matérias únicas
  const materiasDetectadas = useMemo(() => {
    const set = new Set();
    (tarefas || []).forEach((t) => {
      const m = String(t.materia || "").trim();
      if (m) set.add(m);
    });
    // junta com as matérias já registradas manualmente
    (materias || []).forEach((m) => {
      const nome = String(m.nome || "").trim();
      if (nome) set.add(nome);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tarefas, materias]);

  // análises: pizza por matéria (só FEITO)
  const pizzaData = useMemo(() => {
    const map = new Map();
    (tarefas || [])
      .filter((t) => t.status === "feito")
      .forEach((t) => {
        const key = String(t.materia || "Outros").trim() || "Outros";
        map.set(key, (map.get(key) || 0) + Number(t.minutos || 0));
      });
    const arr = Array.from(map.entries()).map(([label, value]) => ({ label, value }));
    arr.sort((a, b) => b.value - a.value);
    return arr.slice(0, 10); // top 10
  }, [tarefas]);

  // “bom/ruim”
  const materiasResumo = useMemo(() => {
    const byName = new Map((materias || []).map((m) => [m.nome, m]));
    return materiasDetectadas.map((nome) => {
      const m = byName.get(nome);
      return {
        nome,
        nivel: m?.nivel || "medio",
        obs: m?.obs || "",
      };
    });
  }, [materias, materiasDetectadas]);

  function carregarMateriaParaEditar(nome) {
    const found = (materias || []).find((m) => m.nome === nome);
    setMateriaSelecionada(nome);
    setNotaMateria(found?.obs || "");
    setNivelMateria(found?.nivel || "medio");
  }

  function salvarMateria() {
    const nome = String(materiaSelecionada || "").trim();
    if (!nome) {
      setToast("Escolha uma matéria.");
      return;
    }

    setMaterias((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const idx = list.findIndex((m) => m.nome === nome);

      const novo = { nome, nivel: nivelMateria, obs: notaMateria };

      if (idx >= 0) {
        const next = [...list];
        next[idx] = { ...next[idx], ...novo };
        return next;
      }
      return [...list, novo];
    });

    setToast("Matéria salva.");
  }

  return (
    <div className="card">
      <Toast text={toast} onClose={() => setToast("")} />

      <h2 className="page-title">📚 Estudos</h2>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <div className="card" style={{ padding: 12, flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 700 }}>Hoje ({hojeYMD})</div>
          <div className="muted small" style={{ marginTop: 6 }}>
            Pendentes: <b>{resumoHoje.pend}</b> • Feitos: <b>{resumoHoje.feitos}</b> • Total: <b>{formatMinutes(resumoHoje.totalMin)}</b>
          </div>
        </div>

        <button
          type="button"
          className="primary-btn"
          onClick={() => setMenuAberto(true)}
          style={{ width: "auto", height: 46, alignSelf: "stretch" }}
        >
          ☰ Abrir
        </button>
      </div>

      {/* dia selecionado */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <label className="muted small">Dia:</label>
        <input
          type="date"
          value={diaSelecionado}
          onChange={(e) => setDiaSelecionado(e.target.value)}
          className="input"
          style={{ maxWidth: 180 }}
        />

        <input
          type="text"
          className="input"
          placeholder="Buscar (matéria, conteúdo, nota)..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />

        <button type="button" className="toggle-btn" onClick={() => abrirLimpar("dia")} style={{ width: "auto" }}>
          🧹 Limpar dia
        </button>

        <button type="button" className="toggle-btn" onClick={() => abrirLimpar("tudo")} style={{ width: "auto" }}>
          🗑 Limpar tudo
        </button>
      </div>

      {/* tarefas do dia selecionado */}
      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <h3 style={{ margin: 0 }}>✅ Tarefas do dia</h3>

        {tarefasDoDiaSelecionado.length === 0 ? (
          <p className="muted small" style={{ marginTop: 10 }}>Nada para este dia.</p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {tarefasDoDiaSelecionado.map((t) => {
              const feito = t.status === "feito";
              return (
                <div key={t.id} className="card" style={{ padding: 12, opacity: feito ? 0.75 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 240, flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>
                        {t.hora ? `🕘 ${t.hora} — ` : ""}
                        {t.materia} {t.tipo === "revisao" ? "🔁" : ""}
                      </div>
                      <div className="muted small" style={{ marginTop: 4 }}>
                        {t.conteudo}
                      </div>
                      <div className="muted small" style={{ marginTop: 6 }}>
                        ⏱ {formatMinutes(t.minutos)} • 📅 {t.ymd}
                      </div>

                      {/* nota (por tarefa) */}
                      <div style={{ marginTop: 10 }}>
                        <label className="muted small">Observação desta tarefa</label>
                        <input
                          className="input"
                          value={t.nota || ""}
                          onChange={(e) => salvarNotaTarefa(t.id, e.target.value)}
                          placeholder='Ex: "tô fraco nisso, revisar de novo"'
                        />
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {!feito ? (
                        <button type="button" className="primary-btn" onClick={() => marcarFeito(t.id)} style={{ width: "auto" }}>
                          ✅ Feito
                        </button>
                      ) : (
                        <button type="button" className="toggle-btn" onClick={() => desfazerFeito(t.id)} style={{ width: "auto" }}>
                          ↩️ Desfazer
                        </button>
                      )}

                      <button type="button" className="toggle-btn" onClick={() => removerTarefa(t.id)} style={{ width: "auto" }}>
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

      {/* -------------------- MODAL MENU (3 botões) -------------------- */}
      {menuAberto && (
        <div className="modal-overlay" onClick={() => setMenuAberto(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>📌 Estudos</h3>
            <p className="muted small" style={{ marginTop: 6 }}>
              Escolha o que você quer abrir.
            </p>

            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <button type="button" className="primary-btn" onClick={() => abrirModal("hoje")} style={{ width: "100%" }}>
                📅 Ver o que fazer HOJE
              </button>

              <button type="button" className="primary-btn" onClick={() => abrirModal("colar")} style={{ width: "100%" }}>
                📥 Colar cronograma (até 1 ano)
              </button>

              <button type="button" className="primary-btn" onClick={() => abrirModal("analises")} style={{ width: "100%" }}>
                📊 Análises (pizza + bom/ruim + notas)
              </button>

              <button type="button" className="toggle-btn" onClick={() => setMenuAberto(false)} style={{ width: "100%" }}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- MODAL HOJE -------------------- */}
      {modalHoje && (
        <div className="modal-overlay" onClick={() => setModalHoje(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>📅 Hoje ({hojeYMD})</h3>

            {tarefasHoje.length === 0 ? (
              <p className="muted small" style={{ marginTop: 10 }}>Sem tarefas para hoje.</p>
            ) : (
              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {tarefasHoje.map((t) => (
                  <div key={t.id} className="card" style={{ padding: 10, opacity: t.status === "feito" ? 0.7 : 1 }}>
                    <div style={{ fontWeight: 700 }}>
                      {t.hora ? `🕘 ${t.hora} — ` : ""}{t.materia} {t.tipo === "revisao" ? "🔁" : ""}
                    </div>
                    <div className="muted small" style={{ marginTop: 4 }}>{t.conteudo}</div>
                    <div className="muted small" style={{ marginTop: 6 }}>⏱ {formatMinutes(t.minutos)}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="toggle-btn" onClick={() => setModalHoje(false)} style={{ width: "auto" }}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- MODAL COLAR -------------------- */}
      {modalColar && (
        <div className="modal-overlay" onClick={() => setModalColar(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>📥 Colar cronograma</h3>
            <p className="muted small" style={{ marginTop: 6 }}>
              Para cronograma de ano, use datas:
              <br />
              <span className="muted small">
                2026-02-18:
                <br />- 09:00 Matemática: Equações (60min)
                <br />- Revisão: Física - Newton (30min)
              </span>
              <br />
              Também pode usar base:
              <br />
              <span className="muted small">
                02/2026:
                <br />Dia 14:
                <br />- Matemática: Função (2h)
              </span>
            </p>

            <textarea
              className="input"
              value={textoCronograma}
              onChange={(e) => setTextoCronograma(e.target.value)}
              rows={10}
              placeholder="Cole aqui..."
              style={{ width: "100%", resize: "vertical" }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" className="toggle-btn" onClick={() => setTextoCronograma("")} style={{ width: "auto" }}>
                Limpar texto
              </button>
              <button type="button" className="primary-btn" onClick={importarCronograma} style={{ width: "auto" }}>
                ➕ Importar
              </button>
              <button type="button" className="toggle-btn" onClick={() => setModalColar(false)} style={{ width: "auto" }}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- MODAL ANÁLISES -------------------- */}
      {modalAnalises && (
        <div className="modal-overlay" onClick={() => setModalAnalises(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>📊 Análises</h3>

            <div className="card" style={{ padding: 12, marginTop: 10 }}>
              <div style={{ fontWeight: 700 }}>Gráfico (tempo estudado — tarefas FEITAS)</div>
              <PieChart data={pizzaData} />
            </div>

            <div className="card" style={{ padding: 12, marginTop: 10 }}>
              <div style={{ fontWeight: 700 }}>Autoavaliação por matéria</div>
              <p className="muted small" style={{ marginTop: 6 }}>
                Aqui você marca se está “bom/ruim” e escreve observações.
              </p>

              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                <label className="muted small">Escolha uma matéria</label>
                <select
                  className="input"
                  value={materiaSelecionada}
                  onChange={(e) => {
                    const nome = e.target.value;
                    carregarMateriaParaEditar(nome);
                  }}
                >
                  <option value="">— selecionar —</option>
                  {materiasDetectadas.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>

                <label className="muted small">Como você se sente nessa matéria?</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={nivelMateria === "bom" ? "primary-btn" : "toggle-btn"}
                    style={{ width: "auto" }}
                    onClick={() => setNivelMateria("bom")}
                  >
                    ✅ Bom
                  </button>
                  <button
                    type="button"
                    className={nivelMateria === "medio" ? "primary-btn" : "toggle-btn"}
                    style={{ width: "auto" }}
                    onClick={() => setNivelMateria("medio")}
                  >
                    ➖ Médio
                  </button>
                  <button
                    type="button"
                    className={nivelMateria === "ruim" ? "primary-btn" : "toggle-btn"}
                    style={{ width: "auto" }}
                    onClick={() => setNivelMateria("ruim")}
                  >
                    ⚠️ Ruim
                  </button>
                </div>

                <label className="muted small">Observações</label>
                <textarea
                  className="input"
                  rows={4}
                  value={notaMateria}
                  onChange={(e) => setNotaMateria(e.target.value)}
                  placeholder='Ex: "tô fraco em funções, preciso revisar exercícios"'
                  style={{ width: "100%", resize: "vertical" }}
                />

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="primary-btn" onClick={salvarMateria} style={{ width: "auto" }}>
                    💾 Salvar matéria
                  </button>
                </div>

                {/* resumo (lista rápida) */}
                <div style={{ marginTop: 6 }}>
                  <div className="muted small" style={{ marginBottom: 6 }}>Resumo:</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {materiasResumo.map((m) => (
                      <div key={m.nome} className="card" style={{ padding: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <b>{m.nome}</b>
                          <span className="muted small">
                            {m.nivel === "bom" ? "✅ Bom" : m.nivel === "ruim" ? "⚠️ Ruim" : "➖ Médio"}
                          </span>
                        </div>
                        {m.obs ? <div className="muted small" style={{ marginTop: 6 }}>{m.obs}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="toggle-btn" onClick={() => setModalAnalises(false)} style={{ width: "auto" }}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- MODAL LIMPAR (bonito) -------------------- */}
      {modalLimpar && (
        <div className="modal-overlay" onClick={() => setModalLimpar(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>⚠️ Confirmar limpeza</h3>

            {limparTipo === "dia" ? (
              <p className="muted small" style={{ marginTop: 8 }}>
                Você quer limpar <b>somente o dia {diaSelecionado}</b>?
              </p>
            ) : (
              <p className="muted small" style={{ marginTop: 8 }}>
                Você quer limpar <b>TUDO</b> (tarefas + matérias + notas)? Isso não dá para desfazer.
              </p>
            )}

            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <button type="button" className="primary-btn" onClick={executarLimpeza} style={{ width: "100%" }}>
                ✅ Executar limpeza
              </button>
              <button type="button" className="toggle-btn" onClick={() => setModalLimpar(false)} style={{ width: "100%" }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
