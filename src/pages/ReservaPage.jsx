// src/pages/ReservaPage.jsx

// Importa React e alguns "hooks" (ferramentas do React) para:
// - useState: guardar estados (valores que mudam na tela)
// - useEffect: rodar efeitos automáticos quando algo muda
// - useMemo: memorizar cálculos para não recalcular toda hora
import React, { useEffect, useMemo, useState } from "react";

// Importa o hook do seu App que dá acesso aos dados globais de finanças/reserva/perfil
import { useFinance } from "../App.jsx";

// Formata um número para moeda brasileira (R$)
// Ex.: 10 -> "R$ 10,00"
function formatCurrency(value) {
  const num = Number(value || 0);
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Gera um id "único" simples combinando tempo atual + aleatório
// Serve para id de local/movimento quando precisa identificar itens na lista
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Componente pequeno para mostrar uma mensagem de feedback (alerta na tela)
// - aparece apenas se "text" tiver conteúdo
// - tem botão ✖ para fechar chamando onClose
function FeedbackBox({ text, onClose }) {
  if (!text) return null; // se não tem texto, não renderiza nada

  return (
    <div
      className="feedback"
      style={{
        display: "flex", // coloca itens em linha
        justifyContent: "space-between", // separa texto e botão
        gap: 10, // espaçamento entre eles
        alignItems: "center", // centraliza verticalmente
      }}
    >
      <span>{text}</span>

      <button
        type="button"
        className="toggle-btn"
        onClick={onClose} // fecha a mensagem limpando o texto
        style={{ width: "auto", padding: "6px 10px" }}
        aria-label="Fechar mensagem"
        title="Fechar"
      >
        ✖
      </button>
    </div>
  );
}

// ✅ cria data sem estourar em meses com menos dias (ex.: 31/02)
// Ex.: se pedir dia 31 em um mês que só tem 30, ele ajusta pro último dia do mês
function criarDataCerta(ano, mes, diaDesejado) {
  const ultimoDiaDoMes = new Date(ano, mes + 1, 0).getDate(); // pega o último dia do mês
  const d = Math.min(Math.max(1, diaDesejado), ultimoDiaDoMes); // garante entre 1 e o último dia
  return new Date(ano, mes, d, 0, 0, 0, 0); // cria a data no início do dia
}

// Limita um número dentro de um intervalo
// Ex.: clamp(150, 0, 100) => 100
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// Converte uma entrada (string/number) em número confiável
// - troca vírgula por ponto
// - se der NaN, vira 0
function toNum(v) {
  const n = Number(String(v ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

// Calcula quantos dias inteiros existem entre duas datas em ms (milissegundos)
// Ex.: daysBetween(hoje, daqui 8 dias) => 8
function daysBetween(aMs, bMs) {
  const one = 24 * 60 * 60 * 1000; // 1 dia em ms
  return Math.floor((bMs - aMs) / one); // diferença em dias (arredondando pra baixo)
}

// Componente principal da página "Reserva"
export default function ReservaPage() {
  // Puxa do contexto global:
  // - reserva: objeto com metaMensal, locais, movimentos, etc.
  // - setReserva: função para atualizar o estado da reserva no App
  // - profile: dados do perfil (ex.: diaPagamento)
  // - mesReferencia: mês/ano que o app está mostrando (usado pra cálculos)
  // ✅ ADICIONADO (sem mexer no resto): adicionarTransacao para registrar "investido"
  const { reserva, setReserva, profile, mesReferencia, adicionarTransacao } = useFinance();

  // ✅ meta mensal (geral) continua existindo
  // Estado local para o input de meta (não grava direto no estado global até salvar)
  const [metaMensalLocal, setMetaMensalLocal] = useState(reserva.metaMensal || "");

  // ✅ criar local (com meta)
  // Estados do formulário de criação de um "local" (ex.: Emergência, Viagem, Carro...)
  const [novoLocalNome, setNovoLocalNome] = useState("");
  const [novoLocalMeta, setNovoLocalMeta] = useState("");

  // ✅ adicionar dinheiro (vira movimento)
  // Estados do formulário de depósito/adicionar dinheiro em um local
  const [valorAdicionar, setValorAdicionar] = useState("");
  const [origem, setOrigem] = useState("salario"); // origem do dinheiro
  const [localDestinoId, setLocalDestinoId] = useState(""); // local escolhido para receber o depósito

  // ✅ NOVO: retirar dinheiro da reserva (resgate)
  const [valorRetirar, setValorRetirar] = useState("");
  const [motivoRetirar, setMotivoRetirar] = useState("contas"); // motivo do resgate (só pra descrição)
  const [localRetirarId, setLocalRetirarId] = useState(""); // local escolhido para retirar

  // ✅ Mensagem dentro da tela (fechável)
  // Texto exibido no FeedbackBox
  const [mensagem, setMensagem] = useState("");

  // ✅ Modal: reiniciar TUDO da reserva
  // Controle de abrir/fechar modal e texto digitado pra confirmar
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTyping, setResetTyping] = useState("");

  // ✅ Modal: apagar um local
  // Controle de abrir/fechar modal, qual local apagar e texto digitado pra confirmar
  const [delOpen, setDelOpen] = useState(false);
  const [delLocalId, setDelLocalId] = useState("");
  const [delTyping, setDelTyping] = useState("");

  // ✅ NOVO: modais EXTRA (sem remover nada da tela)
  // - você pediu: modais para Adicionar, Retirar, Meta do mês, e Adicionar Local
  const [modalAddOpen, setModalAddOpen] = useState(false);
  const [modalRetOpen, setModalRetOpen] = useState(false);
  const [modalMetaOpen, setModalMetaOpen] = useState(false);
  const [modalNovoLocalOpen, setModalNovoLocalOpen] = useState(false);

  // Garante que locais e movimentos sejam arrays (se vier undefined/null, vira [])
  const locaisRaw = Array.isArray(reserva.locais) ? reserva.locais : [];
  const movimentosRaw = Array.isArray(reserva.movimentos) ? reserva.movimentos : [];

  // ✅ garantir campos novos nos locais antigos (meta/status/doneAt)
  // Normaliza cada "local" para ter sempre:
  // - id, nome, valor numérico
  // - meta numérica
  // - status (ativo/done)
  // - doneAt (data ISO quando foi concluído)
  const locais = useMemo(() => {
    return locaisRaw.map((l) => ({
      id: l.id,
      nome: String(l.nome || "Local"),
      valor: toNum(l.valor),
      meta: toNum(l.meta), // ✅ NOVO
      status: l.status || "ativo", // "ativo" | "done"
      doneAt: l.doneAt || "", // ISO
    }));
  }, [locaisRaw]);

  // Normaliza os movimentos para ter sempre:
  // - id, valor numérico
  // - origem, localId, objetivo
  // - dataHora (ISO)
  const movimentos = useMemo(() => {
    // movimentos antigos continuam; só garantimos estrutura mínima
    return movimentosRaw.map((m) => ({
      id: m.id || generateId(),
      valor: toNum(m.valor),
      origem: m.origem || "outros",
      localId: m.localId || "",
      objetivo: String(m.objetivo || ""),
      dataHora: m.dataHora || new Date().toISOString(),
      // ✅ NOVO (opcional, não quebra nada): tipo do movimento
      // - "entrada" (depósito) | "saida" (retirada)
      tipo: m.tipo || "", // se não existir, fica vazio
    }));
  }, [movimentosRaw]);

  // Função utilitária para atualizar apenas partes do objeto reserva
  // Ex.: atualizarReserva({ locais: novosLocais })
  function atualizarReserva(dados) {
    setReserva({ ...reserva, ...dados });
  }

  // =========================
  // ✅ AUTO-REMOVER LOCAIS "CONCLUÍDOS" após 7 dias
  // - e remove TUDO relacionado (histórico/movimentos daquele local)
  // =========================
  useEffect(() => {
    const now = Date.now(); // timestamp atual
    const toRemoveIds = []; // ids dos locais que devem ser apagados automaticamente

    // Varre todos os locais
    for (const l of locais) {
      // Se está marcado como concluído e tem data de conclusão
      if (l.status === "done" && l.doneAt) {
        const t = new Date(l.doneAt).getTime(); // transforma doneAt em timestamp

        // Se a data for válida e já passou 7 dias ou mais, agenda para remoção
        if (!isNaN(t) && daysBetween(t, now) >= 7) {
          toRemoveIds.push(l.id);
        }
      }
    }

    // Se não tem nada pra remover, sai sem fazer nada
    if (toRemoveIds.length === 0) return;

    // Remove os locais concluídos que passaram de 7 dias
    const novosLocais = locais.filter((l) => !toRemoveIds.includes(l.id));

    // Remove os movimentos que pertenciam aos locais removidos
    const novosMov = movimentos.filter((m) => !toRemoveIds.includes(m.localId));

    // Atualiza o estado global da reserva com os novos arrays
    atualizarReserva({ locais: novosLocais, movimentos: novosMov });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locaisRaw, movimentosRaw]); // observa o que vem do estado real

  // =========================
  // ✅ META POR CICLO (diaPagamento)
  // =========================
  // Pega o dia do pagamento do perfil e transforma em número
  const diaPagamento = Number(profile?.diaPagamento || 0);

  // Calcula o período do ciclo baseado no diaPagamento:
  // Ex.: ciclo do dia 10 até dia 09 do mês seguinte (fim = um dia antes do próximo ciclo)
  const periodoCiclo = useMemo(() => {
    // Se não tiver diaPagamento válido, não existe ciclo automático
    if (!diaPagamento || diaPagamento < 1 || diaPagamento > 31) return null;

    // Define ano/mês pela referência do app (ou pega do Date atual se não tiver)
    const ano = mesReferencia?.ano ?? new Date().getFullYear();
    const mes = mesReferencia?.mes ?? new Date().getMonth();

    // Início do ciclo: diaPagamento no mês atual (ajustando com criarDataCerta)
    const inicio = criarDataCerta(ano, mes, diaPagamento);

    // Início do próximo ciclo: diaPagamento no mês seguinte
    const inicioProx = criarDataCerta(ano, mes + 1, diaPagamento);

    // Fim do ciclo = dia anterior ao próximo ciclo, no final do dia (23:59:59.999)
    const fim = new Date(inicioProx.getTime());
    fim.setDate(fim.getDate() - 1);
    fim.setHours(23, 59, 59, 999);

    return { inicio, fim };
  }, [diaPagamento, mesReferencia?.ano, mesReferencia?.mes]);

  // Soma quanto foi guardado (movimentos) dentro do ciclo calculado
  // ✅ agora inclui retirada (valor negativo) como "net do ciclo" (bem mais correto)
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

  // Meta atual: pega o que está digitado localmente, ou o que já está salvo em reserva.metaMensal
  const metaAtual = toNum(metaMensalLocal || reserva.metaMensal || 0);

  // Porcentagem da meta atingida neste ciclo (limitada a 100%)
  const percMeta = metaAtual > 0 ? Math.min(100, (totalNoCiclo / metaAtual) * 100) : 0;

  // Soma total acumulado em todos os locais (independente do ciclo)
  const totalGuardado = useMemo(
    () => locais.reduce((soma, l) => soma + Number(l.valor || 0), 0),
    [locais]
  );

  // =========================
  // ✅ FUNÇÕES (META MENSAL)
  // =========================
  // Salva a meta mensal (geral) no estado global da reserva
  function salvarMetaMensal(e) {
    e.preventDefault(); // impede reload do form

    const meta = toNum(metaMensalLocal || 0);
    atualizarReserva({ metaMensal: meta });

    setMensagem("Meta mensal salva.");
    // ✅ fecha o modal da meta (sem afetar o form que fica visível)
    setModalMetaOpen(false);
  }

  // =========================
  // ✅ LOCAIS (CRIAR / EDITAR / CONCLUIR / APAGAR)
  // =========================
  // Cria um novo local com nome e meta
  function adicionarLocal(e) {
    e.preventDefault(); // evita reload do form

    // Validação: nome obrigatório
    if (!novoLocalNome.trim()) {
      setMensagem("Digite o nome do local.");
      return;
    }

    // Objeto do novo local
    const novo = {
      id: generateId(),
      nome: novoLocalNome.trim(),
      valor: 0,
      meta: toNum(novoLocalMeta || 0), // ✅ meta do local
      status: "ativo",
      doneAt: "",
    };

    // Adiciona na lista e salva no estado global
    const novos = [...locais, novo];
    atualizarReserva({ locais: novos });

    // Limpa os inputs do formulário
    setNovoLocalNome("");
    setNovoLocalMeta("");

    // Se ainda não tiver um destino selecionado, seleciona o novo local automaticamente
    if (!localDestinoId) setLocalDestinoId(novo.id);

    // ✅ novo: se ainda não tiver um local de retirada selecionado, também seleciona
    if (!localRetirarId) setLocalRetirarId(novo.id);

    setMensagem("Local adicionado.");
    // ✅ fecha modal de novo local (mantendo o formulário visível na tela)
    setModalNovoLocalOpen(false);
  }

  // Atualiza campos de um local específico (patch = pedaços que vão substituir)
  // Ex.: alterarLocalCampo(id, { meta: 5000 })
  function alterarLocalCampo(id, patch) {
    const novos = locais.map((l) => (l.id === id ? { ...l, ...patch } : l));
    atualizarReserva({ locais: novos });
  }

  // Marca um local como concluído ou reabre se já estiver concluído
  function marcarConcluido(id) {
    const alvo = locais.find((l) => l.id === id);
    if (!alvo) return;

    if (alvo.status === "done") {
      // desfazer: volta para ativo e apaga a data de conclusão
      alterarLocalCampo(id, { status: "ativo", doneAt: "" });
      setMensagem("Local reaberto.");
    } else {
      // concluir: marca como done e grava a data (pra contar os 7 dias)
      alterarLocalCampo(id, { status: "done", doneAt: new Date().toISOString() });
      setMensagem("Local marcado como concluído (será removido em 7 dias).");
    }
  }

  // Abre o modal de apagar um local e prepara estados
  function abrirApagarLocal(id) {
    setDelLocalId(id); // guarda qual local vai ser apagado
    setDelTyping(""); // limpa o texto digitado
    setDelOpen(true); // abre modal
  }

  // Confirma apagar local, exigindo digitar "APAGAR"
  function confirmarApagarLocal() {
    if (String(delTyping || "").trim().toUpperCase() !== "APAGAR") {
      setMensagem('Para confirmar, digite "APAGAR".');
      return;
    }

    const id = delLocalId;
    if (!id) return;

    // Remove o local
    const novosLocais = locais.filter((l) => l.id !== id);

    // Remove também todos os movimentos ligados a ele (histórico daquele local)
    const novosMov = movimentos.filter((m) => m.localId !== id); // ✅ apaga tudo relacionado do histórico

    // Salva no estado global
    atualizarReserva({ locais: novosLocais, movimentos: novosMov });

    // Fecha e limpa o modal
    setDelOpen(false);
    setDelLocalId("");
    setDelTyping("");

    setMensagem("Local apagado (e histórico removido).");
  }

  // Retorna o nome do local pelo id (pra mostrar em histórico e no modal)
  function nomeLocal(id) {
    const l = locais.find((x) => x.id === id);
    return l ? l.nome : "Local";
  }

  // Converte a origem em rótulo bonitinho
  function origemLabel(o) {
    if (o === "salario") return "Salário";
    if (o === "pix") return "PIX";
    if (o === "venda") return "Venda";
    if (o === "economia") return "Economia";
    if (o === "resgate") return "Resgate";
    return "Outros";
  }

  // Rótulo do motivo do resgate (só pra descrição)
  function motivoLabel(m) {
    if (m === "contas") return "Pagar contas";
    if (m === "emergencia") return "Emergência";
    if (m === "compra") return "Compra";
    if (m === "outro") return "Outro";
    return "Outro";
  }

  // =========================
  // ✅ ADICIONAR DINHEIRO (MOVIMENTO)
  // =========================
  // Processa o formulário de "Adicionar" (depósito) e registra no local + histórico
  function handleAdicionarReserva(e) {
    e.preventDefault(); // evita reload do form

    const v = toNum(valorAdicionar);

    // Validação do valor
    if (!v || v <= 0) {
      setMensagem("Digite um valor válido.");
      return;
    }

    // Validação do local
    if (!localDestinoId) {
      setMensagem("Selecione o local.");
      return;
    }

    // Confere se o local existe
    const destino = locais.find((l) => l.id === localDestinoId);
    if (!destino) {
      setMensagem("Local inválido.");
      return;
    }

    // Não permite adicionar em local concluído (porque ele está "encerrado")
    if (destino.status === "done") {
      setMensagem("Este local está concluído. Reabra o local para adicionar valores.");
      return;
    }

    // Atualiza o valor do local (soma o depósito no valor atual)
    const novosLocais = locais.map((l) =>
      l.id === localDestinoId ? { ...l, valor: Number(l.valor || 0) + v } : l
    );

    // Cria o movimento (histórico do depósito)
    const movimento = {
      id: generateId(),
      valor: v,
      origem,
      localId: localDestinoId,
      objetivo: "", // ✅ agora não existe mais "Nome do depósito"
      dataHora: new Date().toISOString(),
      tipo: "entrada", // ✅ novo
    };

    // Salva: locais atualizados + novo movimento no topo do histórico
    atualizarReserva({
      locais: novosLocais,
      movimentos: [movimento, ...movimentos],
    });

    // ✅ ADICIONADO: também vira DESPESA "investido" nas transações (desconta do saldo)
    // (sem mexer no resto do app)
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
          origem: origem, // opcional (não atrapalha se seu app ignorar)
        });
      } catch (err) {
        console.error("Falha ao registrar transação de investimento:", err);
      }
    }

    // Limpa inputs do formulário
    setValorAdicionar("");

    setMensagem(`Adicionado: ${formatCurrency(v)}.`);
    // ✅ fecha modal de adicionar (mantendo o formulário visível na tela)
    setModalAddOpen(false);
  }

  // =========================
  // ✅ NOVO: RETIRAR DINHEIRO (RESGATE)
  // - tira do local (diminui o valor guardado)
  // - cria movimento NEGATIVO no histórico (valor = -v)
  // - registra uma "receita" nas transações para devolver ao saldo do app
  // =========================
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

    // Atualiza o valor do local (subtrai)
    const novosLocais = locais.map((l) =>
      l.id === localRetirarId ? { ...l, valor: Math.max(0, Number(l.valor || 0) - v) } : l
    );

    // Movimento NEGATIVO (fica bem claro no histórico)
    const movimento = {
      id: generateId(),
      valor: -v, // ✅ negativo
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

    // ✅ devolve ao saldo como RECEITA
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
    // ✅ fecha modal de retirar (mantendo o formulário visível na tela)
    setModalRetOpen(false);
  }

  // =========================
  // ✅ REINICIAR TODA RESERVA
  // =========================
  // Abre o modal de reset (zerar tudo)
  function abrirReset() {
    setResetTyping("");
    setResetOpen(true);
  }

  // Confirma o reset exigindo digitar "ZERAR"
  function confirmarReset() {
    if (String(resetTyping || "").trim().toUpperCase() !== "ZERAR") {
      setMensagem('Para confirmar, digite "ZERAR".');
      return;
    }

    // Zera locais e movimentos (histórico)
    atualizarReserva({
      locais: [],
      movimentos: [],
      // metaMensal: 0, // se você quiser zerar meta mensal também, descomente
    });

    // Fecha e limpa modal
    setResetOpen(false);
    setResetTyping("");
    setMensagem("Reserva reiniciada (zerada).");
  }

  // =========================
  // ✅ LISTAS (ativos x concluídos)
  // =========================
  const locaisAtivos = locais.filter((l) => l.status !== "done");
  const locaisConcluidos = locais.filter((l) => l.status === "done");

  // ✅ melhora visual: garante seleção inicial em selects quando tiver locais e estiver vazio
  useEffect(() => {
    if (!localDestinoId && locaisAtivos.length > 0) setLocalDestinoId(locaisAtivos[0].id);
    if (!localRetirarId && locaisAtivos.length > 0) setLocalRetirarId(locaisAtivos[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locaisAtivos.length]);

  // Render da página
  return (
    <div className="page">
      {/* Título + botões para abrir modais (sem esconder nada que já existe) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <h2 className="page-title" style={{ margin: 0 }}>
          Reserva
        </h2>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="primary-btn" onClick={() => setModalAddOpen(true)}>
            ➕ Adicionar (Modal)
          </button>

          <button type="button" className="primary-btn" onClick={() => setModalRetOpen(true)}>
            ➖ Retirar (Modal)
          </button>

          <button type="button" className="toggle-btn" onClick={() => setModalMetaOpen(true)}>
            🎯 Meta (Modal)
          </button>

          <button type="button" className="toggle-btn" onClick={() => setModalNovoLocalOpen(true)}>
            📌 Novo Local (Modal)
          </button>

          <button type="button" className="toggle-btn" onClick={abrirReset} title="Reiniciar Reserva">
            ♻️ Reiniciar
          </button>
        </div>
      </div>

      {/* Caixa de feedback (mensagens) */}
      <FeedbackBox text={mensagem} onClose={() => setMensagem("")} />

      {/* ========================= */}
      {/* ✅ MODAL: META DO MÊS (GERAL) */}
      {/* (o card e o form continuam visíveis abaixo; aqui é só um "atalho") */}
      {/* ========================= */}
      {modalMetaOpen ? (
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
                <button type="button" className="toggle-btn" onClick={() => setModalMetaOpen(false)}>
                  Cancelar
                </button>
                <button className="primary-btn" type="submit">
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* ========================= */}
      {/* ✅ MODAL: ADICIONAR */}
      {/* (o card e o form continuam visíveis abaixo; aqui é só um "atalho") */}
      {/* ========================= */}
      {modalAddOpen ? (
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
                <button type="button" className="toggle-btn" onClick={() => setModalAddOpen(false)}>
                  Cancelar
                </button>
                <button className="primary-btn" type="submit">
                  Adicionar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* ========================= */}
      {/* ✅ MODAL: RETIRAR */}
      {/* (o card e o form continuam visíveis abaixo; aqui é só um "atalho") */}
      {/* ========================= */}
      {modalRetOpen ? (
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
                <button type="button" className="toggle-btn" onClick={() => setModalRetOpen(false)}>
                  Cancelar
                </button>
                <button className="primary-btn" type="submit">
                  Retirar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* ========================= */}
      {/* ✅ MODAL: NOVO LOCAL */}
      {/* (o form de novo local continua visível abaixo; aqui é só um "atalho") */}
      {/* ========================= */}
      {modalNovoLocalOpen ? (
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
                <button type="button" className="toggle-btn" onClick={() => setModalNovoLocalOpen(false)}>
                  Cancelar
                </button>
                <button className="primary-btn" type="submit">
                  Adicionar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* ✅ MODAL CONFIRMA RESET */}
      {resetOpen ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Reiniciar reserva?</h3>

            <p className="muted small" style={{ marginTop: 6 }}>
              Isso vai <strong>apagar TODOS os locais</strong> e <strong>todo o histórico</strong> da Reserva.
            </p>

            {/* Campo de confirmação: usuário precisa digitar ZERAR */}
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

            {/* Botões do modal */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" className="toggle-btn" onClick={() => setResetOpen(false)}>
                Cancelar
              </button>

              <button
                type="button"
                className="primary-btn"
                onClick={confirmarReset}
                style={{
                  background: "rgba(239,68,68,.15)",
                  border: "1px solid rgba(239,68,68,.35)",
                }}
              >
                ✅ Sim, zerar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ✅ MODAL CONFIRMA APAGAR LOCAL */}
      {delOpen ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Apagar local?</h3>

            <p className="muted small" style={{ marginTop: 6 }}>
              Isso vai apagar o local <strong>{nomeLocal(delLocalId)}</strong> e{" "}
              <strong>TUDO relacionado no histórico</strong>.
            </p>

            {/* Campo de confirmação: usuário precisa digitar APAGAR */}
            <div className="field" style={{ marginTop: 10 }}>
              <label>Digite APAGAR para confirmar</label>
              <input
                type="text"
                value={delTyping}
                onChange={(e) => setDelTyping(e.target.value)}
                placeholder='Digite: APAGAR'
                autoComplete="off"
              />
            </div>

            {/* Botões do modal */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" className="toggle-btn" onClick={() => setDelOpen(false)}>
                Cancelar
              </button>

              <button
                type="button"
                className="primary-btn"
                onClick={confirmarApagarLocal}
                style={{
                  background: "rgba(239,68,68,.15)",
                  border: "1px solid rgba(239,68,68,.35)",
                }}
              >
                🗑️ Apagar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ✅ MELHORIA VISUAL: RESUMO (organizado) */}
      <div className="card" style={{ marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div>
            <h3 style={{ marginBottom: 4 }}>Resumo</h3>
            <p className="muted small" style={{ marginTop: 0 }}>
              Visão rápida da sua reserva e da meta do ciclo.
            </p>
          </div>
        </div>

        {/* Período do ciclo */}
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
          <div style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, padding: 12 }}>
            <div className="muted small">Total guardado (acumulado)</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{formatCurrency(totalGuardado)}</div>
          </div>

          <div style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, padding: 12 }}>
            <div className="muted small">Guardado neste ciclo (líquido)</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{formatCurrency(totalNoCiclo)}</div>
          </div>

          <div style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, padding: 12 }}>
            <div className="muted small">Meta do ciclo</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{formatCurrency(metaAtual)}</div>

            {metaAtual > 0 ? (
              <div className="progress-container" style={{ marginTop: 10 }}>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${percMeta.toFixed(0)}%` }} />
                </div>
                <span className="progress-label">{percMeta.toFixed(0)}%</span>
              </div>
            ) : (
              <div className="muted small" style={{ marginTop: 10 }}>
                Defina a meta para ver o progresso.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ✅ META MENSAL (VISÍVEL) — permanece como você tinha */}
      <div className="card mt">
        {/* Cabeçalho + botão reiniciar */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div>
            <h3>Meta do mês (geral)</h3>
            <p className="muted small">Quanto você quer guardar no mês (no ciclo do pagamento).</p>
          </div>

          {/* Abre o modal de meta (sem remover o form visível) */}
          <button type="button" className="toggle-btn" onClick={() => setModalMetaOpen(true)} title="Editar Meta em Modal">
            🎯 Meta (Modal)
          </button>
        </div>

        {/* Exibe período do ciclo se estiver configurado; senão, orienta a configurar no Perfil */}
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

        {/* Form de salvar a meta mensal */}
        <form className="form" onSubmit={salvarMetaMensal}>
          <div className="field">
            <label>Meta (R$)</label>
            <input
              type="number"
              step="0.01"
              value={metaMensalLocal}
              onChange={(e) => setMetaMensalLocal(e.target.value)}
            />
          </div>

          <button className="primary-btn" type="submit">
            Salvar
          </button>
        </form>
      </div>

      {/* ✅ LOCAIS — separado em um card próprio (como você pediu “separe Locais”) */}
      <div className="card mt">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Locais</h3>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="toggle-btn" onClick={() => setModalNovoLocalOpen(true)}>
              📌 Novo Local (Modal)
            </button>
          </div>
        </div>

        <p className="muted small" style={{ marginTop: 6 }}>
          Cada local tem sua <strong>meta</strong>, o <strong>quanto já foi investido</strong> e o{" "}
          <strong>quanto falta</strong>.
        </p>

        {/* Ativos */}
        <div style={{ marginTop: 10 }}>
          <h4 style={{ marginBottom: 6 }}>Ativos</h4>

          {locaisAtivos.length === 0 ? (
            <p className="muted small">Adicione um local primeiro.</p>
          ) : (
            <ul className="list">
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
                        <label>Meta do local (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={l.meta}
                          onChange={(e) => alterarLocalCampo(l.id, { meta: toNum(e.target.value) })}
                        />
                      </div>

                      <div className="field" style={{ margin: 0 }}>
                        <label>Já investido (R$)</label>
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
        </div>

        {/* ✅ Form para criar novo local (VISÍVEL) — você pediu para manter os existentes a mostra */}
        <form className="form" onSubmit={adicionarLocal} style={{ marginTop: 12 }}>
          <div className="field">
            <label>Novo local</label>
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

          <button className="primary-btn" type="submit">
            Adicionar
          </button>
        </form>

        {/* Concluídos */}
        {locaisConcluidos.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <h4 style={{ marginBottom: 6 }}>Concluídos</h4>

            <p className="muted small">Concluídos ficam ocultos e serão removidos automaticamente após 7 dias.</p>

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

      {/* ✅ ADICIONAR (VISÍVEL) — mantém como já existia, e agora também tem modal */}
      <div className="card mt">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Adicionar</h3>

          <button type="button" className="toggle-btn" onClick={() => setModalAddOpen(true)}>
            ➕ Abrir modal
          </button>
        </div>

        <form className="form" onSubmit={handleAdicionarReserva}>
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

          <button className="primary-btn" type="submit">
            Adicionar
          </button>
        </form>

        <p className="muted small" style={{ marginTop: 10 }}>
          Ao adicionar, o app registra uma <strong>despesa “investido”</strong> para descontar do saldo.
        </p>
      </div>

      {/* ✅ RETIRAR (VISÍVEL) — mantém como já existia, e agora também tem modal */}
      <div className="card mt">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Retirar</h3>

          <button type="button" className="toggle-btn" onClick={() => setModalRetOpen(true)}>
            ➖ Abrir modal
          </button>
        </div>

        <form className="form" onSubmit={handleRetirarReserva}>
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

          <button className="primary-btn" type="submit">
            Retirar
          </button>
        </form>

        <p className="muted small" style={{ marginTop: 10 }}>
          Ao retirar, o app cria um movimento <strong>negativo</strong> no histórico e registra uma{" "}
          <strong>receita</strong> “resgate_reserva” para devolver ao saldo.
        </p>
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
          ✅ Regras que você pediu:
          <br />• Se você <strong>apagar um local</strong>, some tudo ligado a ele (inclusive no histórico).
          <br />• Se você <strong>marcar como concluído</strong>, ele fica oculto e é removido após 7 dias (com histórico).
          <br />• Cada local tem <strong>meta</strong>, <strong>investido</strong> e <strong>quanto falta</strong>.
          <br />• ✅ Agora você também tem <strong>MODAIS</strong> para: Adicionar, Retirar, Meta e Novo Local — e os formulários{" "}
          <strong>continuam visíveis</strong>.
        </p>
      </div>
    </div>
  );
}
