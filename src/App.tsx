// src/App.jsx
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
} from "react";
import "./styles/global.css";

import FinancasPage from "./pages/FinancasPage.jsx";
import TransacoesPage from "./pages/TransacoesPage.jsx";
import CartoesPage from "./pages/CartoesPage.jsx";
import HistoricoPage from "./pages/HistoricoPage.jsx";
import PerfilPage from "./pages/PerfilPage.jsx";
import ReservaPage from "./pages/ReservaPage.jsx";

// ✅ NOVAS PÁGINAS
import ListaPage from "./pages/ListaPage.jsx";
import LembretesPage from "./pages/LembretesPage.jsx";
import TrabalhoPage from "./pages/TrabalhoPage.jsx";
import ReceitasPage from "./pages/ReceitasPage.jsx";

// 🔐 Firebase (login Google + banco de dados)
import { auth, loginComGoogle, logout, db } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot, setDoc, getDoc } from "firebase/firestore";

/* ---------------- CONTEXTO DE FINANÇAS ---------------- */

const FinanceContext = createContext(null);

export function useFinance() {
  return useContext(FinanceContext);
}

/* Helpers para localStorage */
function loadFromStorage(key, defaultValue) {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return defaultValue;
    return JSON.parse(raw);
  } catch (e) {
    console.error("Erro ao ler storage:", key, e);
    return defaultValue;
  }
}

