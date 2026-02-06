// src/pages/ListaPage.jsx

// Importa React e hooks usados na página:
// - useState: estados da UI e do armazenamento
// - useEffect: efeitos (carregar do localStorage, limpar toast, auto-clean etc.)
// - useMemo: memoriza cálculos (itens visíveis, progresso, ordenação)
// - useRef: guardar referência do SpeechRecognition e buffers sem re-render
import React, { useEffect, useMemo, useRef, useState } from "react";

// Chave do localStorage onde a versão atual (v2) das listas é salva
const LS_KEY = "pwa_listas_v2";

// Constante em milissegundos de 1 semana (usada para auto-apagar listas 100% concluídas)
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Faz JSON.parse com segurança: se quebrar, retorna fallback
function safeJSONParse(v, fallback) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

// Gera um ID único:
// - se o browser suportar crypto.randomUUID, usa ele (melhor)
// - senão cria um id baseado em aleatório + timestamp
function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

// Retorna data/hora atual em ISO string (ex.: 2026-01-22T...Z)
function nowISO() {
  return new Date().toISOString();
}

// Normaliza texto para facilitar comparação/busca:
// - trim
// - minúsculo
// - remove acentos (NFD + remove diacríticos)
function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Calcula progresso de uma lista:
// - total: total de itens
// - done: concluídos
// - issue: com problema
// - pending: pendentes (o resto)
// - percent: % concluído (done/total)
function calcProgress(items) {
  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const issue = items.filter((i) => i.status === "issue").length;
  const pending = total - done - issue;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, pending, issue, percent };
}

// Formata uma data ISO para pt-BR (somente data)
// Se vier vazio ou erro, retorna ""
function fmtDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR");
  } catch {
    return "";
  }
}

