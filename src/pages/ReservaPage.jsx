// src/pages/ReservaPage.jsx

import React, { useEffect, useMemo, useState } from "react";
import { useFinance } from "../App.jsx";

function formatCurrency(value) {
  const num = Number(value || 0);
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function FeedbackBox({ text, onClose }) {
  if (!text) return null;

  return (
    <div
      className="feedback"
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        alignItems: "center",
      }}
    >
      <span>{text}</span>

      <button
        type="button"
        className="toggle-btn"
        onClick={onClose}
        style={{ width: "auto", padding: "6px 10px" }}
        aria-label="Fechar mensagem"
        title="Fechar"
      >
        ✖
      </button>
    </div>
  );
}

function criarDataCerta(ano, mes, diaDesejado) {
  const ultimoDiaDoMes = new Date(ano, mes + 1, 0).getDate();
  const d = Math.min(Math.max(1, diaDesejado), ultimoDiaDoMes);
  return new Date(ano, mes, d, 0, 0, 0, 0);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function toNum(v) {
  const n = Number(String(v ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function daysBetween(aMs, bMs) {
  const one = 24 * 60 * 60 * 1000;
  return Math.floor((bMs - aMs) / one);
}

export default function ReservaPage() {
  const { reserva, setReserva, profile, mesReferencia, adicionarTransacao } = useFinance();

  // Meta mensal (geral)
  const [metaMensalLocal, setMetaMensalLocal] = useState(reserva.metaMensal || "");

  // Criar local (com meta)
  const [novoLocalNome, setNovoLocalNome] = useState("");
  const [novoLocalMeta, setNovoLocalMeta] = useState("");

  // Adicionar dinheiro
  const [valorAdicionar, setValorAdicionar] = useState("");
  const [origem, setOrigem] = useState("salario");
  const [localDestinoId, setLocalDestinoId] = useState("");

  // Retirar dinheiro
  const [valorRetirar, setValorRetirar] = useState("");
  const [motivoRetirar, setMotivoRetirar] = useState("contas");
  const [localRetirarId, setLocalRetirarId] = useState("");

  // Mensagem
  const [mensagem, setMensagem] = useState("");

  // Reiniciar tudo
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTyping, setResetTyping] = useState("");

  // Apagar local
  const [delOpen, setDelOpen] = useState(false);
  const [delLocalId, setDelLocalId] = useState("");
  const [delTyping, setDelTyping] = useState("");

  // Modais principais
  const [metaOpen, setMetaOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [retOpen, setRetOpen] = useState(false);
  const [novoLocalOpen, setNovoLocalOpen] = useState(false);

  const locaisRaw = Array.isArray(reserva.locais) ? reserva.locais : [];
  const movimentosRaw = Array.isArray(reserva.movimentos) ? reserva.movimentos : [];

  const locais = useMemo(() => {
    return locaisRaw.map((l) => ({
      id: l.id,
      nome: String(l.nome || "Local"),
      valor: toNum(l.valor),
      meta: toNum(l.meta),
      status: l.status || "ativo",
      doneAt: l.doneAt || "",
    }));
  }, [locaisRaw]);

  const movimentos = useMemo(() => {
    return movimentosRaw.map((m) => ({
      id: m.id || generateId(),
      valor: toNum(m.valor),
      origem: m.origem || "outros",
      localId: m.localId || "",
      objetivo: String(m.objetivo || ""),
      dataHora: m.dataHora || new Date().toISOString(),
      tipo: m.tipo || "",
    }));
  }, [movimentosRaw]);

  function atualizarReserva(dados) {
    setReserva({ ...reserva, ...dados });
  }

  // Auto-remover concluídos após 7 dias (com histórico)
  useEffect(() => {
    const now = Date.now();
    const toRemoveIds = [];

    for (const l of locais) {
      if (l.status === "done" && l.doneAt) {
        const t = new Date(l.doneAt).getTime();
        if (!isNaN(t) && daysBetween(t, now) >= 7) toRemoveIds.push(l.id);
      }
    }

    if (toRemoveIds.length === 0) return;

    const novosLocais = locais.filter((l) => !toRemoveIds.includes(l.id));
    const novosMov = movimentos.filter((m) => !toRemoveIds.includes(m.localId));

    atualizarReserva({ locais: novosLocais, movimentos: novosMov });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locaisRaw, movimentosRaw]);

  // Meta por ciclo (diaPagamento)
  const diaPagamento = Number(profile?.diaPagamento || 0);

  const periodoCiclo = useMemo(() => {
    if (!diaPagamento || diaPagamento < 1 || diaPagamento > 31) return null;

    const ano = mesReferencia?.ano ?? new Date().getFullYear();
    const mes = mesReferencia?.mes ?? new Date().getMonth();

    const inicio = criarDataCerta(ano, mes, diaPagamento);
    const inicioProx = criarDataCerta(ano, mes + 1, diaPagamento);

    const fim = new Date(inicioProx.getTime());
    fim.setDate(fim.getDate() - 1);
    fim.setHours(23, 59, 59, 999);

    return { inicio, fim };
  }, [diaPagamento, mesReferencia?.ano, mesReferencia?.mes]);

  const totalNoCiclo = useMemo(() => {
    if (!periodoCiclo) return 0;

    const ini = periodoCiclo.inicio.getTime();
    const fim = periodoCiclo.fim.getTime();

    return movimentos.reduce((acc, m) => {
      const dt = new Date(m.dataHora).getTime();
      if (dt >= ini && dt <= fim) acc += Number(m.valor || 0);
      return acc;
    }, 0);
  }, [movimentos, periodoCiclo]);

  const metaAtual = toNum(metaMensalLocal || reserva.metaMensal || 0);
  const percMeta = metaAtual > 0 ? Math.min(100, (totalNoCiclo / metaAtual) * 100) : 0;

  const totalGuardado = useMemo(
    () => locais.reduce((soma, l) => soma + Number(l.valor || 0), 0),
    [locais]
  );

  // Salvar meta mensal
  function salvarMetaMensal(e) {
    e.preventDefault();
    const meta = toNum(metaMensalLocal || 0);
    atualizarReserva({ metaMensal: meta });
    setMensagem("Meta mensal salva.");
    setMetaOpen(false);
  }

  // Criar local
  function adicionarLocal(e) {
    e.preventDefault();

    if (!novoLocalNome.trim()) {
      setMensagem("Digite o nome do local.");
      return;
    }

    const novo = {
      id: generateId(),
      nome: novoLocalNome.trim(),
      valor: 0,
      meta: toNum(novoLocalMeta || 0),
      status: "ativo",
      doneAt: "",
    };

    const novos = [...locais, novo];
    atualizarReserva({ locais: novos });

    setNovoLocalNome("");
    setNovoLocalMeta("");

    if (!localDestinoId) setLocalDestinoId(novo.id);
    if (!localRetirarId) setLocalRetirarId(novo.id);

    setMensagem("Local adicionado.");
    setNovoLocalOpen(false);
  }

  function alterarLocalCampo(id, patch) {
    const novos = locais.map((l) => (l.id === id ? { ...l, ...patch } : l));
    atualizarReserva({ locais: novos });
  }

  function marcarConcluido(id) {
    const alvo = locais.find((l) => l.id === id);
    if (!alvo) return;

    if (alvo.status === "done") {
      alterarLocalCampo(id, { status: "ativo", doneAt: "" });
      setMensagem("Local reaberto.");
    } else {
      alterarLocalCampo(id, { status: "done", doneAt: new Date().toISOString() });
      setMensagem("Local marcado como concluído (será removido em 7 dias).");
    }
  }

  function abrirApagarLocal(id) {
    setDelLocalId(id);
    setDelTyping("");
    setDelOpen(true);
  }

  function confirmarApagarLocal() {
    if (String(delTyping || "").trim().toUpperCase() !== "APAGAR") {
      setMensagem('Para confirmar, digite "APAGAR".');
      return;
    }

    const id = delLocalId;
    if (!id) return;

    const novosLocais = locais.filter((l) => l.id !== id);
    const novosMov = movimentos.filter((m) => m.localId !== id);

    atualizarReserva({ locais: novosLocais, movimentos: novosMov });

    setDelOpen(false);
    setDelLocalId("");
    setDelTyping("");

    setMensagem("Local apagado (e histórico removido).");
  }

  function nomeLocal(id) {
    const l = locais.find((x) => x.id === id);
    return l ? l.nome : "Local";
  }

  function origemLabel(o) {
    if (o === "salario") return "Salário";
    if (o === "pix") return "PIX";
    if (o === "venda") return "Venda";
    if (o === "economia") return "Economia";
    if (o === "resgate") return "Resgate";
    return "Outros";
  }

  function motivoLabel(m) {
    if (m === "contas") return "Pagar contas";
    if (m === "emergencia") return "Emergência";
    if (m === "compra") return "Compra";
    if (m === "outro") return "Outro";
    return "Outro";
  }

  // Adicionar dinheiro (depósito)
  function handleAdicionarReserva(e) {
    e.preventDefault();

    const v = toNum(valorAdicionar);

    if (!v || v <= 0) {
      setMensagem("Digite um valor válido.");
      return;
    }

    if (!localDestinoId) {
      setMensagem("Selecione o local.");
      return;
    }

    const destino = locais.find((l) => l.id === localDestinoId);
    if (!destino) {
      setMensagem("Local inválido.");
      return;
    }

    if (destino.status === "done") {
      setMensagem("Este local está concluído. Reabra o local para adicionar valores.");
      return;
    }

    const novosLocais = locais.map((l) =>
      l.id === localDestinoId ? { ...l, valor: Number(l.valor || 0) + v } : l
    );

    const movimento = {
      id: generateId(),
      valor: v,
      origem,
      localId: localDestinoId,
      objetivo: "",
      dataHora: new Date().toISOString(),
      tipo: "entrada",
    };

    atualizarReserva({
      locais: novosLocais,
      movimentos: [movimento, ...movimentos],
    });

    if (typeof adicionarTransacao === "function") {
      try {
        adicionarTransacao({
          id: generateId(),
          tipo: "despesa",
          valor: v,
          categoria: "investido",
          descricao: `Reserva: ${nomeLocal(localDestinoId)}`,
          formaPagamento: "debito",
          dataHora: new Date().toISOString(),
          origem: origem,
        });
      } catch (err) {
        console.error("Falha ao registrar transação de investimento:", err);
      }
    }

    setValorAdicionar("");
    setMensagem(`Adicionado: ${formatCurrency(v)}.`);
    setAddOpen(false);
  }

  // Retirar dinheiro (resgate)
  function handleRetirarReserva(e) {
    e.preventDefault();

    const v = toNum(valorRetirar);

    if (!v || v <= 0) {
      setMensagem("Digite um valor válido para retirar.");
      return;
    }

    if (!localRetirarId) {
      setMensagem("Selecione o local para retirar.");
      return;
    }

    const origemLocal = locais.find((l) => l.id === localRetirarId);
    if (!origemLocal) {
      setMensagem("Local inválido.");
      return;
    }

    if (origemLocal.status === "done") {
      setMensagem("Este local está concluído. Reabra o local para retirar valores.");
      return;
    }

    const saldoLocal = toNum(origemLocal.valor);
    if (v > saldoLocal) {
      setMensagem(`Saldo insuficiente neste local. Disponível: ${formatCurrency(saldoLocal)}.`);
      return;
    }

    const novosLocais = locais.map((l) =>
      l.id === localRetirarId ? { ...l, valor: Math.max(0, Number(l.valor || 0) - v) } : l
    );

    const movimento = {
      id: generateId(),
      valor: -v,
      origem: "resgate",
      localId: localRetirarId,
      objetivo: motivoLabel(motivoRetirar),
      dataHora: new Date().toISOString(),
      tipo: "saida",
    };

    atualizarReserva({
      locais: novosLocais,
      movimentos: [movimento, ...movimentos],
    });

    if (typeof adicionarTransacao === "function") {
      try {
        adicionarTransacao({
          id: generateId(),
          tipo: "receita",
          valor: v,
          categoria: "resgate_reserva",
          descricao: `Resgate Reserva: ${nomeLocal(localRetirarId)} (${motivoLabel(motivoRetirar)})`,
          formaPagamento: "dinheiro",
          dataHora: new Date().toISOString(),
          origem: "resgate",
        });
      } catch (err) {
        console.error("Falha ao registrar transação de resgate:", err);
      }
    }

    setValorRetirar("");
    setMensagem(`Retirado: ${formatCurrency(v)}.`);
    setRetOpen(false);
  }

  // Reset total
  function abrirReset() {
    setResetTyping("");
    setResetOpen(true);
  }

  function confirmarReset() {
    if (String(resetTyping || "").trim().toUpperCase() !== "ZERAR") {
      setMensagem('Para confirmar, digite "ZERAR".');
      return;
    }

    atualizarReserva({ locais: [], movimentos: [] });

    setResetOpen(false);
    setResetTyping("");
    setMensagem("Reserva reiniciada (zerada).");
  }

  const locaisAtivos = locais.filter((l) => l.status !== "done");
  const locaisConcluidos = locais.filter((l) => l.status === "done");

  useEffect(() => {
    if (!localDestinoId && locaisAtivos.length > 0) setLocalDestinoId(locaisAtivos[0].id);
    if (!localRetirarId && locaisAtivos.length > 0) setLocalRetirarId(locaisAtivos[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locaisAtivos.length]);

  const softBlue = {
    background: "rgba(59,130,246,.18)",
    border: "1px solid rgba(59,130,246,.35)",
    color: "rgba(255,255,255,.96)",
  };

  const softBlueStrong = {
    background: "rgba(59,130,246,.22)",
    border: "1px solid rgba(59,130,246,.45)",
    color: "rgba(255,255,255,.98)",
  };

  // Quadrinho dos botões
  const actionPanelStyle = {
    marginTop: 10,
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,.08)",
    background: "rgba(255,255,255,.03)",
  };

  // ✅ agora são 3 botões (sem Meta e Novo local)
  const actionGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 10,
  };

  const actionBtnBase = {
    width: "100%",
    height: 44,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    fontWeight: 800,
    letterSpacing: ".2px",
    whiteSpace: "nowrap",
  };

  return (
    <div className="page">
      <h2 className="page-title" style={{ marginBottom: 8 }}>
        Reserva
      </h2>

      {/* ✅ AÇÕES RÁPIDAS (SEM META E SEM NOVO LOCAL) */}
      <div className="card" style={actionPanelStyle}>
        <div className="muted small" style={{ marginBottom: 10 }}>
          Ações rápidas
        </div>

        <div style={actionGridStyle}>
          <button
            type="button"
            className="primary-btn"
            onClick={() => setAddOpen(true)}
            style={{ ...actionBtnBase, ...softBlueStrong }}
            title="Adicionar dinheiro na reserva"
          >
            ➕ Adicionar
          </button>

          <button
            type="button"
            className="primary-btn"
            onClick={() => setRetOpen(true)}
            style={{ ...actionBtnBase, ...softBlue }}
            title="Retirar dinheiro da reserva"
          >
            ➖ Retirar
          </button>

          <button
            type="button"
            className="toggle-btn"
            onClick={abrirReset}
            style={actionBtnBase}
            title="Reiniciar Reserva"
          >
            ♻️ Reiniciar
          </button>
        </div>

        <div className="muted small" style={{ marginTop: 10 }}>
          Dica: se estiver no celular, eles podem quebrar em 2 linhas automaticamente.
        </div>
      </div>

      <FeedbackBox text={mensagem} onClose={() => setMensagem("")} />

      {/* META (continua existindo, só não está nos botões de cima) */}
      {metaOpen ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Meta do mês (geral)</h3>

            {periodoCiclo ? (
              <p className="muted small" style={{ marginTop: 6 }}>
                Ciclo:{" "}
                <strong>
                  {periodoCiclo.inicio.toLocaleDateString("pt-BR")} até{" "}
                  {periodoCiclo.fim.toLocaleDateString("pt-BR")}
                </strong>
              </p>
            ) : (
              <p className="muted small" style={{ marginTop: 6 }}>
                Defina o “Dia que você recebe” no Perfil para usar ciclo automático.
              </p>
            )}

            <form className="form" onSubmit={salvarMetaMensal} style={{ marginTop: 10 }}>
              <div className="field">
                <label>Meta (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={metaMensalLocal}
                  onChange={(e) => setMetaMensalLocal(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
                <button type="button" className="toggle-btn" onClick={() => setMetaOpen(false)}>
                  Cancelar
                </button>
                <button className="primary-btn" type="submit" style={softBlueStrong}>
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* ADICIONAR */}
      {addOpen ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Adicionar</h3>

            <form className="form" onSubmit={handleAdicionarReserva} style={{ marginTop: 10 }}>
              <div className="field">
                <label>Valor (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={valorAdicionar}
                  onChange={(e) => setValorAdicionar(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Origem</label>
                <select value={origem} onChange={(e) => setOrigem(e.target.value)}>
                  <option value="salario">Salário</option>
                  <option value="pix">PIX</option>
                  <option value="venda">Venda</option>
                  <option value="economia">Economia</option>
                  <option value="outros">Outros</option>
                </select>
              </div>

              <div className="field">
                <label>Local</label>
                <select value={localDestinoId} onChange={(e) => setLocalDestinoId(e.target.value)}>
                  <option value="">Selecione...</option>
                  {locaisAtivos.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
                <button type="button" className="toggle-btn" onClick={() => setAddOpen(false)}>
                  Cancelar
                </button>
                <button className="primary-btn" type="submit" style={softBlueStrong}>
                  Confirmar
                </button>
              </div>

              <p className="muted small" style={{ marginTop: 10 }}>
                Ao adicionar, o app registra uma <strong>despesa “investido”</strong> para descontar do saldo.
              </p>
            </form>
          </div>
        </div>
      ) : null}

      {/* RETIRAR */}
      {retOpen ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Retirar</h3>

            <form className="form" onSubmit={handleRetirarReserva} style={{ marginTop: 10 }}>
              <div className="field">
                <label>Valor (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={valorRetirar}
                  onChange={(e) => setValorRetirar(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Motivo</label>
                <select value={motivoRetirar} onChange={(e) => setMotivoRetirar(e.target.value)}>
                  <option value="contas">Pagar contas</option>
                  <option value="emergencia">Emergência</option>
                  <option value="compra">Compra</option>
                  <option value="outro">Outro</option>
                </select>
              </div>

              <div className="field">
                <label>Local</label>
                <select value={localRetirarId} onChange={(e) => setLocalRetirarId(e.target.value)}>
                  <option value="">Selecione...</option>
                  {locaisAtivos.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
                <button type="button" className="toggle-btn" onClick={() => setRetOpen(false)}>
                  Cancelar
                </button>
                <button className="primary-btn" type="submit" style={softBlue}>
                  Confirmar
                </button>
              </div>

              <p className="muted small" style={{ marginTop: 10 }}>
                Ao retirar, o app cria um movimento <strong>negativo</strong> no histórico e registra uma{" "}
                <strong>receita</strong> “resgate_reserva” para devolver ao saldo.
              </p>
            </form>
          </div>
        </div>
      ) : null}

      {/* NOVO LOCAL (continua existindo, só não está nos botões de cima) */}
      {novoLocalOpen ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Novo local</h3>

            <form className="form" onSubmit={adicionarLocal} style={{ marginTop: 10 }}>
              <div className="field">
                <label>Nome</label>
                <input
                  type="text"
                  value={novoLocalNome}
                  onChange={(e) => setNovoLocalNome(e.target.value)}
                  placeholder="Ex.: Emergência, Carro, Viagem..."
                />
              </div>

              <div className="field">
                <label>Meta deste local (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={novoLocalMeta}
                  onChange={(e) => setNovoLocalMeta(e.target.value)}
                  placeholder="Ex.: 5000"
                />
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
                <button type="button" className="toggle-btn" onClick={() => setNovoLocalOpen(false)}>
                  Cancelar
                </button>
                <button className="primary-btn" type="submit" style={softBlueStrong}>
                  Adicionar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* RESET */}
      {resetOpen ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Reiniciar reserva?</h3>

            <p className="muted small" style={{ marginTop: 6 }}>
              Isso vai <strong>apagar TODOS os locais</strong> e <strong>todo o histórico</strong> da Reserva.
            </p>

            <div className="field" style={{ marginTop: 10 }}>
              <label>Digite ZERAR para confirmar</label>
              <input
                type="text"
                value={resetTyping}
                onChange={(e) => setResetTyping(e.target.value)}
                placeholder="Digite: ZERAR"
                autoComplete="off"
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" className="toggle-btn" onClick={() => setResetOpen(false)}>
                Cancelar
              </button>

              <button
                type="button"
                className="primary-btn"
                onClick={confirmarReset}
                style={{ background: "rgba(239,68,68,.15)", border: "1px solid rgba(239,68,68,.35)" }}
              >
                ✅ Sim, zerar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* APAGAR LOCAL */}
      {delOpen ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Apagar local?</h3>

            <p className="muted small" style={{ marginTop: 6 }}>
              Isso vai apagar o local <strong>{nomeLocal(delLocalId)}</strong> e{" "}
              <strong>TUDO relacionado no histórico</strong>.
            </p>

            <div className="field" style={{ marginTop: 10 }}>
              <label>Digite APAGAR para confirmar</label>
              <input
                type="text"
                value={delTyping}
                onChange={(e) => setDelTyping(e.target.value)}
                placeholder="Digite: APAGAR"
                autoComplete="off"
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" className="toggle-btn" onClick={() => setDelOpen(false)}>
                Cancelar
              </button>

              <button
                type="button"
                className="primary-btn"
                onClick={confirmarApagarLocal}
                style={{ background: "rgba(239,68,68,.15)", border: "1px solid rgba(239,68,68,.35)" }}
              >
                🗑️ Apagar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* RESUMO */}
      <div className="card" style={{ marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div>
            <h3 style={{ marginBottom: 4 }}>Resumo</h3>
            <p className="muted small" style={{ marginTop: 0 }}>
              Total, ciclo e progresso da meta.
            </p>
          </div>

          {/* Mantém acesso à meta aqui (opcional) */}
          <button type="button" className="toggle-btn" onClick={() => setMetaOpen(true)} title="Editar meta">
            🎯 Ajustar
          </button>
        </div>

        {periodoCiclo ? (
          <p className="muted small" style={{ marginTop: 6 }}>
            Ciclo:{" "}
            <strong>
              {periodoCiclo.inicio.toLocaleDateString("pt-BR")} até {periodoCiclo.fim.toLocaleDateString("pt-BR")}
            </strong>
          </p>
        ) : (
          <p className="muted small" style={{ marginTop: 6 }}>
            Defina o “Dia que você recebe” no Perfil para usar ciclo automático.
          </p>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 10,
            marginTop: 10,
          }}
        >
          <div style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: 12 }}>
            <div className="muted small">Total guardado</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{formatCurrency(totalGuardado)}</div>
          </div>

          <div style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: 12 }}>
            <div className="muted small">Neste ciclo (líquido)</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{formatCurrency(totalNoCiclo)}</div>
          </div>

          <div style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: 12 }}>
            <div className="muted small">Meta do ciclo</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{formatCurrency(metaAtual)}</div>

            {metaAtual > 0 ? (
              <div className="progress-container" style={{ marginTop: 10 }}>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${percMeta.toFixed(0)}%` }} />
                </div>
                <span className="progress-label">{percMeta.toFixed(0)}%</span>
              </div>
            ) : (
              <div className="muted small" style={{ marginTop: 10 }}>
                Ajuste a meta para ver o progresso.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* LOCAIS */}
      <div className="card mt">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Locais</h3>

          {/* Mantém acesso a novo local aqui (opcional) */}
          <button type="button" className="toggle-btn" onClick={() => setNovoLocalOpen(true)} title="Novo local">
            📌 Adicionar
          </button>
        </div>

        <p className="muted small" style={{ marginTop: 6 }}>
          Cada local tem <strong>meta</strong>, <strong>investido</strong> e <strong>quanto falta</strong>.
        </p>

        {locaisAtivos.length === 0 ? (
          <p className="muted small">Adicione um local para começar.</p>
        ) : (
          <ul className="list" style={{ marginTop: 10 }}>
            {locaisAtivos.map((l) => {
              const investido = toNum(l.valor);
              const meta = toNum(l.meta);
              const falta = Math.max(0, meta - investido);
              const perc = meta > 0 ? clamp((investido / meta) * 100, 0, 100) : 0;

              return (
                <li
                  key={l.id}
                  className="list-item"
                  style={{
                    flexDirection: "column",
                    gap: 10,
                    padding: 14,
                    borderRadius: 14,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, width: "100%" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <strong style={{ fontSize: 16 }}>{l.nome}</strong>
                      <span className="muted small">
                        Investido: <strong>{formatCurrency(investido)}</strong> · Falta:{" "}
                        <strong>{formatCurrency(falta)}</strong>
                      </span>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button type="button" className="toggle-btn" onClick={() => marcarConcluido(l.id)}>
                        ✅ Concluir
                      </button>

                      <button type="button" className="toggle-btn" onClick={() => abrirApagarLocal(l.id)}>
                        🗑️ Apagar
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%" }}>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Meta (R$)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={l.meta}
                        onChange={(e) => alterarLocalCampo(l.id, { meta: toNum(e.target.value) })}
                      />
                    </div>

                    <div className="field" style={{ margin: 0 }}>
                      <label>Investido (R$)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={l.valor}
                        onChange={(e) => alterarLocalCampo(l.id, { valor: toNum(e.target.value) })}
                      />
                    </div>
                  </div>

                  {meta > 0 ? (
                    <div className="progress-container" style={{ width: "100%" }}>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${perc.toFixed(0)}%` }} />
                      </div>
                      <span className="progress-label">{perc.toFixed(0)}%</span>
                    </div>
                  ) : (
                    <p className="muted small" style={{ width: "100%" }}>
                      Dica: coloque uma meta para ver o progresso.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {locaisConcluidos.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <h4 style={{ marginBottom: 6 }}>Concluídos</h4>
            <p className="muted small">Serão removidos automaticamente após 7 dias.</p>

            <ul className="list" style={{ marginTop: 8 }}>
              {locaisConcluidos.map((l) => {
                const doneAt = l.doneAt ? new Date(l.doneAt) : null;
                const dias = doneAt ? daysBetween(doneAt.getTime(), Date.now()) : 0;
                const faltam = Math.max(0, 7 - dias);

                return (
                  <li key={l.id} className="list-item" style={{ justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <strong>{l.nome}</strong>
                      <p className="muted small" style={{ marginTop: 2 }}>
                        Remove em ~{faltam} dia(s)
                      </p>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button type="button" className="toggle-btn" onClick={() => marcarConcluido(l.id)}>
                        ↩️ Reabrir
                      </button>

                      <button type="button" className="toggle-btn" onClick={() => abrirApagarLocal(l.id)}>
                        🗑️ Apagar agora
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>

      {/* HISTÓRICO */}
      <div className="card mt">
        <h3>Histórico</h3>

        {movimentos.length === 0 ? (
          <p className="muted small">Sem movimentos ainda.</p>
        ) : (
          <ul className="list">
            {movimentos.map((m) => (
              <li key={m.id} className="list-item list-item-history">
                <div>
                  <strong>{formatCurrency(m.valor)}</strong>

                  <p className="small muted">
                    {nomeLocal(m.localId)} · {origemLabel(m.origem)}
                    {m.objetivo ? ` · ${m.objetivo}` : ""}
                  </p>
                </div>

                <div className="muted small">
                  {new Date(m.dataHora).toLocaleDateString("pt-BR")}{" "}
                  {new Date(m.dataHora).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* DICA */}
      <div className="card mt">
        <p className="muted small">
          ✅ Regras:
          <br />• Apagar local remove também o histórico ligado a ele.
          <br />• Concluído fica oculto e é removido após 7 dias (com histórico).
          <br />• Cada local tem meta, investido e quanto falta.
          <br />• Adicionar vira despesa “investido” e Retirar vira receita “resgate_reserva”.
        </p>
      </div>
    </div>
  );
}