function saveToStorage(key, value) {
  if (typeof window === "undefined") return;
  try {
    if (value === null || value === undefined) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (e) {
    console.error("Erro ao salvar storage:", key, e);
  }
}

function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/* ✅ (NOVO) Regras de “virar o mês” no dia de pagamento (inclui “dia útil”) */
function getNthBusinessDayDate(year, monthIndex, n) {
  let count = 0;
  const d = new Date(year, monthIndex, 1);
  while (d.getMonth() === monthIndex) {
    const day = d.getDay(); // 0 dom, 6 sáb
    const isBusinessDay = day !== 0 && day !== 6; // seg-sex
    if (isBusinessDay) {
      count++;
      if (count === n) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    d.setDate(d.getDate() + 1);
  }
  return null;
}

function parseDiaPagamentoToRule(diaPagamentoRaw) {
  const s = String(diaPagamentoRaw || "").trim().toLowerCase();

  // Ex.: "5º dia útil", "5 dia util", "5º dia util"
  if (s.includes("dia util") || s.includes("dia útil")) {
    const m = s.match(/(\d+)/);
    const n = m ? Number(m[1]) : NaN;
    if (Number.isFinite(n) && n >= 1 && n <= 31) return { kind: "businessDay", n };
  }

  // Ex.: "10", "dia 10"
  const m2 = s.match(/(\d+)/);
  const day = m2 ? Number(m2[1]) : NaN;
  if (Number.isFinite(day) && day >= 1 && day <= 31) return { kind: "dayOfMonth", day };

  return null;
}

/* Valores padrão */
const DEFAULT_PROFILE = {
  nome: "",
  rendaMensal: "",
  limiteGastoMensal: "",
  metaReservaMensal: "",
  reservaAcumulada: "",
  diaPagamento: "",
  avatarBase64: "",
};

const DEFAULT_RESERVA = {
  metaMensal: 0,
  locais: [],
  movimentos: [],
};

/* ---------------- COMPONENTE PRINCIPAL ---------------- */

export default function App() {
  // 🔐 Usuário logado (Google)
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // 🔁 FLAG: já carreguei dados iniciais (nuvem/local) pra este usuário?
  const [dadosCarregados, setDadosCarregados] = useState(false);

  // Perfil
  const [profile, setProfile] = useState(DEFAULT_PROFILE);

  // Transações
  const [transacoes, setTransacoes] = useState([]);

  // Cartões
  const [cartoes, setCartoes] = useState([]);

  // Reserva
  const [reserva, setReserva] = useState(DEFAULT_RESERVA);

  // 🔄 MÊS DE REFERÊNCIA GLOBAL
  const hoje = new Date();
  const [mesReferencia, setMesReferencia] = useState({
    mes: hoje.getMonth(),
    ano: hoje.getFullYear(),
  });

  const irParaMesAtual = () => {
    const h = new Date();
    setMesReferencia({ mes: h.getMonth(), ano: h.getFullYear() });
  };

  const mudarMesReferencia = (delta) => {
    setMesReferencia((prev) => {
      let novoMes = prev.mes + delta;
      let novoAno = prev.ano;

      if (novoMes < 0) {
        novoMes = 11;
        novoAno--;
      } else if (novoMes > 11) {
        novoMes = 0;
        novoAno++;
      }

      return { mes: novoMes, ano: novoAno };
    });
  };

  // ✅ (NOVO) “Vira o mês” automaticamente no dia de pagamento:
  // - se for "5º dia útil": antes dele fica no mês anterior; no dia/apos ele fica no mês atual
  // - se for dia fixo: mesma lógica
  useEffect(() => {
    const rule = parseDiaPagamentoToRule(profile?.diaPagamento);
    if (!rule) return;

    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();

    let payday = null;

    if (rule.kind === "businessDay") {
      payday = getNthBusinessDayDate(y, m, rule.n);
    } else if (rule.kind === "dayOfMonth") {
      const lastDay = new Date(y, m + 1, 0).getDate();
      const dd = Math.min(lastDay, rule.day);
      payday = new Date(y, m, dd);
    }

    if (!payday) return;

    const shouldBe =
      today < payday
        ? { mes: (m + 11) % 12, ano: m === 0 ? y - 1 : y }
        : { mes: m, ano: y };

    setMesReferencia((prev) => {
      if (prev?.mes === shouldBe.mes && prev?.ano === shouldBe.ano) return prev;
      return shouldBe;
    });
  }, [profile?.diaPagamento]);

  // ✅ Aba atual geral
  const [abaAtiva, setAbaAtiva] = useState("financas");

  // ✅ MENU ⋯
  const [menuMaisAberto, setMenuMaisAberto] = useState(false);

  // ✅ Itens do ⋯: somente estes 5
  const itensMenuMais = useMemo(
    () => [
      { key: "financas", label: "💰 Finanças" },
      { key: "lista", label: "🛒 Lista" },
      { key: "lembretes", label: "⏰ Lembretes" },
      { key: "receitas", label: "🍳 Receitas" },
      { key: "trabalho", label: "💼 Trabalho" },
    ],
    []
  );

  function abrirAbaPeloMenuMais(key) {
    setAbaAtiva(key);
    setMenuMaisAberto(false);
  }

  // ✅ Grupo que DEVE mostrar o menu inferior (Finanças + subpáginas)
  const mostrarMenuInferior = useMemo(() => {
    return ["financas", "reserva", "transacoes", "cartoes", "historico", "perfil"].includes(
      abaAtiva
    );
  }, [abaAtiva]);

  /* ------- MONITORA LOGIN / LOGOUT ------- */

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser || null);
      setAuthLoading(false);
      setDadosCarregados(false);
    });

    return () => unsub();
  }, []);

  /* ------- 1) CARREGAR DADOS ------- */

  useEffect(() => {
    if (!user) return;

    let unsubSnapshot = null;

    (async () => {
      const uid = user.uid;
      const userDocRef = doc(db, "users", uid);

      try {
        const snap = await getDoc(userDocRef);

        if (snap.exists()) {
          const data = snap.data();

          const perfilCloud = data.profile || DEFAULT_PROFILE;
          const transacoesCloud = data.transacoes || [];
          const cartoesCloud = data.cartoes || [];
          const reservaCloud = data.reserva || DEFAULT_RESERVA;

          setProfile(perfilCloud);
          setTransacoes(transacoesCloud);
          setCartoes(cartoesCloud);
          setReserva(reservaCloud);

          saveToStorage(`profile_${uid}`, perfilCloud);
          saveToStorage(`transacoes_${uid}`, transacoesCloud);
          saveToStorage(`cartoes_${uid}`, cartoesCloud);
          saveToStorage(`reserva_${uid}`, reservaCloud);
        } else {
          const storedProfile = loadFromStorage(`profile_${uid}`, null);
          const storedTransacoes = loadFromStorage(`transacoes_${uid}`, null);
          const storedCartoes = loadFromStorage(`cartoes_${uid}`, null);
          const storedReserva = loadFromStorage(`reserva_${uid}`, null);

          const perfilInicial = storedProfile || DEFAULT_PROFILE;
          const transacoesIniciais = storedTransacoes || [];
          const cartoesIniciais = storedCartoes || [];
          const reservaInicial = storedReserva || DEFAULT_RESERVA;

          setProfile(perfilInicial);
          setTransacoes(transacoesIniciais);
          setCartoes(cartoesIniciais);
          setReserva(reservaInicial);

          await setDoc(
            userDocRef,
            {
              profile: perfilInicial,
              transacoes: transacoesIniciais,
              cartoes: cartoesIniciais,
              reserva: reservaInicial,
            },
            { merge: true }
          );
        }

        setDadosCarregados(true);

        unsubSnapshot = onSnapshot(userDocRef, (docSnap) => {
          if (!docSnap.exists()) return;
          const data = docSnap.data();

          if (data.profile) setProfile(data.profile);
          if (data.transacoes) setTransacoes(data.transacoes);
          if (data.cartoes) setCartoes(data.cartoes);
          if (data.reserva) setReserva(data.reserva);
        });
      } catch (err) {
        console.error("Erro ao carregar dados iniciais do Firestore:", err);
        const uid = user.uid;
        const storedProfile = loadFromStorage(`profile_${uid}`, DEFAULT_PROFILE);
        const storedTransacoes = loadFromStorage(`transacoes_${uid}`, []);
        const storedCartoes = loadFromStorage(`cartoes_${uid}`, []);
        const storedReserva = loadFromStorage(`reserva_${uid}`, DEFAULT_RESERVA);

        setProfile(storedProfile);
        setTransacoes(storedTransacoes);
        setCartoes(storedCartoes);
        setReserva(storedReserva);
        setDadosCarregados(true);
      }
    })();

    return () => {
      if (unsubSnapshot) unsubSnapshot();
    };
  }, [user]);

  /* ------- 2) SALVAR NA NUVEM ------- */

  useEffect(() => {
    if (!user || !dadosCarregados) return;

    const uid = user.uid;
    const userDocRef = doc(db, "users", uid);

    const payload = {
      profile,
      transacoes,
      cartoes,
      reserva,
    };

    saveToStorage(`profile_${uid}`, profile);
    saveToStorage(`transacoes_${uid}`, transacoes);
    saveToStorage(`cartoes_${uid}`, cartoes);
    saveToStorage(`reserva_${uid}`, reserva);

    if (!navigator.onLine) {
      saveToStorage(`pendingSync_${uid}`, payload);
      return;
    }

    setDoc(userDocRef, payload, { merge: true })
      .then(() => {
        saveToStorage(`pendingSync_${uid}`, null);
      })
      .catch((err) => {
        console.error("Erro ao salvar dados no Firestore:", err);
        saveToStorage(`pendingSync_${uid}`, payload);
      });
  }, [user, dadosCarregados, profile, transacoes, cartoes, reserva]);

  /* ------- 3) SINCRONIZAR PENDÊNCIAS ------- */

  useEffect(() => {
    if (!user || !dadosCarregados) return;

    const uid = user.uid;

    const syncPendentes = async () => {
      const pendente = loadFromStorage(`pendingSync_${uid}`, null);
      if (!pendente) return;
      if (!navigator.onLine) return;

      try {
        const userDocRef = doc(db, "users", uid);
        await setDoc(userDocRef, pendente, { merge: true });
        saveToStorage(`pendingSync_${uid}`, null);
      } catch (err) {
        console.error("Erro ao enviar pendências ao Firestore:", err);
      }
    };

    syncPendentes();

    window.addEventListener("online", syncPendentes);
    return () => {
      window.removeEventListener("online", syncPendentes);
    };
  }, [user, dadosCarregados]);

  /* ------- FUNÇÕES PARA O CONTEXTO ------- */

  const atualizarProfile = (novosDados) => {
    setProfile((prev) => ({ ...prev, ...novosDados }));
  };

  const adicionarTransacao = (dados) => {
    const nova = {
      ...dados,
      id: generateId(),
      dataHora: dados.dataHora || new Date().toISOString(),
    };
    setTransacoes((prev) => [nova, ...prev]);
  };

  const atualizarTransacao = (id, dadosAtualizados) => {
    setTransacoes((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...dadosAtualizados } : t))
    );
  };

  const removerTransacao = (id) => {
    setTransacoes((prev) => prev.filter((t) => t.id !== id));
  };

  const adicionarCartao = (dados) => {
    const novo = {
      id: generateId(),
      nome: dados.nome,
      limite: Number(dados.limite || 0),
      diaFechamento: Number(dados.diaFechamento || 1),
      diaVencimento: Number(dados.diaVencimento || 1),
    };
    setCartoes((prev) => [...prev, novo]);
  };

  const atualizarCartoes = (lista) => {
    setCartoes(lista);
  };

  const atualizarReserva = (novosDados) => {
    setReserva((prev) => ({ ...prev, ...novosDados }));
  };

  const contexto = useMemo(
    () => ({
      user,
      profile,
      atualizarProfile,
      transacoes,
      adicionarTransacao,
      atualizarTransacao,
      removerTransacao,
      cartoes,
      adicionarCartao,
      atualizarCartoes,
      reserva,
      setReserva: atualizarReserva,

      mesReferencia,
      mudarMesReferencia,
      irParaMesAtual,

      loginComGoogle,
      logout,
    }),
    [user, profile, transacoes, cartoes, reserva, mesReferencia]
  );

  /* ------- ESCOLHE PÁGINA ------- */

  let pagina;
  switch (abaAtiva) {
    case "financas":
      pagina = <FinancasPage />;
      break;
    case "lista":
      pagina = <ListaPage />;
      break;
    case "lembretes":
      pagina = <LembretesPage />;
      break;
    case "receitas":
      pagina = <ReceitasPage />;
      break;
    case "trabalho":
      pagina = <TrabalhoPage />;
      break;

    case "reserva":
      pagina = <ReservaPage />;
      break;
    case "transacoes":
      pagina = <TransacoesPage />;
      break;
    case "cartoes":
      pagina = <CartoesPage />;
      break;
    case "historico":
      pagina = <HistoricoPage />;
      break;
    case "perfil":
      pagina = <PerfilPage />;
      break;

    default:
      pagina = <FinancasPage />;
  }

  /* ------- TELA ENQUANTO VERIFICA LOGIN ------- */

  if (authLoading) {
    return (
      <div className="app-root">
        <div className="app-overlay">
          <header className="app-header">
            <h1 className="app-title">Finanças Offline</h1>
          </header>
          <main className="app-main">
            <div className="card">
              <p>Carregando...</p>
            </div>
          </main>
        </div>
      </div>
    );
  }

  /* ------- TELA DE LOGIN ------- */

  if (!user) {
    return (
      <div className="app-root">
        <div className="app-overlay">
          <header className="app-header">
            <h1 className="app-title">Finanças Offline</h1>
          </header>

          <main className="app-main">
            <div className="card profile-card">
              <h2 className="page-title">Entrar</h2>
              <p className="muted small">
                Faça login com sua conta Google para usar o app e salvar seus
                dados com segurança.
              </p>

              <button
                className="primary-btn"
                style={{ marginTop: 12 }}
                onClick={() => {
                  if (!navigator.onLine) {
                    alert("Sem internet. Conecte-se para fazer login com Google.");
                    return;
                  }
                  loginComGoogle();
                }}
              >
                🔐 Entrar com Google
              </button>
            </div>
          </main>
        </div>
      </div>
    );
  }

  /* ------- APP NORMAL ------- */

  return (
    <FinanceContext.Provider value={contexto}>
      <div className="app-root">
        <div className="bolinhas-background">
          {Array.from({ length: 60 }).map((_, i) => (
            <span
              key={i}
              className="bolinha"
              style={{
                left: `${Math.random() * 100}%`,
                animationDuration: `${4 + Math.random() * 6}s`,
                animationDelay: `${Math.random() * 8}s`,
                transform: `scale(${0.5 + Math.random() * 1.2})`,
              }}
            />
          ))}
        </div>

        <div className="app-overlay">
          <header className="app-header">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <h1 className="app-title">Finanças Offline</h1>

              <button
                type="button"
                className="icon-btn"
                onClick={() => setMenuMaisAberto(true)}
                aria-label="Abrir menu"
                title="Menu"
                style={{ width: "auto", padding: "8px 12px" }}
              >
                ⋯
              </button>
            </div>
          </header>

          <main className="app-main">{pagina}</main>

          {/* ✅ menu inferior aparece em Finanças E em Reserva/Transações/Cartões/Histórico/Perfil */}
          {mostrarMenuInferior && (
            <nav className="bottom-nav">
              <button
                className={
                  "bottom-nav-item " +
                  (abaAtiva === "financas" ? "bottom-nav-item-active" : "")
                }
                onClick={() => setAbaAtiva("financas")}
              >
                💰 Finanças
              </button>

              <button
                className={
                  "bottom-nav-item " +
                  (abaAtiva === "reserva" ? "bottom-nav-item-active" : "")
                }
                onClick={() => setAbaAtiva("reserva")}
              >
                🛟 Reserva
              </button>

              <button
                className={
                  "bottom-nav-item " +
                  (abaAtiva === "transacoes" ? "bottom-nav-item-active" : "")
                }
                onClick={() => setAbaAtiva("transacoes")}
              >
                📥 Transações
              </button>

              <button
                className={
                  "bottom-nav-item " +
                  (abaAtiva === "cartoes" ? "bottom-nav-item-active" : "")
                }
                onClick={() => setAbaAtiva("cartoes")}
              >
                💳 Cartões
              </button>

              <button
                className={
                  "bottom-nav-item " +
                  (abaAtiva === "historico" ? "bottom-nav-item-active" : "")
                }
                onClick={() => setAbaAtiva("historico")}
              >
                📜 Histórico
              </button>

              <button
                className={
                  "bottom-nav-item " +
                  (abaAtiva === "perfil" ? "bottom-nav-item-active" : "")
                }
                onClick={() => setAbaAtiva("perfil")}
              >
                👤 Perfil
              </button>
            </nav>
          )}

          {/* ✅ MODAL ⋯: só 5 itens */}
          {menuMaisAberto && (
            <div
              className="modal-overlay"
              onClick={() => setMenuMaisAberto(false)}
            >
              <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <h3>Atalhos</h3>

                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                  {itensMenuMais.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className="toggle-btn"
                      onClick={() => abrirAbaPeloMenuMais(item.key)}
                      style={{ textAlign: "left", width: "100%" }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginTop: 12,
                  }}
                >
                  <button
                    type="button"
                    className="toggle-btn"
                    onClick={() => setMenuMaisAberto(false)}
                    style={{ width: "auto" }}
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </FinanceContext.Provider>
  );
}