/** quebra em itens por vírgula/; e também por palavra "vírgula" dita no áudio */
// Recebe texto bruto (digitado ou falado) e transforma em array de itens:
// - substitui "virgula"/"vírgula" por ","
// - separa por , ou ;
// - tira espaços e remove vazios
function splitIntoItems(raw) {
  const s = String(raw || "")
    .replace(/\bvirgula\b/gi, ",")
    .replace(/\bvírgula\b/gi, ",");
  return s
    .split(/[;,]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

/* ---------------- UI pieces (Modal / Toast) ---------------- */

// Componente de Modal genérico:
// - fecha no clique fora (overlay) e no ESC
// - usa children como conteúdo
function Modal({ open, title, children, onClose }) {
  // Quando abre, registra listener do ESC; quando fecha/desmonta, remove
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Se não está aberto, não renderiza nada
  if (!open) return null;

  return (
    // Overlay: clicar fora fecha
    <div className="modal-overlay" role="dialog" aria-modal="true" onMouseDown={onClose}>
      {/* Card: impede clique dentro de fechar (stopPropagation) */}
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        {/* Cabeçalho do modal: título + botão de fechar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar" title="Fechar">
            ✕
          </button>
        </div>
        {/* Conteúdo */}
        <div style={{ marginTop: 12, textAlign: "left" }}>{children}</div>
      </div>
    </div>
  );
}

// Toast simples: aparece só se tiver texto
function Toast({ text }) {
  if (!text) return null;
  return <div className="toast">{text}</div>;
}

// Barra de progresso: recebe percent e ajusta largura do preenchimento
function ProgressBar({ percent }) {
  return (
    <div className="progress-bar" aria-label={`Progresso ${percent}%`}>
      <div className="progress-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

// Aba (chip) clicável: destaca se active=true
function Tab({ active, label, onClick }) {
  return (
    <button type="button" onClick={onClick} className={"chip " + (active ? "chip-active" : "")}>
      {label}
    </button>
  );
}

/* -------------------- Page -------------------- */

export default function ListaPage() {
  // Estado principal "store" (a base do app de listas):
  // version: número para controlar migrações
  // lists: objeto { [id]: {id,title,type,createdAt,completedAt} }
  // items: objeto { [listId]: [ {id,text,status,createdAt,doneAt,note} ] }
  // ui: coisas de UI persistidas (qual lista está selecionada)
  const [store, setStore] = useState({
    version: 2,
    lists: {},
    items: {},
    ui: { selectedListId: null },
  });

  // UI state
  // Texto do input de adicionar item
  const [newItemText, setNewItemText] = useState("");

  // Texto de busca/filtro
  const [search, setSearch] = useState("");

  // Aba atual: pending | done | issue | all
  const [tab, setTab] = useState("pending"); // pending | done | issue | all

  // Texto atual do toast (mensagem rápida)
  const [toastText, setToastText] = useState("");

  // Modals
  // Modal de criar lista
  const [modalCreateOpen, setModalCreateOpen] = useState(false);

  // Campo nome da lista no modal de criação
  const [createTitle, setCreateTitle] = useState("");

  // Tipo no modal de criação: compras | tarefas
  const [createType, setCreateType] = useState("compras"); // compras | tarefas

  // Modal de renomear lista
  const [modalRenameOpen, setModalRenameOpen] = useState(false);

  // Campo novo nome no modal de renomear
  const [renameTitle, setRenameTitle] = useState("");

  // Modal de confirmação genérico (excluir, resetar, limpar etc.)
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Configuração do modal de confirmação:
  // title/body/danger/action
  const [confirmCfg, setConfirmCfg] = useState({
    title: "",
    body: "",
    danger: false,
    action: null,
  });

  // ✅ Menu dos 3 pontos agora é MODAL
  // Abre/fecha o modal com ações da lista
  const [menuModalOpen, setMenuModalOpen] = useState(false);

  // edit item
  // ID do item que está sendo editado (ou null)
  const [editingId, setEditingId] = useState(null);

  // Texto do input quando edita um item
  const [editingText, setEditingText] = useState("");

  // voice (ACUMULA, NÃO LANÇA SOZINHO)
  // Flag se está gravando no microfone
  const [isListening, setIsListening] = useState(false);

  // Referência do objeto SpeechRecognition em uso
  const recRef = useRef(null);

  // Buffer que acumula o texto final reconhecido (sem forçar re-render)
  const voiceFinalRef = useRef(""); // acumula o texto final

  // Flag para evitar loops ao reiniciar o reconhecimento no onend
  const restartingRef = useRef(false); // evita loops estranhos

  // Salva o store:
  // - atualiza o estado React
  // - grava no localStorage
  function save(next) {
    setStore(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  }

  // Mostra uma mensagem no toast
  function toastMsg(texto) {
    setToastText(texto);
  }

  // Toast helper
  // Quando toastText muda e não é vazio:
  // - inicia timer para limpar depois de 2,2s
  useEffect(() => {
    if (!toastText) return;
    const t = setTimeout(() => setToastText(""), 2200);
    return () => clearTimeout(t);
  }, [toastText]);

  // ---- Auto-clean: delete lists 100% done after 1 week
  function cleanupAutoDeleteLists(currentStore) {
    const now = Date.now();
    const nextLists = { ...currentStore.lists };
    const nextItems = { ...currentStore.items };
    let changed = false;

    for (const listId of Object.keys(nextLists)) {
      const list = nextLists[listId];
      const items = Array.isArray(nextItems[listId]) ? nextItems[listId] : [];
      const p = calcProgress(items);

      if (p.total > 0 && p.percent === 100) {
        if (!list.completedAt) {
          nextLists[listId] = { ...list, completedAt: nowISO() };
          changed = true;
        } else {
          const completedMs = new Date(list.completedAt).getTime();
          if (!isNaN(completedMs) && now - completedMs >= ONE_WEEK_MS) {
            delete nextLists[listId];
            delete nextItems[listId];
            changed = true;
          }
        }
      } else {
        if (list.completedAt) {
          nextLists[listId] = { ...list, completedAt: null };
          changed = true;
        }
      }
    }

    if (!changed) return currentStore;

    const remainingIds = Object.keys(nextLists);
    const selected = currentStore.ui.selectedListId;
    const nextSelected = selected && nextLists[selected] ? selected : remainingIds[0] || null;

    return {
      ...currentStore,
      lists: nextLists,
      items: nextItems,
      ui: { ...currentStore.ui, selectedListId: nextSelected },
    };
  }

  // ---- Load + Migration + Cleanup
  useEffect(() => {
    const v2 = safeJSONParse(localStorage.getItem(LS_KEY) || "null", null);
    if (v2 && v2.version === 2 && v2.lists && v2.items) {
      const cleaned = cleanupAutoDeleteLists(v2);
      localStorage.setItem(LS_KEY, JSON.stringify(cleaned));
      setStore(cleaned);
      return;
    }

    const legacy = safeJSONParse(localStorage.getItem("pwa_listas_v1") || "null", null);
    if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
      const lists = {};
      const items = {};
      const ids = [];

      for (const title of Object.keys(legacy)) {
        const listId = uuid();
        ids.push(listId);

        lists[listId] = {
          id: listId,
          title,
          type: "compras",
          createdAt: nowISO(),
          completedAt: null,
        };

        const legacyItems = Array.isArray(legacy[title]) ? legacy[title] : [];
        items[listId] = legacyItems.map((it) => ({
          id: it.id || uuid(),
          text: String(it.text || ""),
          status: it.done ? "done" : "pending",
          createdAt: nowISO(),
          doneAt: it.done ? nowISO() : null,
          note: "",
        }));
      }

      const selected = ids[0] || null;

      let migrated = { version: 2, lists, items, ui: { selectedListId: selected } };
      migrated = cleanupAutoDeleteLists(migrated);

      localStorage.setItem(LS_KEY, JSON.stringify(migrated));
      setStore(migrated);
      return;
    }

    const defaultId = uuid();
    const fresh = {
      version: 2,
      lists: {
        [defaultId]: {
          id: defaultId,
          title: "Mercado",
          type: "compras",
          createdAt: nowISO(),
          completedAt: null,
        },
      },
      items: { [defaultId]: [] },
      ui: { selectedListId: defaultId },
    };
    localStorage.setItem(LS_KEY, JSON.stringify(fresh));
    setStore(fresh);
  }, []);

  // cleanup on changes
  useEffect(() => {
    if (!store || store.version !== 2) return;
    const cleaned = cleanupAutoDeleteLists(store);
    if (cleaned !== store) save(cleaned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.lists, store.items]);

  const selectedListId = store.ui.selectedListId;
  const selectedList = selectedListId ? store.lists[selectedListId] : null;

  const listItems = useMemo(() => {
    if (!selectedListId) return [];
    return Array.isArray(store.items[selectedListId]) ? store.items[selectedListId] : [];
  }, [store.items, selectedListId]);

  const progress = useMemo(() => calcProgress(listItems), [listItems]);

  const ctaDoneLabel = selectedList?.type === "tarefas" ? "Já feito" : "Já comprado";

  const listOrder = useMemo(() => {
    const arr = Object.values(store.lists);
    return arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [store.lists]);

  const visibleItems = useMemo(() => {
    const q = normalizeText(search);
    let base = listItems;

    if (tab !== "all") base = base.filter((i) => i.status === tab);
    if (q) base = base.filter((i) => normalizeText(i.text).includes(q));

    if (tab === "all") {
      const rank = { pending: 0, issue: 1, done: 2 };
      base = [...base].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
    }
    return base;
  }, [listItems, tab, search]);

  function updateItems(nextItems) {
    if (!selectedListId) return;

    const p = calcProgress(nextItems);
    const current = store.lists[selectedListId];

    let nextList = current;
    if (p.total > 0 && p.percent === 100) {
      if (!current.completedAt) nextList = { ...current, completedAt: nowISO() };
    } else {
      if (current.completedAt) nextList = { ...current, completedAt: null };
    }

    const nextStore = {
      ...store,
      lists: { ...store.lists, [selectedListId]: nextList },
      items: { ...store.items, [selectedListId]: nextItems },
    };
    save(nextStore);
  }

  function setSelectedList(id) {
    stopVoice(true);
    setMenuModalOpen(false);

    save({ ...store, ui: { ...store.ui, selectedListId: id } });
    setTab("pending");
    setSearch("");
    setNewItemText("");
    setEditingId(null);
    setEditingText("");
  }

  // ---------- List actions ----------
  function openCreateModal() {
    setCreateTitle("");
    setCreateType("compras");
    setModalCreateOpen(true);
  }

  function createList() {
    const title = createTitle.trim();
    if (!title) return toastMsg("Digite um nome para a lista.");

    const existing = Object.values(store.lists).find((l) => normalizeText(l.title) === normalizeText(title));
    if (existing) {
      setModalCreateOpen(false);
      setSelectedList(existing.id);
      toastMsg("Lista já existia — selecionei ela.");
      return;
    }

    const id = uuid();
    const next = {
      ...store,
      lists: {
        ...store.lists,
        [id]: { id, title, type: createType, createdAt: nowISO(), completedAt: null },
      },
      items: { ...store.items, [id]: [] },
      ui: { ...store.ui, selectedListId: id },
    };
    save(next);
    setModalCreateOpen(false);
    setTab("pending");
    toastMsg("Lista criada.");
  }

  function openRenameModal() {
    if (!selectedList) return;
    setRenameTitle(selectedList.title);
    setModalRenameOpen(true);
  }

  function renameList() {
    if (!selectedList) return;
    const title = renameTitle.trim();
    if (!title) return toastMsg("Digite um nome válido.");

    save({
      ...store,
      lists: { ...store.lists, [selectedList.id]: { ...selectedList, title } },
    });
    setModalRenameOpen(false);
    toastMsg("Lista renomeada.");
  }

  function toggleListType() {
    if (!selectedList) return;
    const nextType = selectedList.type === "compras" ? "tarefas" : "compras";
    save({
      ...store,
      lists: { ...store.lists, [selectedList.id]: { ...selectedList, type: nextType } },
    });
    toastMsg("Tipo da lista alterado.");
  }

  function askDeleteList() {
    if (!selectedList) return;
    setConfirmCfg({
      title: "Excluir lista",
      body: `Tem certeza que quer excluir "${selectedList.title}"? Isso apaga todos os itens.`,
      danger: true,
      action: () => {
        const nextLists = { ...store.lists };
        const nextItems = { ...store.items };
        delete nextLists[selectedList.id];
        delete nextItems[selectedList.id];

        const remaining = Object.keys(nextLists);
        save({
          ...store,
          lists: nextLists,
          items: nextItems,
          ui: { selectedListId: remaining[0] || null },
        });
        toastMsg("Lista excluída.");
      },
    });
    setConfirmOpen(true);
  }

  // ---------- Item actions ----------
  function addItemsFromText(raw) {
    if (!selectedListId) return;
    const parts = splitIntoItems(raw);
    if (parts.length === 0) return;

    let next = [...listItems];
    let added = 0;

    for (const text of parts) {
      const exists = next.some((i) => normalizeText(i.text) === normalizeText(text));
      if (exists) continue;
      next.push({ id: uuid(), text, status: "pending", createdAt: nowISO(), doneAt: null, note: "" });
      added++;
    }

    updateItems(next);
    setNewItemText("");
    voiceFinalRef.current = "";
    toastMsg(added > 1 ? `Adicionados ${added} itens.` : added === 1 ? "Item adicionado." : "Nada novo para adicionar.");
  }

  function addItem() {
    addItemsFromText(newItemText);
  }

  function clearInput() {
    setNewItemText("");
    voiceFinalRef.current = "";
    toastMsg("Campo limpo.");
  }

  function setStatus(id, status) {
    const next = listItems.map((i) => {
      if (i.id !== id) return i;
      return { ...i, status, doneAt: status === "done" ? nowISO() : null };
    });
    updateItems(next);
  }

  function removeItem(id) {
    setConfirmCfg({
      title: "Excluir item",
      body: "Excluir este item da lista?",
      danger: true,
      action: () => {
        updateItems(listItems.filter((i) => i.id !== id));
        toastMsg("Item excluído.");
      },
    });
    setConfirmOpen(true);
  }

  function startEdit(item, e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setEditingId(item.id);
    setEditingText(item.text);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingText("");
  }

  function commitEdit(id) {
    const t = editingText.trim();
    if (!t) return toastMsg("Texto vazio não pode.");

    const parts = splitIntoItems(t);

    if (parts.length === 1) {
      updateItems(listItems.map((i) => (i.id === id ? { ...i, text: parts[0] } : i)));
      cancelEdit();
      toastMsg("Item atualizado.");
      return;
    }

    const first = parts[0];
    const rest = parts.slice(1);

    let next = listItems.map((i) => (i.id === id ? { ...i, text: first } : i));
    let added = 0;

    for (const text of rest) {
      const exists = next.some((i) => normalizeText(i.text) === normalizeText(text));
      if (exists) continue;
      next.push({ id: uuid(), text, status: "pending", createdAt: nowISO(), doneAt: null, note: "" });
      added++;
    }

    updateItems(next);
    cancelEdit();
    toastMsg(`Atualizado + adicionados ${added} itens.`);
  }

  function askMarkAllDone() {
    if (listItems.length === 0) return;
    setConfirmCfg({
      title: `${ctaDoneLabel} (tudo)`,
      body: "Quer marcar todos os itens como concluídos?",
      danger: false,
      action: () => {
        updateItems(listItems.map((i) => (i.status === "done" ? i : { ...i, status: "done", doneAt: nowISO() })));
        toastMsg("Tudo concluído.");
      },
    });
    setConfirmOpen(true);
  }

  function askResetAll() {
    if (listItems.length === 0) return;
    setConfirmCfg({
      title: "Resetar lista",
      body: "Todos os itens voltarão para PENDENTE. Continuar?",
      danger: true,
      action: () => {
        updateItems(listItems.map((i) => ({ ...i, status: "pending", doneAt: null })));
        toastMsg("Lista resetada.");
      },
    });
    setConfirmOpen(true);
  }

  function askClearDone() {
    const doneCount = listItems.filter((i) => i.status === "done").length;
    if (doneCount === 0) return toastMsg("Nada para limpar.");
    setConfirmCfg({
      title: "Limpar concluídos",
      body: `Apagar ${doneCount} itens concluídos?`,
      danger: true,
      action: () => {
        updateItems(listItems.filter((i) => i.status !== "done"));
        toastMsg("Concluídos removidos.");
      },
    });
    setConfirmOpen(true);
  }

  // -------- Voice (SpeechRecognition) --------
  function isSpeechSupported() {
    return typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function stopVoice(silent = false) {
    try {
      if (recRef.current) recRef.current.onend = null;
    } catch {}
    try {
      recRef.current?.stop?.();
    } catch {}
    recRef.current = null;
    restartingRef.current = false;
    setIsListening(false);
    if (!silent) toastMsg("Voz parada. Revise e clique em Adicionar.");
  }

  function startVoice() {
    if (!isSpeechSupported()) {
      toastMsg("Seu navegador não suporta voz (SpeechRecognition).");
      return;
    }
    if (isListening) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    recRef.current = rec;

    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.continuous = true;

    voiceFinalRef.current = voiceFinalRef.current || "";

    rec.onstart = () => {
      setIsListening(true);
      toastMsg("🎙️ Gravando... fale: arroz, detergente, balões (vírgula separa itens)");
    };

    rec.onresult = (e) => {
      let interim = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0]?.transcript || "";
        if (e.results[i].isFinal) {
          voiceFinalRef.current += text + " ";
        } else {
          interim += text;
        }
      }

      const preview = (voiceFinalRef.current + interim).trim();
      setNewItemText(preview);
    };

    rec.onerror = () => {
      setIsListening(false);
      toastMsg("Falha ao usar microfone (permissão ou erro).");
    };

    rec.onend = () => {
      if (!restartingRef.current && isListening) {
        restartingRef.current = true;
        setTimeout(() => {
          restartingRef.current = false;
          try {
            rec.start();
          } catch {
            setIsListening(false);
          }
        }, 250);
      } else {
        setIsListening(false);
      }
    };

    try {
      rec.start();
    } catch {
      toastMsg("Não consegui iniciar o microfone.");
      setIsListening(false);
    }
  }

  const menuItems = selectedList
    ? [
        { label: "Renomear lista", onClick: openRenameModal },
        { label: `Trocar para ${selectedList.type === "compras" ? "Tarefas" : "Compras"}`, onClick: toggleListType },
        { label: `${ctaDoneLabel} (tudo)`, onClick: askMarkAllDone },
        { label: "Resetar lista", onClick: askResetAll, danger: true },
        { label: "Limpar concluídos", onClick: askClearDone, danger: true },
        { label: "Excluir lista", onClick: askDeleteList, danger: true },
      ]
    : [{ label: "Nova lista", onClick: openCreateModal }];

  return (
    <div className="page" onClick={() => { /* nada */ }}>
      <Toast text={toastText} />

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-end" }}>
        <div>
          <h2 className="page-title">📋 Listas</h2>
          <p className="muted small" style={{ marginTop: 6 }}>
            Compras e tarefas, com progresso
          </p>
        </div>

        <button type="button" className="primary-btn" style={{ width: "auto" }} onClick={openCreateModal}>
          + Nova lista
        </button>
      </div>

      <div className="card mt" style={{ padding: 12 }}>
        {listOrder.length === 0 ? (
          <p className="muted">Nenhuma lista ainda.</p>
        ) : (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6 }}>
            {listOrder.map((l) => {
              const p = calcProgress(store.items[l.id] || []);
              const active = l.id === selectedListId;

              return (
                <button
                  type="button"
                  key={l.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedList(l.id);
                  }}
                  className={"chip " + (active ? "chip-active" : "")}
                  style={{ flex: "0 0 auto", width: 210 }}
                  title={`${l.title} • ${p.percent}%`}
                >
                  <div style={{ fontWeight: 800 }}>{l.title}</div>
                  <div className="muted small">
                    {p.done}/{p.total} • {p.percent}%
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!selectedList ? (
        <p className="muted mt">Crie uma lista para começar.</p>
      ) : (
        <>
          <div className="card mt">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 15 }}>{selectedList.title}</strong>
                  <span className="chip" style={{ height: 28, padding: "0 10px" }}>
                    {selectedList.type === "tarefas" ? "🧩 Tarefas" : "🛒 Compras"}
                  </span>
                </div>

                <p className="muted small" style={{ marginTop: 8 }}>
                  Criada em: <strong>{fmtDate(selectedList.createdAt)}</strong>
                  {selectedList.completedAt ? (
                    <>
                      {" "}
                      • Concluída em: <strong>{fmtDate(selectedList.completedAt)}</strong> • apaga automaticamente 7 dias depois
                    </>
                  ) : null}
                </p>

                <div className="progress-container" style={{ marginTop: 8 }}>
                  <ProgressBar percent={progress.percent} />
                  <div className="progress-label">
                    {progress.percent}% • {progress.done}/{progress.total} concluídos
                    {progress.issue ? ` • ⚠ ${progress.issue} problema` : ""}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuModalOpen(true);
                }}
                aria-label="Menu"
                title="Menu"
              >
                ⋯
              </button>
            </div>
          </div>

          <div className="card mt">
            <div className="field">
              <label>Adicionar itens</label>
              <input
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                placeholder="Ex: arroz, detergente, balões (vírgula cria novos itens)"
                onKeyDown={(e) => e.key === "Enter" && addItem()}
              />
              <p className="muted small" style={{ marginTop: 6 }}>
                🎙️ Fale ou digite com vírgulas. Depois clique em <strong>Adicionar</strong>.
              </p>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="primary-btn"
                style={{ width: "auto" }}
                onClick={(e) => {
                  e.stopPropagation();
                  addItem();
                }}
              >
                Adicionar
              </button>

              <button
                type="button"
                className="chip"
                style={{ width: "auto" }}
                onClick={(e) => {
                  e.stopPropagation();
                  clearInput();
                }}
              >
                Limpar
              </button>

              <button
                type="button"
                className={"primary-btn"}
                style={{
                  width: "auto",
                  background: isListening ? "rgba(249,115,115,.28)" : undefined,
                  color: isListening ? "#0b1020" : undefined,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  isListening ? stopVoice() : startVoice();
                }}
                title={isListening ? "Parar voz" : "Gravar por voz"}
              >
                {isListening ? "⏹️ Parar" : "🎙️ Voz"}
              </button>
            </div>

            {!isSpeechSupported() ? (
              <p className="muted small" style={{ marginTop: 10, color: "var(--negative)" }}>
                ⚠️ Voz não suportada neste navegador. (Geralmente funciona no Chrome do Android.)
              </p>
            ) : null}
          </div>

          <div className="card mt">
            <div className="field">
              <label>Buscar</label>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ex.: arroz, lavar roupa..." />
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Tab active={tab === "pending"} label="Pendentes" onClick={() => setTab("pending")} />
              <Tab active={tab === "done"} label="Concluídos" onClick={() => setTab("done")} />
              <Tab active={tab === "issue"} label="Problema" onClick={() => setTab("issue")} />
              <Tab active={tab === "all"} label="Todos" onClick={() => setTab("all")} />
            </div>
          </div>

          <div className="card mt">
            {visibleItems.length === 0 ? (
              <p className="muted">{listItems.length === 0 ? "Sua lista está vazia." : "Nada nesse filtro/busca."}</p>
            ) : (
              <ul className="list">
                {visibleItems.map((i) => {
                  const isEditing = editingId === i.id;

                  return (
                    <li key={i.id} className="list-item" style={{ alignItems: "flex-start" }}>
                      <div style={{ display: "flex", gap: 10, flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, paddingTop: 2 }}>
                          <button
                            type="button"
                            className={"chip " + (i.status === "done" ? "chip-active" : "")}
                            style={{ width: "auto" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setStatus(i.id, i.status === "done" ? "pending" : "done");
                            }}
                            title={i.status === "done" ? "Voltar pendente" : ctaDoneLabel}
                          >
                            ✓
                          </button>

                          <button
                            type="button"
                            className={"chip " + (i.status === "issue" ? "chip-active" : "")}
                            style={{
                              width: "auto",
                              borderColor: i.status === "issue" ? "rgba(249,115,115,.55)" : undefined,
                              color: i.status === "issue" ? "var(--negative)" : undefined,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setStatus(i.id, i.status === "issue" ? "pending" : "issue");
                            }}
                            title={i.status === "issue" ? "Tirar problema" : "Marcar problema"}
                          >
                            !
                          </button>
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          {!isEditing ? (
                            <>
                              <div
                                style={{
                                  wordBreak: "break-word",
                                  textDecoration: i.status === "done" ? "line-through" : "none",
                                  opacity: i.status === "done" ? 0.75 : 1,
                                  color: i.status === "issue" ? "var(--negative)" : "var(--text)",
                                }}
                                title={i.text}
                              >
                                {i.text}
                              </div>

                              <div className="muted small" style={{ marginTop: 6 }}>
                                {i.status === "done" ? "Concluído" : i.status === "issue" ? "Com problema" : "Pendente"}
                                {" • "}Criado: {fmtDate(i.createdAt)}
                                {i.doneAt ? ` • Feito: ${fmtDate(i.doneAt)}` : ""}
                              </div>
                            </>
                          ) : (
                            <div style={{ marginTop: 2 }}>
                              <div className="muted small" style={{ marginBottom: 6 }}>
                                Editando (vírgula = vários itens)
                              </div>

                              <input
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && commitEdit(i.id)}
                                autoFocus
                              />

                              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10, flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  className="primary-btn"
                                  style={{ width: "auto" }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    commitEdit(i.id);
                                  }}
                                >
                                  Salvar
                                </button>

                                <button
                                  type="button"
                                  className="chip"
                                  style={{ width: "auto" }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cancelEdit();
                                  }}
                                >
                                  Cancelar
                                </button>
                              </div>

                              <div className="muted small" style={{ marginTop: 8 }}>
                                {i.status === "done" ? "Concluído" : i.status === "issue" ? "Com problema" : "Pendente"}
                                {" • "}Criado: {fmtDate(i.createdAt)}
                                {i.doneAt ? ` • Feito: ${fmtDate(i.doneAt)}` : ""}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {!isEditing ? (
                          <button
                            type="button"
                            className="chip"
                            style={{ width: "auto" }}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(i, e);
                            }}
                          >
                            Editar
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="chip"
                            style={{ width: "auto" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelEdit();
                            }}
                          >
                            Fechar
                          </button>
                        )}

                        <button
                          type="button"
                          className="chip btn-danger"
                          style={{ width: "auto" }}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeItem(i.id);
                          }}
                        >
                          Excluir
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {/* ---------- MODAL DO MENU (3 pontinhos) ---------- */}
      <Modal open={menuModalOpen} title="Ações da lista" onClose={() => setMenuModalOpen(false)}>
        {selectedList ? (
          <>
            {/* ✅ “feche data” (datas dentro do modal) */}
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              <div className="muted small">
                Criada em: <strong>{fmtDate(selectedList.createdAt)}</strong>
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>
                Concluída em: <strong>{selectedList.completedAt ? fmtDate(selectedList.completedAt) : "—"}</strong>
              </div>
              {selectedList.completedAt ? (
                <div className="muted small" style={{ marginTop: 6 }}>
                  Auto-apaga: <strong>7 dias</strong> depois de concluir
                </div>
              ) : null}
            </div>

            {/* Botões do menu */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {menuItems.map((it) => (
                <button
                  key={it.label}
                  type="button"
                  className={"chip " + (it.danger ? "btn-danger" : "")}
                  style={{ width: "100%" }}
                  onClick={() => {
                    setMenuModalOpen(false);
                    it.onClick?.();
                  }}
                >
                  {it.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <button
            type="button"
            className="primary-btn"
            style={{ width: "100%" }}
            onClick={() => {
              setMenuModalOpen(false);
              openCreateModal();
            }}
          >
            + Nova lista
          </button>
        )}
      </Modal>

      {/* ---------- Modals ---------- */}

      <Modal open={modalCreateOpen} title="Nova lista" onClose={() => setModalCreateOpen(false)}>
        <div className="field">
          <label>Nome da lista</label>
          <input
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            placeholder="Ex: Casa, Festa, Materiais..."
            onKeyDown={(e) => e.key === "Enter" && createList()}
            autoFocus
          />
        </div>

        <div className="field">
          <label>Tipo</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setCreateType("compras")} className={"chip " + (createType === "compras" ? "chip-active" : "")}>
              🛒 Compras
            </button>
            <button type="button" onClick={() => setCreateType("tarefas")} className={"chip " + (createType === "tarefas" ? "chip-active" : "")}>
              🧩 Tarefas
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" className="chip" style={{ width: "auto" }} onClick={() => setModalCreateOpen(false)}>
            Cancelar
          </button>
          <button type="button" className="primary-btn" style={{ width: "auto" }} onClick={createList}>
            Criar
          </button>
        </div>
      </Modal>

      <Modal open={modalRenameOpen} title="Renomear lista" onClose={() => setModalRenameOpen(false)}>
        <div className="field">
          <label>Novo nome</label>
          <input
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && renameList()}
            autoFocus
          />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" className="chip" style={{ width: "auto" }} onClick={() => setModalRenameOpen(false)}>
            Cancelar
          </button>
          <button type="button" className="primary-btn" style={{ width: "auto" }} onClick={renameList}>
            Salvar
          </button>
        </div>
      </Modal>

      <Modal open={confirmOpen} title={confirmCfg.title || "Confirmar"} onClose={() => setConfirmOpen(false)}>
        <div className="muted" style={{ lineHeight: 1.35 }}>
          {confirmCfg.body}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" className="chip" style={{ width: "auto" }} onClick={() => setConfirmOpen(false)}>
            Cancelar
          </button>
          <button
            type="button"
            className={"primary-btn " + (confirmCfg.danger ? "btn-danger" : "")}
            style={{ width: "auto" }}
            onClick={() => {
              setConfirmOpen(false);
              confirmCfg.action?.();
            }}
          >
            Confirmar
          </button>
        </div>
      </Modal>
    </div>
  );
}
