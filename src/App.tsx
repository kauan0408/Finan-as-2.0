// src/App.jsx
import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
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
import ReceitasPage from "./pages/ReceitasPage.jsx";

// ✅ CASA
import DivisaoCasaPage from "./pages/DivisaoCasaPage.jsx";

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
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/* ✅ Regras de “virar o mês” no dia de pagamento (inclui “dia útil”) */
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

  // ✅ Se digitar só "5" entende como DIA ÚTIL
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && n >= 1 && n <= 31) return { kind: "businessDay", n };
  }

  // Ex.: "dia 10" (DIA DO MÊS)
  const m2 = s.match(/\bdia\s+(\d{1,2})\b/);
  const day = m2 ? Number(m2[1]) : NaN;
  if (Number.isFinite(day) && day >= 1 && day <= 31) return { kind: "dayOfMonth", day };

  return null;
}

function calcMesRefByPayday(diaPagamentoRaw) {
  const rule = parseDiaPagamentoToRule(diaPagamentoRaw);
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();

  if (!rule) return { mes: m, ano: y };

  let payday = null;

  if (rule.kind === "businessDay") {
    payday = getNthBusinessDayDate(y, m, rule.n);
  } else if (rule.kind === "dayOfMonth") {
    const lastDay = new Date(y, m + 1, 0).getDate();
    const dd = Math.min(lastDay, rule.day);
    payday = new Date(y, m, dd);
  }

  if (!payday) return { mes: m, ano: y };

  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const p0 = new Date(payday.getFullYear(), payday.getMonth(), payday.getDate());

  if (t0 < p0) {
    const prev = new Date(y, m - 1, 1);
    return { mes: prev.getMonth(), ano: prev.getFullYear() };
  }
  return { mes: m, ano: y };
}

/* ✅ Se eu estiver vendo Janeiro/2026 na setinha, lançar cai em Janeiro/2026 */
function makeISOInMesReferencia(mesReferencia) {
  const now = new Date();
  const ano = Number(mesReferencia?.ano ?? now.getFullYear());
  const mes0 = Number(mesReferencia?.mes ?? now.getMonth());

  const lastDay = new Date(ano, mes0 + 1, 0).getDate();
  const dia = Math.min(now.getDate(), lastDay);

  const d = new Date(
    ano,
    mes0,
    dia,
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds()
  );

  return d.toISOString();
}

