// src/pages/TrabalhoPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";

const LS_KEY = "pwa_trabalho_v8"; // versão nova
const DEFAULT_META_DIA_MIN = 8 * 60; // 8h

/**
 * Estrutura por dia: YYYY-MM-DD
 * {
 *   date: "YYYY-MM-DD",
 *   tipo: "trabalho" | "folga" | "interjornada",
 *   entradas: [{ in: "HH:MM", out: "HH:MM", kind?: "work" | "break" }],
 *   finalized: boolean,
 *   interjornadaMin: number | null,
 * }
 *
 * Config:
 * {
 *   metaDiaMin: number,
 *   exigirConfirmacao: boolean,
 *   pinAtivo: boolean,
 *   pinHash: string | null,
 * }
 */

export default function TrabalhoPage() {
  const [map, setMap] = useState({});
  const [config, setConfig] = useState({
    metaDiaMin: DEFAULT_META_DIA_MIN,
    exigirConfirmacao: true, // pede biometria/pin para marcar
    pinAtivo: false,
    pinHash: null,
  });

  const [dia, setDia] = useState(today());
  const [tipo, setTipo] = useState("trabalho");

  // período manual
  const [entrada, setEntrada] = useState("");
  const [saida, setSaida] = useState("");

  // interjornada
  const [interHoras, setInterHoras] = useState("11:00");

  // PDF
  const [de, setDe] = useState(today());
  const [ate, setAte] = useState(today());
  const [pdfIncluirPeriodos, setPdfIncluirPeriodos] = useState(true);

  // fluxo de marcação estilo “máquina”
  // estado do “relógio” do dia: idle | working | onBreak
  const [clockState, setClockState] = useState("idle"); // UI only
  const [runningIn, setRunningIn] = useState(""); // UI only

  // PIN (fallback)
  const [pinModal, setPinModal] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinPurpose, setPinPurpose] = useState(""); // "confirm" | "set"
  const [pinError, setPinError] = useState("");

  // -------------------- load/save --------------------
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      setMap(raw?.map || {});
      setConfig(raw?.config || {
        metaDiaMin: DEFAULT_META_DIA_MIN,
        exigirConfirmacao: true,
        pinAtivo: false,
        pinHash: null,
      });
    } catch {}
  }, []);

  function persist(nextMap, nextConfig = config) {
    setMap(nextMap);
    setConfig(nextConfig);
    localStorage.setItem(LS_KEY, JSON.stringify({ map: nextMap, config: nextConfig }));
  }

  // -------------------- dayData --------------------
  const dayData = map[dia] || {
    date: dia,
    tipo: "trabalho",
    entradas: [],
    finalized: false,
    interjornadaMin: null,
  };

  useEffect(() => {
    setTipo(dayData.tipo || "trabalho");

    // se interjornada: set input
    if ((dayData.tipo || "trabalho") === "interjornada") {
      const min = typeof dayData.interjornadaMin === "number" ? dayData.interjornadaMin : 11 * 60;
      setInterHoras(minToHHMM(min));
    }

    // reconstroi clockState pelo último registro (para UI)
    const rebuilt = rebuildClockState(dayData);
    setClockState(rebuilt.clockState);
    setRunningIn(rebuilt.runningIn);
    // eslint-disable-next-line
  }, [dia]);

  const isTrabalho = (dayData.tipo || "trabalho") === "trabalho";
  const isFolga = dayData.tipo === "folga";
  const isInterjornada = dayData.tipo === "interjornada";
  const isFinalized = !!dayData.finalized;

  // -------------------- cálculos --------------------
  const totalTrabalhoMin = useMemo(() => calcTotalWorkMin(dayData.entradas || []), [dayData]);
  const metaDiaMin = Number(config?.metaDiaMin || DEFAULT_META_DIA_MIN);

  const saldoDiaMin = useMemo(() => {
    if (!isTrabalho) return 0;
    return totalTrabalhoMin - metaDiaMin; // negativo = devendo
  }, [isTrabalho, totalTrabalhoMin, metaDiaMin]);

  const faltaDiaMin = Math.max(0, metaDiaMin - totalTrabalhoMin);
  const atingiuMeta = totalTrabalhoMin >= metaDiaMin;

  // saldo do mês (banco pessoal)
  const { mesLabel, saldoMesMin, totalMesTrabalhoMin, diasTrabalhoNoMes } = useMemo(() => {
    const { y, m } = parseYMD(dia);
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const end = lastDayOfMonthYMD(y, m);

    const rows = buildRangeRows(map, start, end, metaDiaMin);
    const onlyWork = rows.filter((r) => r.tipoRaw === "trabalho");

    const totalMes = onlyWork.reduce((acc, r) => acc + r.totalMin, 0);
    const saldoMes = onlyWork.reduce((acc, r) => acc + r.saldoMin, 0);

    return {
      mesLabel: `${String(m).padStart(2, "0")}/${y}`,
      saldoMesMin: saldoMes,
      totalMesTrabalhoMin: totalMes,
      diasTrabalhoNoMes: onlyWork.length,
    };
  }, [map, dia, metaDiaMin]);

  // -------------------- helpers de map --------------------
  function ensureDay(nextMap, key) {
    const cur = nextMap[key];
    if (cur) return cur;
    const fresh = {
      date: key,
      tipo: "trabalho",
      entradas: [],
      finalized: false,
      interjornadaMin: null,
    };
    nextMap[key] = fresh;
    return fresh;
  }

  function setDayTipo(v) {
    const next = { ...map };
    const cur = ensureDay(next, dia);
    const updated = { ...cur, tipo: v };

    if (v === "folga") {
      updated.entradas = [];
      updated.finalized = true;
      updated.interjornadaMin = null;
    }

    if (v === "interjornada") {
      const min = typeof updated.interjornadaMin === "number" ? updated.interjornadaMin : 11 * 60;
      updated.entradas = [];
      updated.finalized = true;
      updated.interjornadaMin = min;
      setInterHoras(minToHHMM(min));
    }

    if (v === "trabalho") {
      updated.finalized = updated.finalized || false;
      updated.interjornadaMin = null;
      // mantém entradas
    }

    next[dia] = updated;
    persist(next);
    setTipo(v);

    const rebuilt = rebuildClockState(updated);
    setClockState(rebuilt.clockState);
    setRunningIn(rebuilt.runningIn);
  }

  function salvarInterjornadaHoras() {
    if (!isInterjornada) return;

    const min = toMin(interHoras);
    if (min == null) return;

    const next = { ...map };
    const cur = ensureDay(next, dia);

    next[dia] = {
      ...cur,
      tipo: "interjornada",
      interjornadaMin: min,
      entradas: [],
      finalized: true,
    };
    persist(next);
  }

  // -------------------- segurança (biometria/pin) --------------------
  async function requireConfirm() {
    if (!config.exigirConfirmacao) return true;

    // 1) tenta WebAuthn/biometria do sistema (quando existe)
    const okBio = await tryBiometricAuth();
    if (okBio) return true;

    // 2) se pin está ativo, pede pin
    if (config.pinAtivo && config.pinHash) {
      setPinPurpose("confirm");
      setPinInput("");
      setPinError("");
      setPinModal(true);
      return false; // vai continuar após confirmar no modal
    }

    // 3) se não tem pin, deixa passar (pra não travar seu uso)
    return true;
  }

  async function tryBiometricAuth() {
    // WebAuthn depende de HTTPS + suporte do navegador
    // Aqui fazemos um "get" com allowCredentials vazio -> geralmente não funciona sozinho
    // então usamos um "check" básico: se existir e o navegador permitir, tentamos.
    try {
      if (!window.PublicKeyCredential || !navigator.credentials) return false;
      // Muitos navegadores exigem credenciais previamente registradas.
      // Sem cadastro, a autenticação não acontece. Então retornamos false.
      return false;
    } catch {
      return false;
    }
  }

  async function handlePinConfirm() {
    const input = String(pinInput || "").trim();
    if (!input) {
      setPinError("Digite seu PIN.");
      return;
    }

    if (pinPurpose === "set") {
      const h = await sha256(input);
      const nextConfig = { ...config, pinAtivo: true, pinHash: h };
      persist(map, nextConfig);
      setPinModal(false);
      setPinInput("");
      setPinError("");
      return;
    }

    if (pinPurpose === "confirm") {
      const h = await sha256(input);
      if (h !== config.pinHash) {
        setPinError("PIN incorreto.");
        return;
      }
      setPinModal(false);
      setPinInput("");
      setPinError("");
      // depois de confirmar, executa a ação pendente (a gente chama via callback simples)
      if (pendingActionRef.current) {
        const fn = pendingActionRef.current;
        pendingActionRef.current = null;
        fn();
      }
    }
  }

  function disablePin() {
    const nextConfig = { ...config, pinAtivo: false, pinHash: null };
    persist(map, nextConfig);
  }

  // Guardar ação pendente (quando exige pin)
  const pendingActionRef = React.useRef(null);

  // -------------------- marcação estilo “máquina” --------------------
  // Regras:
  // - Entrada: inicia trabalho
  // - Intervalo: fecha um período de trabalho e inicia "break"
  // - Voltar: fecha o break e inicia novo período de trabalho
  // - Saída: fecha o período de trabalho (se estiver trabalhando) e finaliza (opcional)
  // Obs: break é opcional no cálculo (não soma como trabalho). Só registra por clareza.
  async function marcarEntrada() {
    if (!isTrabalho || isFinalized) return;

    const ok = await requireConfirm();
    if (!ok) {
      pendingActionRef.current = marcarEntrada;
      return;
    }

    const now = nowHHMM();
    // só permite se estiver idle
    if (clockState !== "idle") return;

    setClockState("working");
    setRunningIn(now);
  }

  async function marcarIntervalo() {
    if (!isTrabalho || isFinalized) return;

    const ok = await requireConfirm();
    if (!ok) {
      pendingActionRef.current = marcarIntervalo;
      return;
    }

    const now = nowHHMM();

    if (clockState !== "working" || !runningIn) return;

    const next = { ...map };
    const cur = ensureDay(next, dia);

    // salva período de trabalho
    const a = toMin(runningIn);
    const b = toMin(now);
    if (a != null && b != null && b > a) {
      const entradas = [...(cur.entradas || []), { in: runningIn, out: now, kind: "work" }];
      next[dia] = { ...cur, tipo: "trabalho", entradas };
      persist(next);
    }

    // inicia break (UI)
    setClockState("onBreak");
    setRunningIn(now);
  }

  async function marcarVolta() {
    if (!isTrabalho || isFinalized) return;

    const ok = await requireConfirm();
    if (!ok) {
      pendingActionRef.current = marcarVolta;
      return;
    }

    const now = nowHHMM();

    if (clockState !== "onBreak" || !runningIn) return;

    const next = { ...map };
    const cur = ensureDay(next, dia);

    // registra o intervalo como "break" (não entra no cálculo de trabalho)
    const a = toMin(runningIn);
    const b = toMin(now);
    if (a != null && b != null && b > a) {
      const entradas = [...(cur.entradas || []), { in: runningIn, out: now, kind: "break" }];
      next[dia] = { ...cur, tipo: "trabalho", entradas };
      persist(next);
    }

    // volta ao trabalho (UI)
    setClockState("working");
    setRunningIn(now);
  }

  async function marcarSaida() {
    if (!isTrabalho || isFinalized) return;

    const ok = await requireConfirm();
    if (!ok) {
      pendingActionRef.current = marcarSaida;
      return;
    }

    const now = nowHHMM();

    // se estava trabalhando, fecha período
    if (clockState === "working" && runningIn) {
      const next = { ...map };
      const cur = ensureDay(next, dia);

      const a = toMin(runningIn);
      const b = toMin(now);
      if (a != null && b != null && b > a) {
        const entradas = [...(cur.entradas || []), { in: runningIn, out: now, kind: "work" }];
        next[dia] = { ...cur, tipo: "trabalho", entradas };
        persist(next);
      }
    }

    // se estava em break, fecha break (opcional) e finaliza
    if (clockState === "onBreak" && runningIn) {
      const next = { ...map };
      const cur = ensureDay(next, dia);

      const a = toMin(runningIn);
      const b = toMin(now);
      if (a != null && b != null && b > a) {
        const entradas = [...(cur.entradas || []), { in: runningIn, out: now, kind: "break" }];
        next[dia] = { ...cur, tipo: "trabalho", entradas };
        persist(next);
      }
    }

    // volta UI para idle
    setClockState("idle");
    setRunningIn("");
  }

  function finalizarDia() {
    if (!isTrabalho) return;

    const next = { ...map };
    const cur = ensureDay(next, dia);

    // Não mexe no clockState aqui, só trava edições
    next[dia] = { ...cur, finalized: true };
    persist(next);
  }

  function reabrirDia() {
    if (!isTrabalho) return;
    const next = { ...map };
    const cur = ensureDay(next, dia);
    next[dia] = { ...cur, finalized: false };
    persist(next);
  }

  // -------------------- manual (entrada/saida) --------------------
  function addPeriodoManual() {
    if (!isTrabalho || isFinalized) return;
    if (!entrada || !saida) return;

    const a = toMin(entrada);
    const b = toMin(saida);
    if (a == null || b == null || b <= a) {
      alert("Horário inválido: a saída deve ser maior que a entrada.");
      return;
    }

    const next = { ...map };
    const cur = ensureDay(next, dia);

    const entradas = [...(cur.entradas || []), { in: entrada, out: saida, kind: "work" }];
    next[dia] = { ...cur, tipo: "trabalho", entradas };
    persist(next);

    setEntrada("");
    setSaida("");
  }

  function removePeriodo(idx) {
    if (!isTrabalho || isFinalized) return;

    const next = { ...map };
    const cur = ensureDay(next, dia);

    const entradas = (cur.entradas || []).filter((_, i) => i !== idx);
    next[dia] = { ...cur, entradas };
    persist(next);
  }

  // -------------------- config --------------------
  function setMetaDiaHoras(hhmm) {
    const min = toMin(hhmm);
    if (min == null) return;
    const nextConfig = { ...config, metaDiaMin: min };
    persist(map, nextConfig);
  }

  function toggleExigirConfirmacao(v) {
    const nextConfig = { ...config, exigirConfirmacao: v };
    persist(map, nextConfig);
  }

  function abrirSetPin() {
    setPinPurpose("set");
    setPinInput("");
    setPinError("");
    setPinModal(true);
  }

  // -------------------- PDF --------------------
  function exportPDF() {
    const rows = buildRangeRows(map, de, ate, metaDiaMin);

    const diasTrabalho = rows.filter((r) => r.tipo === "Trabalho").length;
    const diasFolga = rows.filter((r) => r.tipo === "Folga").length;
    const diasInter = rows.filter((r) => r.tipo === "Interjornada").length;
    const diasSem = rows.filter((r) => r.tipo === "Sem registro").length;

    const totalTrabalho = rows.reduce((acc, r) => acc + (r.totalMin || 0), 0);
    const saldoTotal = rows.reduce((acc, r) => acc + (r.saldoMin || 0), 0);
    const totalInter = rows.reduce((acc, r) => acc + (r.interMin || 0), 0);

    const doc = new jsPDF();

    doc.setFontSize(14);
    doc.text("RELATORIO DE PONTO (PESSOAL)", 14, 16);

    doc.setFontSize(10);
    doc.text(`Periodo: ${fmtBR(de)} a ${fmtBR(ate)}`, 14, 24);
    doc.text(`Meta diaria: ${minToHHMM(metaDiaMin)}`, 14, 30);
    doc.text(`Incluir periodos: ${pdfIncluirPeriodos ? "SIM" : "NAO"}`, 14, 36);

    doc.text(
      `Resumo: Trabalho ${diasTrabalho} | Folga ${diasFolga} | Interjornada ${diasInter} | Sem registro ${diasSem}`,
      14,
      42
    );

    let y = 52;

    function drawHeader() {
      doc.setFontSize(10);
      doc.text("Data", 14, y);
      doc.text("Situacao", 40, y);
      doc.text("Total", 82, y);
      doc.text("Saldo", 105, y);
      doc.text("Status", 130, y);
      if (pdfIncluirPeriodos) doc.text("Periodos", 155, y);
      y += 6;
      doc.line(14, y - 4, 196, y - 4);
    }

    drawHeader();

    rows.forEach((r) => {
      if (y > 280) {
        doc.addPage();
        y = 16;
        drawHeader();
      }

      doc.text(r.data, 14, y);
      doc.text(r.tipo, 40, y);
      doc.text(r.horas, 82, y);
      doc.text(r.saldo, 105, y);
      doc.text(r.status, 130, y);

      if (pdfIncluirPeriodos) {
        doc.text(cutText(r.periodos, 45), 155, y);
      }

      y += 6;
    });

    y += 10;
    if (y > 275) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(12);
    doc.text("RESUMO DO PERIODO", 14, y);
    y += 8;

    doc.setFontSize(10);
    doc.text(`Total de horas trabalhadas: ${minToHHMM(totalTrabalho)}`, 14, y);
    y += 6;
    doc.text(`Saldo total (banco pessoal): ${formatSaldoMin(saldoTotal)}`, 14, y);
    y += 6;
    doc.text(`Total interjornada: ${minToHHMM(totalInter)}`, 14, y);

    doc.save(`relatorio_ponto_${de}_a_${ate}.pdf`);
  }

  // -------------------- UI --------------------
  return (
    <div className="page">
      <h2 className="page-title">🕘 Ponto (pessoal)</h2>

      {/* Config rápido */}
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Configuração</h3>

        <div className="field">
          <label>Meta diária</label>
          <input
            type="time"
            value={minToHHMM(metaDiaMin)}
            onChange={(e) => setMetaDiaHoras(e.target.value)}
          />
          <div className="muted small" style={{ marginTop: 6 }}>
            Ex.: 08:00 (480 min). Isso é usado para calcular se você está devendo ou com horas extras.
          </div>
        </div>

        <div className="field">
          <label>Confirmar marcação (biometria / PIN)</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={!!config.exigirConfirmacao}
              onChange={(e) => toggleExigirConfirmacao(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <span className="muted small">Pedir confirmação antes de marcar</span>
          </div>
        </div>

        <div className="field">
          <label>PIN (fallback)</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="primary-btn"
              style={{ width: "auto", padding: "8px 12px" }}
              onClick={abrirSetPin}
            >
              {config.pinAtivo ? "Trocar PIN" : "Definir PIN"}
            </button>

            {config.pinAtivo && (
              <button
                type="button"
                className="chip"
                style={{ width: "auto" }}
                onClick={disablePin}
              >
                Desativar PIN
              </button>
            )}
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            Se não houver biometria/suporte, o app usa PIN para confirmar marcações.
          </div>
        </div>
      </div>

      {/* Dia */}
      <div className="card mt">
        <div className="field">
          <label>Dia</label>
          <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
        </div>

        <div className="field">
          <label>Tipo</label>
          <select value={tipo} onChange={(e) => setDayTipo(e.target.value)}>
            <option value="trabalho">Dia normal</option>
            <option value="folga">Folga</option>
            <option value="interjornada">Interjornada</option>
          </select>
        </div>

        {/* Interjornada */}
        {isInterjornada && (
          <div className="audio-card" style={{ padding: 12 }}>
            <div className="muted small">
              <b>Interjornada do dia</b> (ex.: 11:00)
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                type="time"
                value={interHoras}
                onChange={(e) => setInterHoras(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="primary-btn"
                style={{ width: "auto", padding: "8px 12px" }}
                onClick={salvarInterjornadaHoras}
              >
                Salvar
              </button>
            </div>

            <div className="muted small" style={{ marginTop: 8 }}>
              Status: Finalizado ✅
            </div>
          </div>
        )}

        {/* Folga */}
        {isFolga && <p className="muted mt">Folga marcada ✅ (sem horas)</p>}

        {/* Trabalho */}
        {isTrabalho && (
          <>
            {/* painel principal */}
            <div className="mt">
              <div className="muted small">
                <b>Estado:</b>{" "}
                {clockState === "idle"
                  ? "Parado"
                  : clockState === "working"
                  ? `Trabalhando (desde ${runningIn})`
                  : `Em intervalo (desde ${runningIn})`}
              </div>

              <div className="mt" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={marcarEntrada}
                  disabled={isFinalized || clockState !== "idle"}
                  style={{ width: "auto", padding: "10px 12px", opacity: isFinalized ? 0.6 : 1 }}
                >
                  ▶️ Entrada
                </button>

                <button
                  type="button"
                  className="primary-btn"
                  onClick={marcarIntervalo}
                  disabled={isFinalized || clockState !== "working"}
                  style={{ width: "auto", padding: "10px 12px", opacity: isFinalized ? 0.6 : 1 }}
                >
                  ⏸️ Intervalo
                </button>

                <button
                  type="button"
                  className="primary-btn"
                  onClick={marcarVolta}
                  disabled={isFinalized || clockState !== "onBreak"}
                  style={{ width: "auto", padding: "10px 12px", opacity: isFinalized ? 0.6 : 1 }}
                >
                  ▶️ Voltar
                </button>

                <button
                  type="button"
                  className="primary-btn"
                  onClick={marcarSaida}
                  disabled={isFinalized || clockState === "idle"}
                  style={{
                    width: "auto",
                    padding: "10px 12px",
                    opacity: isFinalized ? 0.6 : 1,
                  }}
                >
                  ⏹️ Saída
                </button>
              </div>

              <div className="mt">
                <div className="muted small">
                  <b>Total do dia:</b> <span className="number small">{minToHHMM(totalTrabalhoMin)}</span>
                </div>

                <div className="muted small" style={{ marginTop: 4 }}>
                  <b>Saldo do dia:</b> <span className="number small">{formatSaldoMin(saldoDiaMin)}</span>
                </div>

                <div className="feedback" style={{ marginTop: 8 }}>
                  {atingiuMeta ? (
                    <>
                      ✅ Você marcou <b>{minToHHMM(totalTrabalhoMin)}</b> — atingiu a meta de{" "}
                      <b>{minToHHMM(metaDiaMin)}</b>.
                    </>
                  ) : (
                    <>
                      ⚠️ Você marcou <b>{minToHHMM(totalTrabalhoMin)}</b> — faltam{" "}
                      <b>{minToHHMM(faltaDiaMin)}</b> para completar <b>{minToHHMM(metaDiaMin)}</b>.
                    </>
                  )}
                </div>

                {/* travar/destravar */}
                <div className="mt">
                  {isFinalized ? (
                    <>
                      <span className="badge">Finalizado</span>
                      <button
                        type="button"
                        className="chip"
                        onClick={reabrirDia}
                        style={{ width: "auto", marginLeft: 8 }}
                      >
                        Reabrir
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={finalizarDia}
                      style={{ width: "auto", padding: "8px 12px" }}
                    >
                      ✅ Finalizar dia (travar)
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* manual */}
            <div className="mt">
              <h3 style={{ marginBottom: 8 }}>Adicionar período manual (trabalho)</h3>

              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="time"
                  value={entrada}
                  onChange={(e) => setEntrada(e.target.value)}
                  disabled={isFinalized}
                  style={{ flex: 1 }}
                />
                <input
                  type="time"
                  value={saida}
                  onChange={(e) => setSaida(e.target.value)}
                  disabled={isFinalized}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="primary-btn"
                  onClick={addPeriodoManual}
                  disabled={isFinalized}
                  style={{ width: "auto", padding: "8px 12px", opacity: isFinalized ? 0.6 : 1 }}
                >
                  Adicionar
                </button>
              </div>

              <div className="mt">
                {(dayData.entradas || []).length === 0 ? (
                  <p className="muted small">Nenhum período registrado.</p>
                ) : (
                  <ul className="list">
                    {(dayData.entradas || []).map((p, idx) => (
                      <li key={idx} className="list-item">
                        <div className="muted">
                          {p.in} → {p.out}{" "}
                          <span className="badge" style={{ marginLeft: 6 }}>
                            {p.kind === "break" ? "Intervalo" : "Trabalho"}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => removePeriodo(idx)}
                          disabled={isFinalized}
                          style={{ width: "auto", opacity: isFinalized ? 0.6 : 1 }}
                        >
                          Excluir
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Resumo do mês */}
      <div className="card mt">
        <h3>Resumo do mês ({mesLabel})</h3>
        <div className="muted small" style={{ marginTop: 6 }}>
          Dias de trabalho registrados: <b>{diasTrabalhoNoMes}</b>
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>
          Total trabalhado no mês: <b>{minToHHMM(totalMesTrabalhoMin)}</b>
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>
          Banco pessoal do mês (saldo): <b>{formatSaldoMin(saldoMesMin)}</b>
        </div>
      </div>

      {/* PDF */}
      <div className="card mt">
        <h3>Exportar PDF</h3>

        <div className="field">
          <label>Incluir períodos no PDF</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={pdfIncluirPeriodos}
              onChange={(e) => setPdfIncluirPeriodos(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <span className="muted small">Mostrar períodos e tipo (trabalho/intervalo)</span>
          </div>
        </div>

        <div className="filters-grid">
          <div className="field">
            <label>De</label>
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div className="field">
            <label>Até</label>
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
        </div>

        <button type="button" className="primary-btn mt" onClick={exportPDF}>
          Gerar PDF
        </button>
      </div>

      {/* Modal PIN */}
      {pinModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3 style={{ marginTop: 0 }}>
              {pinPurpose === "set" ? "Definir PIN" : "Confirmar com PIN"}
            </h3>

            <div className="field">
              <label>PIN</label>
              <input
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="Digite seu PIN"
              />
              {pinError && <div className="muted small" style={{ color: "crimson", marginTop: 6 }}>{pinError}</div>}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setPinModal(false);
                  setPinInput("");
                  setPinError("");
                  pendingActionRef.current = null;
                }}
                style={{ width: "auto" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={handlePinConfirm}
                style={{ width: "auto", padding: "8px 12px" }}
              >
                OK
              </button>
            </div>

            <div className="muted small" style={{ marginTop: 10 }}>
              Dica: se quiser “biometria”, a forma correta é desbloquear o celular/app; aqui o PIN é o fallback.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- HELPERS ---------------- */

function today() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nowHHMM() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function toMin(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minToHHMM(min) {
  const v = Math.max(0, Number(min || 0));
  const h = Math.floor(v / 60);
  const m = v % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fmtBR(yyyy_mm_dd) {
  const [y, m, d] = String(yyyy_mm_dd).split("-");
  return `${d}/${m}/${y}`;
}

function cutText(text, max) {
  const t = String(text || "");
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function parseYMD(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return { y, m, d };
}

function lastDayOfMonthYMD(y, m) {
  const dt = new Date(y, m, 0); // dia 0 do próximo mês = último dia do mês m
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function calcTotalWorkMin(entradas) {
  // soma só kind !== "break"
  return (entradas || []).reduce((acc, p) => {
    const a = toMin(p.in);
    const b = toMin(p.out);
    if (a == null || b == null) return acc;
    const diff = b - a;
    if (diff <= 0) return acc;
    const isBreak = p.kind === "break";
    return acc + (isBreak ? 0 : diff);
  }, 0);
}

function formatSaldoMin(saldoMin) {
  const v = Number(saldoMin || 0);
  if (v === 0) return "00:00";
  const sign = v > 0 ? "+" : "-";
  const abs = Math.abs(v);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function rebuildClockState(dayData) {
  // reconstrói estado apenas pela UI: se o último registro foi break, assume break; senão idle.
  // Como o “running” é UI-only, a pessoa pode simplesmente apertar "Entrada" de novo.
  // Isso evita salvar "rodando" e complicar quando fecha o app.
  const entradas = dayData?.entradas || [];
  if (entradas.length === 0) return { clockState: "idle", runningIn: "" };

  // Se o último item for break, assume onBreak; senão idle (já está fechado)
  const last = entradas[entradas.length - 1];
  if (last?.kind === "break") return { clockState: "idle", runningIn: "" };

  return { clockState: "idle", runningIn: "" };
}

function buildRangeRows(map, de, ate, metaDiaMin) {
  const rows = [];
  const start = new Date(de + "T00:00:00");
  const end = new Date(ate + "T00:00:00");

  for (let dt = start; dt <= end; dt.setDate(dt.getDate() + 1)) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    const key = `${y}-${m}-${d}`;

    const has = Object.prototype.hasOwnProperty.call(map || {}, key);
    const day = has ? map[key] : null;

    const tipoRaw = day?.tipo || null;

    const tipo = !has
      ? "Sem registro"
      : tipoRaw === "folga"
      ? "Folga"
      : tipoRaw === "interjornada"
      ? "Interjornada"
      : "Trabalho";

    const totalMin = has && tipoRaw === "trabalho" ? calcTotalWorkMin(day?.entradas || []) : 0;
    const saldoMin = has && tipoRaw === "trabalho" ? totalMin - metaDiaMin : 0;

    const interMin =
      has && tipoRaw === "interjornada"
        ? typeof day?.interjornadaMin === "number"
          ? day.interjornadaMin
          : 11 * 60
        : 0;

    const status = !has ? "-" : day?.finalized ? "Finalizado" : "Aberto";

    const periodos =
      has && tipoRaw === "trabalho"
        ? (day?.entradas || []).map((p) => `${p.in}-${p.out}${p.kind === "break" ? "(I)" : ""}`).join(" | ") || "-"
        : "-";

    rows.push({
      data: fmtBR(key),
      tipo,
      tipoRaw: tipoRaw || null,
      horas: minToHHMM(totalMin),
      saldo: formatSaldoMin(saldoMin),
      status,
      periodos,
      totalMin,
      saldoMin,
      interMin,
      interjornada: minToHHMM(interMin),
    });
  }

  return rows;
}

// SHA-256 simples para guardar PIN sem salvar em texto puro
async function sha256(str) {
  const enc = new TextEncoder().encode(String(str));
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
