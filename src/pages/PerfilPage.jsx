// ✅ Arquivo: src/pages/PerfilPage.jsx
// ✅ Objetivo desta página: mostrar dados do usuário, permitir editar campos do perfil,
// ✅ cadastrar/gerenciar gastos fixos, registrar salário como receita do mês,
// ✅ fazer logout e “inicializar” (apagar dados do Firestore + limpar caches locais).

// Importa React (para componentes e hooks via React.useState / React.useMemo)
import React from "react";
// Importa o contexto financeiro do App (profile, atualizarProfile, adicionarTransacao)
import { useFinance } from "../App.jsx";
// Importa auth (usuário logado), logout (sair) e db (Firestore)
import { auth, logout, db } from "../firebase";
// Importa funções do Firestore para apontar documento e apagar documento
import { doc, deleteDoc } from "firebase/firestore";

// Exporta a página de perfil como componente padrão
export default function PerfilPage() {
  // Pega do contexto:
  // - profile: dados do perfil (nome, idade, sexo, limiteGastoMensal, diaPagamento, gastosFixos etc.)
  // - atualizarProfile: função para atualizar profile no estado/banco
  // - adicionarTransacao: função para criar transações (receita/despesa/pagamentos etc.)
  const { profile, atualizarProfile, adicionarTransacao } = useFinance();

  // Pega o usuário logado atual do Firebase Auth
  const user = auth.currentUser;

  // salário digitado para registrar como receita do mês
  // Estado do input do salário (campo separado que vira uma transação ao clicar no botão)
  const [salarioInput, setSalarioInput] = React.useState("");

  // =========================
  // FEEDBACK NA TELA
  // =========================
  // tipo: "success" | "error" | "info"
  // Estado para guardar feedback visual (tipo/título/mensagem)
  const [feedback, setFeedback] = React.useState(null);

  // confirmação interna (substitui confirm())
  // Estado para guardar um “modal de confirmação” (título/mensagem e a ação a executar)
  const [confirmBox, setConfirmBox] = React.useState(null);

  // Abre o feedback na tela (define tipo, título e mensagem)
  const abrirFeedback = (tipo, titulo, mensagem) => {
    setFeedback({ tipo, titulo, mensagem });
  };

  // Fecha o feedback (remove a caixa da tela)
  const fecharFeedback = () => setFeedback(null);

  // Pede confirmação exibindo modal e guardando o que fazer se confirmar
  const pedirConfirmacao = ({ titulo, mensagem, onConfirm }) => {
    setConfirmBox({ titulo, mensagem, onConfirm });
  };

  // Cancela/fecha o modal de confirmação
  const cancelarConfirmacao = () => setConfirmBox(null);

  // Executa a ação confirmada (onConfirm) de forma segura (try/catch)
  const confirmarAcao = async () => {
    if (!confirmBox?.onConfirm) return;
    const fn = confirmBox.onConfirm;
    setConfirmBox(null);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      abrirFeedback("error", "Erro", "Não foi possível concluir a ação.");
    }
  };

  // =========================
  // GASTOS FIXOS
  // =========================
  // Data atual (usada para calcular qual mês está sendo editado)
  const hoje = new Date();

  // Chave do mês atual no formato YYYY-MM (ex.: 2026-01)
  const chaveMes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(
    2,
    "0"
  )}`;

  // Garante que gastosFixos seja um array (se vier vazio/errado, vira [])
  const gastosFixos = Array.isArray(profile.gastosFixos) ? profile.gastosFixos : [];

  // Estados do formulário para cadastrar um novo gasto fixo
  const [gfNome, setGfNome] = React.useState("");
  const [gfValor, setGfValor] = React.useState("");
  const [gfCategoria, setGfCategoria] = React.useState("essencial");

  // Estados de edição de gasto fixo (qual item está sendo editado e o valor digitado)
  const [editId, setEditId] = React.useState(null);
  const [editValor, setEditValor] = React.useState("");

  // Converte valores digitados para número, aceitando vírgula e evitando NaN
  const normalizarNumero = (v) => {
    if (v === null || v === undefined) return 0;
    const num = Number(String(v).replace(",", "."));
    return Number.isFinite(num) ? num : 0;
  };

  // ✅ (ADICIONADO) formata moeda BRL
  const formatarBRL = (n) =>
    Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // ✅ (ADICIONADO) total de gastos fixos ativos do mês atual (chaveMes)
  const totalGastosFixosMes = React.useMemo(() => {
    return gastosFixos.reduce((soma, g) => {
      if (g?.ativo === false) return soma;
      const v = g?.valoresPorMes?.[chaveMes];
      return soma + normalizarNumero(v);
    }, 0);
  }, [gastosFixos, chaveMes]);

  // Gera ID único para gasto fixo (tenta crypto.randomUUID, se falhar usa fallback)
  const gerarId = () => {
    try {
      return crypto.randomUUID();
    } catch {
      return "gf_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
    }
  };

  // Adiciona um novo gasto fixo ao profile.gastosFixos
  const adicionarGastoFixo = () => {
    const nome = (gfNome || "").trim();
    const valor = normalizarNumero(gfValor);

    // Valida nome
    if (!nome) {
      abrirFeedback("error", "Faltou algo", "Digite um nome para o gasto fixo.");
      return;
    }
    // Valida valor
    if (!valor || valor <= 0) {
      abrirFeedback(
        "error",
        "Valor inválido",
        "Digite um valor válido para o gasto fixo."
      );
      return;
    }

    // Regra: Educação NÃO entra como gasto fixo automático
    if ((gfCategoria || "").toLowerCase() === "educacao") {
      abrirFeedback(
        "error",
        "Não permitido",
        "Gastos de Educação não entram como gasto fixo automático."
      );
      return;
    }
    if (nome.toLowerCase() === "educação" || nome.toLowerCase() === "educacao") {
      abrirFeedback(
        "error",
        "Não permitido",
        "Gastos de Educação não entram como gasto fixo automático."
      );
      return;
    }

    // Monta objeto do gasto fixo:
    // - ativo: controla se aparece/entra nos cálculos
    // - valoresPorMes: guarda o valor por mês (chave YYYY-MM -> valor)
    const novo = {
      id: gerarId(),
      nome,
      categoria: gfCategoria,
      ativo: true,
      valoresPorMes: {
        [chaveMes]: valor,
      },
    };

    // Atualiza o profile adicionando o novo gasto fixo no array
    atualizarProfile({ gastosFixos: [...gastosFixos, novo] });

    // Limpa formulário e mostra feedback
    setGfNome("");
    setGfValor("");
    setGfCategoria("essencial");
    abrirFeedback("success", "Pronto!", "Gasto fixo adicionado com sucesso.");
  };

  // Inicia edição do valor do gasto fixo para o mês atual (chaveMes)
  const iniciarEdicao = (g) => {
    setEditId(g.id);
    const v = g?.valoresPorMes?.[chaveMes];
    setEditValor(v != null ? String(v) : "");
  };

  // Cancela edição (fecha modo edição e limpa campo)
  const cancelarEdicao = () => {
    setEditId(null);
    setEditValor("");
  };

  // Salva o valor editado do mês atual dentro de valoresPorMes[chaveMes]
  const salvarEdicaoValor = (id) => {
    const valor = normalizarNumero(editValor);
    if (!valor || valor <= 0) {
      abrirFeedback("error", "Valor inválido", "Digite um valor válido.");
      return;
    }

    // Cria nova lista, alterando apenas o item com o id informado
    const novaLista = gastosFixos.map((g) => {
      if (g.id !== id) return g;

      const valoresPorMes = { ...(g.valoresPorMes || {}) };
      valoresPorMes[chaveMes] = valor;

      return { ...g, valoresPorMes };
    });

    // Atualiza profile com a nova lista e sai do modo edição
    atualizarProfile({ gastosFixos: novaLista });
    cancelarEdicao();
    abrirFeedback("success", "Atualizado!", "Valor atualizado para este mês (e próximos).");
  };

  // Alterna ativo/desativado do gasto fixo
  const alternarAtivo = (id) => {
    const novaLista = gastosFixos.map((g) =>
      g.id === id ? { ...g, ativo: g.ativo === false ? true : false } : g
    );
    atualizarProfile({ gastosFixos: novaLista });
    abrirFeedback("info", "Ok", "Status do gasto fixo atualizado.");
  };

  // Remove gasto fixo, mas antes pede confirmação (modal)
  const removerGastoFixo = (id) => {
    const g = gastosFixos.find((x) => x.id === id);
    pedirConfirmacao({
      titulo: "Remover gasto fixo?",
      mensagem: `Tem certeza que deseja remover "${g?.nome || "este gasto"}"?`,
      onConfirm: () => {
        const novaLista = gastosFixos.filter((x) => x.id !== id);
        atualizarProfile({ gastosFixos: novaLista });
        abrirFeedback("success", "Removido", "Gasto fixo removido com sucesso.");
      },
    });
  };

  // Factory de handler para inputs do profile (atualiza um campo do profile conforme digita)
  const handleChange = (campo) => (e) => {
    atualizarProfile({ [campo]: e.target.value });
  };

  // Faz logout do Firebase (sair/trocar conta)
  const handleLogout = async () => {
    try {
      abrirFeedback("info", "Saindo...", "Encerrando a sessão da sua conta Google.");
      await logout();
    } catch (err) {
      console.error(err);
      abrirFeedback("error", "Erro", "Erro ao sair da conta Google.");
    }
  };

  // Registra o salário digitado como transação de receita no momento atual
  const registrarSalarioMes = () => {
    if (!salarioInput) {
      abrirFeedback("error", "Faltou algo", "Digite um valor para o salário.");
      return;
    }

    const valor = Number(salarioInput.replace(",", "."));
    if (!valor || valor <= 0) {
      abrirFeedback("error", "Valor inválido", "Digite um valor válido para o salário.");
      return;
    }

    // Cria uma transação do tipo receita com categoria "salario-fixo"
    adicionarTransacao({
      tipo: "receita",
      descricao: "Salário do mês",
      valor,
      dataHora: new Date().toISOString(),
      categoria: "salario-fixo",
      formaPagamento: "outros",
    });

    // Limpa input e mostra feedback
    setSalarioInput("");
    abrirFeedback("success", "Pronto!", "Salário deste mês registrado com sucesso!");
  };

  // =========================
  // ✅ AÇÃO REAL: APAGAR TUDO (Firestore + caches)
  // =========================
  // Apaga o documento do usuário no Firestore e limpa dados locais do app
  const executarInicializacao = async () => {
    // Bloqueia se não estiver logada
    if (!auth.currentUser) {
      abrirFeedback("error", "Erro", "Você precisa estar logada para inicializar.");
      return;
    }
    // Bloqueia se estiver sem internet (precisa para apagar do Firestore)
    if (!navigator.onLine) {
      abrirFeedback(
        "error",
        "Sem internet",
        "Para apagar do banco você precisa estar com internet."
      );
      return;
    }

    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, "users", uid);

    abrirFeedback("info", "Aguarde...", "Apagando seus dados do banco e limpando o cache...");

    // 1) Apaga do Firestore
    await deleteDoc(userDocRef);

    // 2) Limpa caches locais (chaves usadas no App.jsx)
    try {
      localStorage.removeItem(`profile_${uid}`);
      localStorage.removeItem(`transacoes_${uid}`);
      localStorage.removeItem(`cartoes_${uid}`);
      localStorage.removeItem(`reserva_${uid}`);
      localStorage.removeItem(`pendingSync_${uid}`);

      // chaves de outras páginas (se você usa local)
      localStorage.removeItem("pwa_listas_v2");
      localStorage.removeItem("pwa_lembretes_v1");
    } catch (e) {
      console.warn("Falha ao limpar localStorage:", e);
    }

    // 3) remove desbloqueio do PIN (se existir)
    try {
      sessionStorage.removeItem(`pwa_unlocked_${uid}`);
    } catch {}

    // Feedback final e recarrega a página para reiniciar o app “zerado”
    abrirFeedback("success", "Pronto!", "App inicializado. Recarregando...");

    setTimeout(() => window.location.reload(), 600);
  };

  // =========================
  // ✅ 3 CONFIRMAÇÕES (3 modais)
  // =========================
  // Fluxo de segurança: pede 3 confirmações antes de apagar tudo de verdade
  const inicializarApp3x = () => {
    pedirConfirmacao({
      titulo: "1/3 — Você tem certeza?",
      mensagem: "Isso vai APAGAR tudo do banco de dados e zerar o app.",
      onConfirm: async () => {
        pedirConfirmacao({
          titulo: "2/3 — Tem certeza MESMO?",
          mensagem: "Depois disso não dá pra recuperar seus dados. Continuar?",
          onConfirm: async () => {
            pedirConfirmacao({
              titulo: "3/3 — Última confirmação!",
              mensagem: "Confirma que quer iniciar do zero agora?",
              onConfirm: executarInicializacao,
            });
          },
        });
      },
    });
  };

  // estilos simples para o “feche data” (card)
  // Calcula (memoizado) o estilo do card de feedback de acordo com o tipo (success/error/info)
  const feedbackStyle = React.useMemo(() => {
    if (!feedback) return null;
    const base = {
      border: "1px solid rgba(31, 41, 55, 0.55)",
      background: "rgba(17, 24, 39, 0.92)",
      padding: 12,
      borderRadius: 12,
      marginBottom: 12,
    };
    const colors = {
      success: { borderColor: "rgba(34,197,94,0.6)" },
      error: { borderColor: "rgba(248,113,113,0.7)" },
      info: { borderColor: "rgba(96,165,250,0.6)" },
    };
    return { ...base, ...(colors[feedback.tipo] || {}) };
  }, [feedback]);

  // Render do componente
  return (
    <div className="page">
      <h2 className="page-title">Perfil</h2>

      {/* ✅ FEEDBACK NA TELA */}
      {feedback && (
        <div className="card" style={feedbackStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <strong style={{ display: "block", marginBottom: 4 }}>{feedback.titulo}</strong>
              <span className="muted small">{feedback.mensagem}</span>
            </div>
            <button type="button" className="toggle-btn" onClick={fecharFeedback}>
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* ✅ CONFIRMAÇÃO NA TELA (modal) */}
      {confirmBox && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>{confirmBox.titulo}</h3>
            <p className="muted small" style={{ marginTop: 6 }}>
              {confirmBox.mensagem}
            </p>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="toggle-btn" onClick={cancelarConfirmacao}>
                Cancelar
              </button>
              <button type="button" className="primary-btn" onClick={confirmarAcao}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONTA GOOGLE */}
      <div className="card profile-card">
        <h3>Conta Google</h3>

        {user ? (
          <>
            <div className="avatar-wrapper" style={{ marginBottom: 8 }}>
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || "Avatar"}
                  className="avatar-img"
                />
              ) : (
                <span className="avatar-placeholder">
                  {user.displayName ? user.displayName[0].toUpperCase() : "?"}
                </span>
              )}
            </div>

            <p className="small">
              <strong>{user.displayName || "Usuário sem nome"}</strong>
              <br />
              <span className="muted">{user.email}</span>
            </p>

            <button
              type="button"
              className="primary-btn"
              style={{ marginTop: 10 }}
              onClick={handleLogout}
            >
              Sair / Trocar de conta
            </button>

            <p className="muted small" style={{ marginTop: 6 }}>
              Para entrar com outra conta Google, saia e faça login de novo na tela inicial.
            </p>
          </>
        ) : (
          <p className="muted small">Nenhuma conta Google conectada no momento.</p>
        )}
      </div>

      {/* ✅ INICIALIZAR APP (3x confirmação) */}
      <div className="card mt">
        <h3>Inicializar app</h3>
        <p className="muted small">
          Isso apaga <strong>tudo</strong> do banco (Firestore) e limpa o cache local deste
          dispositivo. Use só se quiser começar do zero.
        </p>

        <button
          type="button"
          className="primary-btn"
          onClick={inicializarApp3x}
          style={{
            marginTop: 10,
            background: "rgba(239,68,68,.15)",
            border: "1px solid rgba(239,68,68,.35)",
          }}
        >
          🧨 Inicializar (apagar tudo)
        </button>
      </div>

      {/* DADOS DO PERFIL FINANCEIRO */}
      <div className="card mt">
        <h3>Dados pessoais</h3>

        <div className="field">
          <label>Nome</label>
          <input
            type="text"
            value={profile.nome || ""}
            onChange={handleChange("nome")}
            placeholder="Seu nome"
          />
        </div>

        <div className="field">
          <label>Idade</label>
          <input
            type="number"
            min="0"
            max="120"
            value={profile.idade || ""}
            onChange={handleChange("idade")}
            placeholder="Ex.: 17"
          />
        </div>

        <div className="field">
          <label>Sexo</label>
          <select value={profile.sexo || ""} onChange={handleChange("sexo")}>
            <option value="">Selecione...</option>
            <option value="Feminino">Feminino</option>
            <option value="Masculino">Masculino</option>
            <option value="Outro">Outro</option>
            <option value="Prefiro não dizer">Prefiro não dizer</option>
          </select>
        </div>
      </div>

      {/* CONFIGURAÇÕES FINANCEIRAS */}
      <div className="card mt">
        <h3>Configurações financeiras</h3>

        <div className="field">
          <label>Limite de gasto mensal (R$)</label>
          <input
            type="number"
            step="0.01"
            value={profile.limiteGastoMensal || ""}
            onChange={handleChange("limiteGastoMensal")}
          />
        </div>

        <div className="field">
          <label>Dia que você recebe (pode ser “5º dia útil” ou “15”)</label>
          <input
            type="text"
            value={profile.diaPagamento || ""}
            onChange={handleChange("diaPagamento")}
            placeholder="Ex.: 5º dia útil"
          />
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>Salário deste mês (R$)</label>
          <input
            type="number"
            step="0.01"
            value={salarioInput}
            onChange={(e) => setSalarioInput(e.target.value)}
            placeholder="Ex.: 1200"
          />

          <button
            type="button"
            className="primary-btn"
            style={{ marginTop: 8 }}
            onClick={registrarSalarioMes}
          >
            Registrar salário deste mês
          </button>

          <p className="muted small" style={{ marginTop: 6 }}>
            Cada salário registrado conta como receita só desse mês. Alterar depois não muda os meses
            anteriores.
          </p>
        </div>
      </div>

      {/* GASTOS FIXOS */}
      <div className="card mt">
        <h3>Gastos fixos</h3>

        <p className="muted small" style={{ marginBottom: 10 }}>
          Você está cadastrando/alterando o valor para: <strong>{chaveMes}</strong>
          <br />
          Se mudar o valor, só muda este mês e os próximos (meses antigos não mudam).
        </p>

        {/* ✅ (ADICIONADO) TOTAL DOS GASTOS FIXOS DO MÊS */}
        <div className="card" style={{ marginBottom: 10 }}>
          <p className="muted small" style={{ margin: 0 }}>
            Total de gastos fixos (ativos) em <strong>{chaveMes}</strong>:{" "}
            <strong>{formatarBRL(totalGastosFixosMes)}</strong>
          </p>
        </div>

        <div className="field">
          <label>Nome do gasto fixo</label>
          <input
            type="text"
            value={gfNome}
            onChange={(e) => setGfNome(e.target.value)}
            placeholder="Ex.: Aluguel, Internet..."
          />
        </div>

        <div className="field">
          <label>Valor (R$)</label>
          <input
            type="number"
            step="0.01"
            value={gfValor}
            onChange={(e) => setGfValor(e.target.value)}
            placeholder="Ex.: 250"
          />
        </div>

        <div className="field">
          <label>Categoria</label>
          <select value={gfCategoria} onChange={(e) => setGfCategoria(e.target.value)}>
            <option value="essencial">Essencial</option>
            <option value="lazer">Lazer</option>
          </select>

          <button
            type="button"
            className="primary-btn"
            style={{ marginTop: 8 }}
            onClick={adicionarGastoFixo}
          >
            Adicionar gasto fixo
          </button>

          <p className="muted small" style={{ marginTop: 6 }}>
            Educação não entra como gasto fixo automático.
          </p>
        </div>

        {gastosFixos.length === 0 ? (
          <p className="muted small">Nenhum gasto fixo cadastrado.</p>
        ) : (
          <ul className="list">
            {gastosFixos.map((g) => {
              const ativo = g.ativo !== false;
              const valorMes = g?.valoresPorMes?.[chaveMes];

              return (
                <li
                  key={g.id}
                  className="list-item"
                  style={{ flexDirection: "column", alignItems: "stretch" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span>
                      <strong>{g.nome}</strong>{" "}
                      <span className="muted small">
                        ({g.categoria || "sem categoria"}) {ativo ? "" : "— desativado"}
                      </span>
                    </span>
                    <span className="muted small">
                      valor deste mês:{" "}
                      <strong>
                        {valorMes != null ? `R$ ${Number(valorMes).toFixed(2)}` : "não definido"}
                      </strong>
                    </span>
                  </div>

                  {editId === g.id ? (
                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input
                        type="number"
                        step="0.01"
                        value={editValor}
                        onChange={(e) => setEditValor(e.target.value)}
                        placeholder="Novo valor"
                        style={{ flex: "1 1 160px" }}
                      />
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={() => salvarEdicaoValor(g.id)}
                      >
                        Salvar valor
                      </button>
                      <button type="button" className="toggle-btn" onClick={cancelarEdicao}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="toggle-btn" onClick={() => iniciarEdicao(g)}>
                        Alterar valor do mês
                      </button>

                      <button
                        type="button"
                        className="toggle-btn"
                        onClick={() => alternarAtivo(g.id)}
                      >
                        {ativo ? "Desativar" : "Ativar"}
                      </button>

                      <button
                        type="button"
                        className="toggle-btn"
                        onClick={() => removerGastoFixo(g.id)}
                      >
                        Remover
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