/* ✅ Helpers: retenção 2 meses da Casa baseado no MÊS REAL */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function monthKeyFromRef(ref) {
  const now = new Date();
  const ano = Number(ref?.ano ?? now.getFullYear());
  const mes0 = Number(ref?.mes ?? now.getMonth());
  return `${ano}-${pad2(mes0 + 1)}`; // YYYY-MM
}
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
function keepOnlyTwoMonths(porMes, realKey) {
  const obj = porMes && typeof porMes === "object" ? porMes : {};
  const curIdx = monthKeyToIndex(realKey);
  if (curIdx === null) return obj;

  const keep = new Set([realKey, indexToMonthKey(curIdx - 1)]);
  const next = {};
  for (const k of Object.keys(obj)) {
    if (keep.has(k)) next[k] = obj[k];
  }
  return next;
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

const DEFAULT_LISTA = [];
const DEFAULT_LEMBRETES = [];
const DEFAULT_RECEITAS = [];

// ✅ DEFAULT DA CASA (LOCAL APENAS)
const DEFAULT_DIVISAO_CASA = {
  casaNome: "Gastos da Casa",
  modoDivisao: "igual",
  moradoresCount: 2,
  moradores: [
    { id: generateId(), nome: "Morador 1", percentual: 50 },
    { id: generateId(), nome: "Morador 2", percentual: 50 },
  ],
  fixos: [],
  porMes: {},
};

// ✅ chave local (por aparelho) — NÃO vai pra nuvem
const CASA_LOCAL_KEY = "divisaoCasa_local_v1";

/* ---------------- COMPONENTE PRINCIPAL ---------------- */

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dadosCarregados, setDadosCarregados] = useState(false);

  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [transacoes, setTransacoes] = useState([]);
  const [cartoes, setCartoes] = useState([]);
  const [reserva, setReserva] = useState(DEFAULT_RESERVA);

  const [lista, setLista] = useState(DEFAULT_LISTA);
  const [lembretes, setLembretes] = useState(DEFAULT_LEMBRETES);
  const [receitas, setReceitas] = useState(DEFAULT_RECEITAS);

  // ✅ CASA (LOCAL)
  const [divisaoCasa, setDivisaoCasa] = useState(DEFAULT_DIVISAO_CASA);

  // ==========================================================
  // ✅ MÊS DE REFERÊNCIA COM PERSISTÊNCIA + MODO AUTOMÁTICO
  // ==========================================================
  const [mesAuto, setMesAuto] = useState(true);

  const hoje = new Date();
  const [mesReferencia, setMesReferencia] = useState({
    mes: hoje.getMonth(),
    ano: hoje.getFullYear(),
  });

  const persistMesRef = (uid, ref) => saveToStorage(`mesRef_${uid}`, ref);
  const persistMesAuto = (uid, v) => saveToStorage(`mesAuto_${uid}`, v);

  const irParaMesAtual = () => {
    if (!user) {
      const h = new Date();
      setMesReferencia({ mes: h.getMonth(), ano: h.getFullYear() });
      return;
    }
    const ref = calcMesRefByPayday(profile?.diaPagamento);
    setMesAuto(true);
    setMesReferencia(ref);
    persistMesAuto(user.uid, true);
    persistMesRef(user.uid, ref);
  };

  const mudarMesReferencia = (delta) => {
    setMesAuto(false);

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

      const ref = { mes: novoMes, ano: novoAno };

      if (user?.uid) {
        persistMesAuto(user.uid, false);
        persistMesRef(user.uid, ref);
      }

      return ref;
    });
  };

  const setMesReferenciaManual = (ref) => {
    if (!ref) return;
    setMesAuto(false);
    setMesReferencia(ref);
    if (user?.uid) {
      persistMesAuto(user.uid, false);
      persistMesRef(user.uid, ref);
    }
  };

  useEffect(() => {
    if (!mesAuto) return;

    const tick = () => {
      const ref = calcMesRefByPayday(profile?.diaPagamento);
      setMesReferencia((prev) => {
        if (prev?.mes === ref.mes && prev?.ano === ref.ano) return prev;
        if (user?.uid) persistMesRef(user.uid, ref);
        return ref;
      });
    };

    tick();
    const id = setInterval(tick, 60 * 1000);
    return () => clearInterval(id);
  }, [mesAuto, profile?.diaPagamento, user]);

  // ==========================================================
  // ✅ CASA LOCAL: carregar do aparelho 1x
  // ==========================================================
  useEffect(() => {
    // carrega SEM depender de login (é local do aparelho)
    const localRaw = loadFromStorage(CASA_LOCAL_KEY, null);
    const mesRealRef = calcMesRefByPayday(profile?.diaPagamento);
    const realKey = monthKeyFromRef(mesRealRef);

    if (localRaw && typeof localRaw === "object") {
      setDivisaoCasa((prev) => ({
        ...DEFAULT_DIVISAO_CASA,
        ...localRaw,
        porMes: keepOnlyTwoMonths(localRaw?.porMes, realKey),
      }));
    } else {
      setDivisaoCasa((prev) => ({
        ...DEFAULT_DIVISAO_CASA,
        ...prev,
        porMes: keepOnlyTwoMonths(prev?.porMes, realKey),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ CASA LOCAL: sempre que mudar, salva no aparelho
  useEffect(() => {
    const mesRealRef = calcMesRefByPayday(profile?.diaPagamento);
    const realKey = monthKeyFromRef(mesRealRef);

    const clean = {
      ...DEFAULT_DIVISAO_CASA,
      ...(divisaoCasa || {}),
      porMes: keepOnlyTwoMonths(divisaoCasa?.porMes, realKey),
    };

    // salva no storage LOCAL do aparelho
    saveToStorage(CASA_LOCAL_KEY, clean);

    // garante que o state também fique "limpo" (2 meses)
    setDivisaoCasa((prev) => {
      const prevObj = prev && typeof prev === "object" ? prev : DEFAULT_DIVISAO_CASA;
      const prevPorMes = prevObj.porMes && typeof prevObj.porMes === "object" ? prevObj.porMes : {};
      const cleaned = keepOnlyTwoMonths(prevPorMes, realKey);

      const prevKeys = Object.keys(prevPorMes);
      const nextKeys = Object.keys(cleaned);
      const same =
        prevKeys.length === nextKeys.length &&
        nextKeys.every((k) => prevPorMes[k] === cleaned[k]);

      if (same) return prevObj;
      return { ...prevObj, porMes: cleaned };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisaoCasa, profile?.diaPagamento]);

  // ✅ Aba atual geral
  const [abaAtiva, setAbaAtiva] = useState("financas");

  // ✅ MENU ⋯
  const [menuMaisAberto, setMenuMaisAberto] = useState(false);

  const itensMenuMais = useMemo(
    () => [
      { key: "financas", label: "💰 Finanças" },
      { key: "lista", label: "🛒 Lista" },
      { key: "lembretes", label: "⏰ Lembretes" },
      { key: "receitas", label: "🍳 Receitas" },
      { key: "casa", label: "🏠 Casa" },
    ],
    []
  );

  function abrirAbaPeloMenuMais(key) {
    setAbaAtiva(key);
    setMenuMaisAberto(false);
  }

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

  /* ------- 1) CARREGAR DADOS (NUVEM) ------- */

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

          const listaCloud = data.lista || DEFAULT_LISTA;
          const lembretesCloud = data.lembretes || DEFAULT_LEMBRETES;
          const receitasCloud = data.receitas || DEFAULT_RECEITAS;

          setProfile(perfilCloud);
          setTransacoes(transacoesCloud);
          setCartoes(cartoesCloud);
          setReserva(reservaCloud);

          setLista(listaCloud);
          setLembretes(lembretesCloud);
          setReceitas(receitasCloud);

          saveToStorage(`profile_${uid}`, perfilCloud);
          saveToStorage(`transacoes_${uid}`, transacoesCloud);
          saveToStorage(`cartoes_${uid}`, cartoesCloud);
          saveToStorage(`reserva_${uid}`, reservaCloud);

          saveToStorage(`lista_${uid}`, listaCloud);
          saveToStorage(`lembretes_${uid}`, lembretesCloud);
          saveToStorage(`receitas_${uid}`, receitasCloud);
          // ✅ NÃO salva divisaoCasa no uid (é local do aparelho)
        } else {
          const storedProfile = loadFromStorage(`profile_${uid}`, null);
          const storedTransacoes = loadFromStorage(`transacoes_${uid}`, null);
          const storedCartoes = loadFromStorage(`cartoes_${uid}`, null);
          const storedReserva = loadFromStorage(`reserva_${uid}`, null);

          const storedLista = loadFromStorage(`lista_${uid}`, null);
          const storedLembretes = loadFromStorage(`lembretes_${uid}`, null);
          const storedReceitas = loadFromStorage(`receitas_${uid}`, null);

          const perfilInicial = storedProfile || DEFAULT_PROFILE;
          const transacoesIniciais = storedTransacoes || [];
          const cartoesIniciais = storedCartoes || [];
          const reservaInicial = storedReserva || DEFAULT_RESERVA;

          const listaInicial = storedLista || DEFAULT_LISTA;
          const lembretesIniciais = storedLembretes || DEFAULT_LEMBRETES;
          const receitasIniciais = storedReceitas || DEFAULT_RECEITAS;

          setProfile(perfilInicial);
          setTransacoes(transacoesIniciais);
          setCartoes(cartoesIniciais);
          setReserva(reservaInicial);

          setLista(listaInicial);
          setLembretes(lembretesIniciais);
          setReceitas(receitasIniciais);

          await setDoc(
            userDocRef,
            {
              profile: perfilInicial,
              transacoes: transacoesIniciais,
              cartoes: cartoesIniciais,
              reserva: reservaInicial,
              lista: listaInicial,
              lembretes: lembretesIniciais,
              receitas: receitasIniciais,
              // ✅ NÃO envia divisaoCasa (local)
            },
            { merge: true }
          );
        }

        // ✅ RESTAURA MÊS/ AUTO DO STORAGE DO USUÁRIO
        const storedMesAuto = loadFromStorage(`mesAuto_${uid}`, null);
        const storedMesRef = loadFromStorage(`mesRef_${uid}`, null);

        if (typeof storedMesAuto === "boolean") {
          setMesAuto(storedMesAuto);
          if (storedMesAuto === true) {
            const ref = calcMesRefByPayday((snap.data()?.profile || profile)?.diaPagamento);
            setMesReferencia(ref);
            persistMesRef(uid, ref);
          } else {
            if (
              storedMesRef &&
              typeof storedMesRef.mes === "number" &&
              typeof storedMesRef.ano === "number"
            ) {
              setMesReferencia(storedMesRef);
            } else {
              const ref = { mes: new Date().getMonth(), ano: new Date().getFullYear() };
              setMesReferencia(ref);
              persistMesRef(uid, ref);
            }
          }
        } else {
          const ref = calcMesRefByPayday((snap.data()?.profile || profile)?.diaPagamento);
          setMesAuto(true);
          setMesReferencia(ref);
          persistMesAuto(uid, true);
          persistMesRef(uid, ref);
        }

        setDadosCarregados(true);

        unsubSnapshot = onSnapshot(userDocRef, (docSnap) => {
          if (!docSnap.exists()) return;
          const data = docSnap.data();

          if (data.profile) setProfile(data.profile);
          if (data.transacoes) setTransacoes(data.transacoes);
          if (data.cartoes) setCartoes(data.cartoes);
          if (data.reserva) setReserva(data.reserva);

          if (data.lista) setLista(data.lista);
          if (data.lembretes) setLembretes(data.lembretes);
          if (data.receitas) setReceitas(data.receitas);

          // ✅ NÃO sincroniza divisaoCasa (local)
        });
      } catch (err) {
        console.error("Erro ao carregar dados iniciais do Firestore:", err);
        const uid = user.uid;

        const storedProfile = loadFromStorage(`profile_${uid}`, DEFAULT_PROFILE);
        const storedTransacoes = loadFromStorage(`transacoes_${uid}`, []);
        const storedCartoes = loadFromStorage(`cartoes_${uid}`, []);
        const storedReserva = loadFromStorage(`reserva_${uid}`, DEFAULT_RESERVA);

        const storedLista = loadFromStorage(`lista_${uid}`, DEFAULT_LISTA);
        const storedLembretes = loadFromStorage(`lembretes_${uid}`, DEFAULT_LEMBRETES);
        const storedReceitas = loadFromStorage(`receitas_${uid}`, DEFAULT_RECEITAS);

        setProfile(storedProfile);
        setTransacoes(storedTransacoes);
        setCartoes(storedCartoes);
        setReserva(storedReserva);

        setLista(storedLista);
        setLembretes(storedLembretes);
        setReceitas(storedReceitas);

        const storedMesAuto = loadFromStorage(`mesAuto_${uid}`, true);
        const storedMesRef = loadFromStorage(`mesRef_${uid}`, null);

        setMesAuto(!!storedMesAuto);
        if (storedMesAuto) {
          const ref = calcMesRefByPayday(storedProfile?.diaPagamento);
          setMesReferencia(ref);
          persistMesRef(uid, ref);
          persistMesAuto(uid, true);
        } else if (storedMesRef) {
          setMesReferencia(storedMesRef);
          persistMesAuto(uid, false);
        } else {
          const h = new Date();
          const ref = { mes: h.getMonth(), ano: h.getFullYear() };
          setMesReferencia(ref);
          persistMesAuto(uid, false);
          persistMesRef(uid, ref);
        }

        setDadosCarregados(true);
      }
    })();

    return () => {
      if (unsubSnapshot) unsubSnapshot();
    };
  }, [user]);

  /* ------- 2) SALVAR NA NUVEM (SEM CASA) ------- */

  useEffect(() => {
    if (!user || !dadosCarregados) return;

    const uid = user.uid;
    const userDocRef = doc(db, "users", uid);

    const payload = {
      profile,
      transacoes,
      cartoes,
      reserva,
      lista,
      lembretes,
      receitas,
      // ✅ NÃO envia divisaoCasa (local)
    };

    saveToStorage(`profile_${uid}`, profile);
    saveToStorage(`transacoes_${uid}`, transacoes);
    saveToStorage(`cartoes_${uid}`, cartoes);
    saveToStorage(`reserva_${uid}`, reserva);

    saveToStorage(`lista_${uid}`, lista);
    saveToStorage(`lembretes_${uid}`, lembretes);
    saveToStorage(`receitas_${uid}`, receitas);

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
  }, [user, dadosCarregados, profile, transacoes, cartoes, reserva, lista, lembretes, receitas]);

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
    return () => window.removeEventListener("online", syncPendentes);
  }, [user, dadosCarregados]);

  /* ------- FUNÇÕES PARA O CONTEXTO ------- */

  const atualizarProfile = (novosDados) => {
    setProfile((prev) => ({ ...prev, ...novosDados }));
  };

  const adicionarTransacao = (dados) => {
    const nova = {
      ...dados,
      id: generateId(),
      dataHora: dados.dataHora || makeISOInMesReferencia(mesReferencia),
    };
    setTransacoes((prev) => [nova, ...prev]);
  };

  const atualizarTransacao = (id, dadosAtualizados) => {
    setTransacoes((prev) => prev.map((t) => (t.id === id ? { ...t, ...dadosAtualizados } : t)));
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

  const atualizarCartoes = (listaCartoes) => {
    setCartoes(listaCartoes);
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

      lista,
      setLista,
      lembretes,
      setLembretes,
      receitas,
      setReceitas,

      // ✅ CASA LOCAL (não sincroniza)
      divisaoCasa,
      setDivisaoCasa,

      // ✅ mês global
      mesReferencia,
      mudarMesReferencia,
      irParaMesAtual,
      mesAuto,
      setMesAuto,
      setMesReferenciaManual,

      loginComGoogle,
      logout,
    }),
    [user, profile, transacoes, cartoes, reserva, lista, lembretes, receitas, divisaoCasa, mesReferencia, mesAuto]
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
    case "casa":
      pagina = <DivisaoCasaPage />;
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
              <p className="muted small">Faça login com sua conta Google para usar o app e salvar seus dados com segurança.</p>

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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
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

          {mostrarMenuInferior && (
            <nav className="bottom-nav">
              <button
                className={"bottom-nav-item " + (abaAtiva === "financas" ? "bottom-nav-item-active" : "")}
                onClick={() => setAbaAtiva("financas")}
              >
                💰 Finanças
              </button>

              <button
                className={"bottom-nav-item " + (abaAtiva === "reserva" ? "bottom-nav-item-active" : "")}
                onClick={() => setAbaAtiva("reserva")}
              >
                🛟 Reserva
              </button>

              <button
                className={"bottom-nav-item " + (abaAtiva === "transacoes" ? "bottom-nav-item-active" : "")}
                onClick={() => setAbaAtiva("transacoes")}
              >
                📥 Transações
              </button>

              <button
                className={"bottom-nav-item " + (abaAtiva === "cartoes" ? "bottom-nav-item-active" : "")}
                onClick={() => setAbaAtiva("cartoes")}
              >
                💳 Cartões
              </button>

              <button
                className={"bottom-nav-item " + (abaAtiva === "historico" ? "bottom-nav-item-active" : "")}
                onClick={() => setAbaAtiva("historico")}
              >
                📜 Histórico
              </button>

              <button
                className={"bottom-nav-item " + (abaAtiva === "perfil" ? "bottom-nav-item-active" : "")}
                onClick={() => setAbaAtiva("perfil")}
              >
                👤 Perfil
              </button>
            </nav>
          )}

          {menuMaisAberto && (
            <div className="modal-overlay" onClick={() => setMenuMaisAberto(false)}>
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

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                  <button type="button" className="toggle-btn" onClick={() => setMenuMaisAberto(false)} style={{ width: "auto" }}>
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
