// src/pages/LembretesPage.jsx

// Importa React e hooks:
// - useEffect: roda efeitos (carregar do localStorage, timers, listeners, etc.)
// - useMemo: memoriza valores calculados (lista visível filtrada/ordenada)
// - useRef: guarda referências mutáveis sem re-render (SpeechRecognition e texto final)
// - useState: estados do formulário/UI
import React, { useEffect, useMemo, useRef, useState } from "react";

// Chave usada para salvar/carregar os lembretes no localStorage
const LS_KEY = "pwa_lembretes_v1";

/* -------- helpers -------- */

// Faz parse de JSON com fallback seguro (se der erro, retorna fallback)
function safeJSONParse(v, fallback) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

// Gera um id único:
// - se o navegador suportar crypto.randomUUID, usa ele
// - senão usa um id “manual” misturando random + timestamp
function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

// Retorna o “agora” em formato ISO (bom para guardar datas no storage)
function nowISO() {
  return new Date().toISOString();
}

// Normaliza texto para busca:
// - remove espaços extras
// - minúsculo
// - remove acentos/diacríticos
function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Preenche número com 2 dígitos (ex: 3 -> "03")
function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Converte datetime-local ("YYYY-MM-DDTHH:mm") em Date (local) */
// Converte o valor do input datetime-local em um Date na timezone local.
// Retorna null se estiver inválido.
function parseLocalDateTime(v) {
  try {
    const [datePart, timePart] = String(v || "").split("T");
    if (!datePart || !timePart) return null;
    const [y, m, d] = datePart.split("-").map(Number);
    const [hh, mm] = timePart.split(":").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
  } catch {
    return null;
  }
}

// Gera uma “chave do dia” local no formato YYYY-MM-DD (para evitar notificar duas vezes no dia)
function toLocalDateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Formata um ISO em pt-BR (data e hora)
// Se ISO inválido, retorna "-"
function fmtBRDateTimeISO(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("pt-BR");
}

// Formata um datetime-local em pt-BR (data e hora)
// Se inválido, retorna "-"
function fmtBRDateTimeLocal(datetimeLocal) {
  const d = parseLocalDateTime(datetimeLocal);
  if (!d) return "-";
  return d.toLocaleString("pt-BR");
}

// Soma X dias em uma data (retorna um novo Date)
function addDays(dateObj, days) {
  const d = new Date(dateObj);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

// Converte "dias/semanas" + "a cada N" em quantidade de dias
function unitToDays(unit, every) {
  const n = Math.max(1, Number(every || 1));
  if (unit === "semanas") return n * 7;
  return n; // dias
}

// Cria uma data (baseDate) com um horário HH:mm específico
function makeDateAtTime(baseDate, timeHHmm) {
  const d = new Date(baseDate);
  const [hh, mm] = String(timeHHmm || "09:00").split(":").map(Number);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
}

/** Cria a próxima ocorrência: se hoje já passou do horário, empurra para +intervalo */
// Para recorrente: calcula o próximo "due":
// - pega hoje no horário escolhido
// - se esse horário já passou, joga para +intervalDays
function computeNextDueFromNow(intervalDays, timeHHmm) {
  const base = makeDateAtTime(new Date(), timeHHmm || "09:00");
  if (base.getTime() <= Date.now()) return addDays(base, intervalDays || 1);
  return base;
}

/* ---------------- UI pieces (Modal / Toast) ---------------- */

// Componente simples de Toast: aparece se tiver texto
function Toast({ text }) {
  if (!text) return null;
  return <div className="toast">{text}</div>;
}

// Componente de Modal genérico:
// - fecha no ESC
// - fecha clicando fora (overlay)
// - impede clique “vazar” no card interno
function Modal({ open, title, children, onClose }) {
  // Se o modal estiver aberto, adiciona listener de tecla para ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Se não estiver aberto, não renderiza nada
  if (!open) return null;

  // Estrutura do modal: overlay + card central
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        {title ? <div style={{ fontWeight: 800, marginBottom: 8 }}>{title}</div> : null}
        <div style={{ marginTop: 10, textAlign: "left" }}>{children}</div>
      </div>
    </div>
  );
}

/* -------------------- Page -------------------- */

// Página principal de Lembretes
export default function LembretesPage() {
  // Lista de lembretes carregada/salva no localStorage
  const [list, setList] = useState([]);

  // ✅ Form
  // Tipo do lembrete que será criado (avulso: uma vez / recorrente: repete)
  const [tipo, setTipo] = useState("avulso"); // avulso | recorrente
  // Título digitado (ou falado por voz)
  const [titulo, setTitulo] = useState("");
  // Data/hora (somente para avulso) - formato datetime-local
  const [quando, setQuando] = useState(""); // datetime-local (avulso)
  // Recorrente: intervalo numérico (a cada X)
  const [every, setEvery] = useState("3"); // recorrente: a cada
  // Recorrente: unidade do intervalo (dias ou semanas)
  const [unit, setUnit] = useState("dias"); // dias | semanas
  // Recorrente: horário do disparo do lembrete
  const [timeHHmm, setTimeHHmm] = useState("09:00"); // recorrente: horário

  // ✅ UI
  // Texto do toast (mensagens rápidas na tela)
  const [toastText, setToastText] = useState("");
  // Texto de busca da lista
  const [search, setSearch] = useState("");
  // Aba: pendentes / concluídos / todos
  const [tab, setTab] = useState("pending"); // pending | done | all

  // ✅ Modal do menu (3 pontinhos)
  const [menuModalOpen, setMenuModalOpen] = useState(false);

  // ✅ Confirm modal (confirmar ações perigosas)
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Configuração do confirm (título, texto, estilo de perigo e a ação a executar)
  const [confirmCfg, setConfirmCfg] = useState({ title: "", body: "", danger: false, action: null });

  // ✅ Edit
  // Quando está editando algum item, guarda o id
  const [editingId, setEditingId] = useState(null);
  // Campos do formulário de edição
  const [editingTipo, setEditingTipo] = useState("avulso");
  const [editingTitulo, setEditingTitulo] = useState("");
  const [editingQuando, setEditingQuando] = useState("");
  const [editingEvery, setEditingEvery] = useState("3");
  const [editingUnit, setEditingUnit] = useState("dias");
  const [editingTime, setEditingTime] = useState("09:00");

  // 🎙️ voz
  // Se o navegador suporta reconhecimento de voz
  const [voiceSupported, setVoiceSupported] = useState(false);
  // Se está gravando/ouvindo
  const [listening, setListening] = useState(false);
  // Mensagem de erro de voz (microfone/permissão/etc.)
  const [voiceError, setVoiceError] = useState("");
  // Referência pro objeto de reconhecimento (SpeechRecognition)
  const recRef = useRef(null);
  // Guarda o texto final acumulado do reconhecimento (resultados “final”)
  const voiceFinalRef = useRef("");

  // ✅ Load
  // Carrega lista do localStorage quando a página monta
  useEffect(() => {
    const saved = safeJSONParse(localStorage.getItem(LS_KEY) || "[]", []);
    setList(Array.isArray(saved) ? saved : []);
  }, []);

  // Salva (estado + localStorage) de uma vez
  function save(next) {
    setList(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  }

  // Dispara um toast
  function toastMsg(t) {
    setToastText(t);
  }

  // Timer para esconder o toast depois de 2.2s
  useEffect(() => {
    if (!toastText) return;
    const t = setTimeout(() => setToastText(""), 2200);
    return () => clearTimeout(t);
  }, [toastText]);

  // ✅ Voice init
  // Inicializa SpeechRecognition uma vez no mount
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    // Se não existir, desativa suporte
    if (!SR) {
      setVoiceSupported(false);
      return;
    }

    // Marca que existe suporte
    setVoiceSupported(true);

    // Cria o reconhecedor
    const rec = new SR();
    // Idioma do reconhecimento
    rec.lang = "pt-BR";
    // interimResults: retorna resultados parciais enquanto fala
    rec.interimResults = true;
    // continuous: continua ouvindo até parar manualmente
    rec.continuous = true;

    // Ao iniciar a gravação
    rec.onstart = () => {
      setVoiceError("");
      setListening(true);
      toastMsg("🎙️ Gravando... fale o título. Depois clique em Parar.");
    };

    // Ao terminar (parou de ouvir)
    rec.onend = () => {
      setListening(false);
    };

    // Quando dá erro (permissão, microfone, etc.)
    rec.onerror = (e) => {
      setVoiceError(e?.error || "Erro no microfone");
      setListening(false);
    };

    // Quando chegam resultados de fala
    rec.onresult = (event) => {
      let interim = "";
      // Percorre resultados desde o índice informado pelo evento
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0]?.transcript || "";
        // Se for final, acumula no ref final
        if (event.results[i].isFinal) voiceFinalRef.current += text + " ";
        // Se for parcial, monta o preview
        else interim += text;
      }
      // Junta final + parcial para mostrar no input
      const preview = (voiceFinalRef.current + interim).trim();
      if (preview) setTitulo(preview);
    };

    // Guarda o reconhecedor no ref para usar depois
    recRef.current = rec;

    // Cleanup: tenta parar o reconhecimento ao desmontar
    return () => {
      try {
        rec.stop();
      } catch {}
    };
  }, []);

  // Alterna gravar/parar voz
  function toggleVoice() {
    setVoiceError("");
    // Se não suporta, avisa
    if (!voiceSupported) return alert("Seu navegador não suporta ditado por voz.");
    const rec = recRef.current;
    if (!rec) return;

    try {
      // Se está ouvindo, para
      if (listening) rec.stop();
      else {
        // Se já tem texto no título, começa acumulando a partir dele
        voiceFinalRef.current = titulo ? titulo + " " : "";
        // Inicia reconhecimento
        rec.start();
      }
    } catch {
      setVoiceError("Não consegui iniciar o microfone. Tente novamente.");
      setListening(false);
    }
  }

  // Solicita permissão de notificações do navegador
  async function enableNotifications() {
    if (!("Notification" in window)) return alert("Seu navegador não suporta notificações.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") alert("Notificações não permitidas.");
    else toastMsg("Notificações ativadas ✅");
  }

  // Agenda uma notificação “in-page” usando setTimeout:
  // (só funciona se o app estiver aberto quando chegar a hora)
  function scheduleInPageNotification(title, whenDate) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (!whenDate) return;

    // Calcula quanto falta
    const ms = whenDate.getTime() - Date.now();
    // Se já passou, não agenda
    if (ms <= 0) return;

    // Agenda para disparar no futuro
    setTimeout(() => {
      try {
        new Notification("⏰ Lembrete", { body: title });
      } catch {}
    }, ms);
  }

  // ✅ checa recorrentes: no horário do dia dispara e move pro próximo
  // Função que verifica recorrentes:
  // - se chegou a hora do nextDueISO
  // - dispara notificação
  // - evita duplicar no mesmo dia (lastNotifiedDate)
  // - recalcula nextDueISO para o próximo ciclo
  function checkRecurringTick() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const todayKey = toLocalDateKey(new Date());
    const now = Date.now();
    let changed = false;

    // Percorre lista e atualiza apenas recorrentes que “venceram”
    const next = list.map((item) => {
      if (item.tipo !== "recorrente") return item;
      if (!item.enabled) return item;

      const due = new Date(item.nextDueISO || "");
      if (Number.isNaN(due.getTime())) return item;

      // ainda não chegou
      if (now < due.getTime()) return item;

      // evita duplicar no mesmo dia
      if (item.lastNotifiedDate === todayKey) return item;

      // dispara notificação do dia
      try {
        new Notification("📌 Lembrete do dia", { body: `${item.titulo} hoje` });
      } catch {}

      // move pro próximo ciclo
      const intervalDays = unitToDays(item.unit, item.every);
      const nextDue = addDays(due, intervalDays);

      changed = true;
      return {
        ...item,
        lastNotifiedDate: todayKey,
        nextDueISO: nextDue.toISOString(),
        updatedAt: nowISO(),
      };
    });

    // Se mudou algo, salva
    if (changed) save(next);
  }

  // ✅ agenda/checa
  useEffect(() => {
    // agenda avisos para avulsos e recorrentes (quando app aberto)
    (list || []).forEach((i) => {
      // Para avulso: agenda notificação na data/hora do “quando”
      if (i.tipo === "avulso" && i.quando) {
        const dt = parseLocalDateTime(i.quando);
        if (dt) scheduleInPageNotification(i.titulo, dt);
      }
      // Para recorrente: agenda notificação na data/hora do nextDueISO
      if (i.tipo === "recorrente" && i.nextDueISO && i.enabled) {
        const dt = new Date(i.nextDueISO);
        if (!Number.isNaN(dt.getTime())) scheduleInPageNotification(`${i.titulo} hoje`, dt);
      }
    });

    // checa agora + a cada 1 minuto
    checkRecurringTick();
    const id = setInterval(checkRecurringTick, 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  // Adiciona um novo lembrete (avulso ou recorrente)
  function add() {
    const t = titulo.trim();
    if (!t) return toastMsg("Preencha o título.");

    // Se for avulso, exige data/hora e salva com campo "quando"
    if (tipo === "avulso") {
      if (!quando) return toastMsg("Preencha a data/hora.");
      const item = {
        id: uuid(),
        tipo: "avulso",
        titulo: t,
        quando,
        done: false,
        createdAt: nowISO(),
        doneAt: null,
        updatedAt: nowISO(),
      };
      // Insere e ordena pelo "quando"
      const next = [item, ...list].sort((a, b) => String(a.quando || "").localeCompare(String(b.quando || "")));
      save(next);

      // Agenda notificação do avulso (quando app estiver aberto)
      const dt = parseLocalDateTime(item.quando);
      scheduleInPageNotification(item.titulo, dt);

      // Limpa campos do form
      setTitulo("");
      setQuando("");
      voiceFinalRef.current = "";
      toastMsg("Lembrete salvo.");
      return;
    }

    // recorrente
    // Converte unidade + "a cada" em dias e calcula o próximo disparo
    const intervalDays = unitToDays(unit, every);
    const nextDue = computeNextDueFromNow(intervalDays, timeHHmm);

    // Monta item recorrente
    const item = {
      id: uuid(),
      tipo: "recorrente",
      titulo: t,
      every: String(Math.max(1, Number(every || 1))),
      unit, // dias | semanas
      timeHHmm,
      enabled: true,
      nextDueISO: nextDue.toISOString(),
      lastNotifiedDate: null,
      paidAt: null, // último "pago/feito"
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    // Insere e ordena por nextDueISO
    const next = [item, ...list].sort((a, b) => String(a.nextDueISO || "").localeCompare(String(b.nextDueISO || "")));
    save(next);

    // Agenda notificação do recorrente (quando app estiver aberto)
    scheduleInPageNotification(`${item.titulo} hoje`, new Date(item.nextDueISO));

    // Limpa form
    setTitulo("");
    setEvery("3");
    setUnit("dias");
    setTimeHHmm("09:00");
    voiceFinalRef.current = "";
    toastMsg("Recorrente salvo.");
  }

  // Alterna concluído para lembretes avulsos
  function toggleDoneAvulso(id) {
    const next = list.map((i) => {
      if (i.id !== id) return i;
      if (i.tipo !== "avulso") return i;
      const done = !i.done;
      return { ...i, done, doneAt: done ? nowISO() : null, updatedAt: nowISO() };
    });
    save(next);
  }

  // ✅ “pagar/feito” no recorrente: joga para o próximo ciclo
  // Marca o recorrente como feito agora e recalcula o próximo nextDueISO
  function payRecurring(id) {
    const todayKey = toLocalDateKey(new Date());

    const next = list.map((i) => {
      if (i.id !== id) return i;
      if (i.tipo !== "recorrente") return i;

      // Calcula intervalo em dias
      const intervalDays = unitToDays(i.unit, i.every);
      // Usa a data base (nextDueISO atual); se inválida, usa “agora no horário configurado”
      const base = new Date(i.nextDueISO || "");
      const validBase = Number.isNaN(base.getTime()) ? makeDateAtTime(new Date(), i.timeHHmm) : base;

      // Joga para o próximo ciclo
      const newDue = addDays(validBase, intervalDays);

      return {
        ...i,
        paidAt: nowISO(),
        lastNotifiedDate: todayKey, // evita notificar de novo hoje
        nextDueISO: newDue.toISOString(),
        updatedAt: nowISO(),
      };
    });

    save(next);
    toastMsg("Pago/Feito ✅ Próximo agendado.");
  }

  // ✅ Pagar tudo (recorrentes) SEM APAGAR
  // Essa função só atualiza os recorrentes (reagenda o próximo), nunca remove da lista.
  // Se você quiser pagar só os vencidos, dá pra trocar a lógica (base.getTime() > Date.now()) return i;
  function payAllRecurring() {
    const todayKey = toLocalDateKey(new Date());

    let count = 0;

    const next = list.map((i) => {
      if (i.tipo !== "recorrente") return i;
      if (!i.enabled) return i;

      // Calcula intervalo em dias
      const intervalDays = unitToDays(i.unit, i.every);

      // Usa a data base (nextDueISO atual); se inválida, usa “agora no horário configurado”
      const base = new Date(i.nextDueISO || "");
      const validBase = Number.isNaN(base.getTime()) ? makeDateAtTime(new Date(), i.timeHHmm) : base;

      // Joga para o próximo ciclo
      const newDue = addDays(validBase, intervalDays);

      count += 1;

      return {
        ...i,
        paidAt: nowISO(),
        lastNotifiedDate: todayKey,
        nextDueISO: newDue.toISOString(),
        updatedAt: nowISO(),
      };
    });

    if (count === 0) return toastMsg("Nenhum recorrente para pagar.");
    save(next);
    toastMsg(`Pago/Feito ✅ (${count}) recorrente(s)`);
  }

  // Abre modal de confirmação para remover um item
  function askRemove(id) {
    setConfirmCfg({
      title: "Excluir lembrete",
      body: "Excluir este lembrete?",
      danger: true,
      action: () => {
        save(list.filter((i) => i.id !== id));
        toastMsg("Excluído.");
      },
    });
    setConfirmOpen(true);
  }

  // ✅ Edit
  // Entra em modo edição para um item (preenche estados de edição)
  function startEdit(item, e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    setEditingId(item.id);
    setEditingTipo(item.tipo || "avulso");
    setEditingTitulo(item.titulo || "");

    // Se for avulso, preenche "quando" e reseta campos recorrentes
    if (item.tipo === "avulso") {
      setEditingQuando(item.quando || "");
      setEditingEvery("3");
      setEditingUnit("dias");
      setEditingTime("09:00");
    } else {
      // Se for recorrente, preenche campos recorrentes e limpa "quando"
      setEditingQuando("");
      setEditingEvery(String(item.every || "3"));
      setEditingUnit(item.unit || "dias");
      setEditingTime(item.timeHHmm || "09:00");
    }
  }

  // Cancela edição e limpa estados
  function cancelEdit() {
    setEditingId(null);
    setEditingTipo("avulso");
    setEditingTitulo("");
    setEditingQuando("");
    setEditingEvery("3");
    setEditingUnit("dias");
    setEditingTime("09:00");
  }

  // Salva edição (valida e atualiza item na lista)
  function commitEdit(id) {
    const t = editingTitulo.trim();
    if (!t) return toastMsg("Preencha o título.");

    const next = list.map((i) => {
      if (i.id !== id) return i;

      // Se o item original é avulso, exige data/hora
      if (i.tipo === "avulso") {
        if (!editingQuando) {
          toastMsg("Preencha a data/hora.");
          return i;
        }
        return {
          ...i,
          titulo: t,
          quando: editingQuando,
          updatedAt: nowISO(),
        };
      }

      // recorrente
      // Recalcula próximo vencimento com os novos parâmetros
      const intervalDays = unitToDays(editingUnit, editingEvery);
      const nextDue = computeNextDueFromNow(intervalDays, editingTime);

      return {
        ...i,
        titulo: t,
        every: String(Math.max(1, Number(editingEvery || 1))),
        unit: editingUnit,
        timeHHmm: editingTime,
        nextDueISO: nextDue.toISOString(),
        updatedAt: nowISO(),
      };
    });

    save(next);
    cancelEdit();
    toastMsg("Atualizado.");
  }

  // Pausa/ativa um recorrente
  function toggleRecurringEnabled(id) {
    const next = list.map((i) => {
      if (i.id !== id) return i;
      if (i.tipo !== "recorrente") return i;
      return { ...i, enabled: !i.enabled, updatedAt: nowISO() };
    });
    save(next);
  }

  // ✅ Menu actions
  // Pede confirmação para apagar avulsos concluídos
  function askClearDone() {
    const doneCount = list.filter((i) => i.tipo === "avulso" && !!i.done).length;
    if (doneCount === 0) return toastMsg("Nada concluído para limpar.");
    setConfirmCfg({
      title: "Limpar concluídos",
      body: `Apagar ${doneCount} lembrete(s) avulso(s) concluído(s)?`,
      danger: true,
      action: () => {
        save(list.filter((i) => !(i.tipo === "avulso" && i.done)));
        toastMsg("Concluídos removidos.");
      },
    });
    setConfirmOpen(true);
  }

  // Pede confirmação para apagar tudo
  function askClearAll() {
    if (list.length === 0) return toastMsg("Lista vazia.");
    setConfirmCfg({
      title: "Apagar tudo",
      body: "Apagar TODOS os lembretes? (não dá para desfazer)",
      danger: true,
      action: () => {
        save([]);
        toastMsg("Tudo apagado.");
      },
    });
    setConfirmOpen(true);
  }

  // Itens do menu (modal ⋯)
  const menuItems = [
    { label: "Ativar notificações", danger: false, onClick: enableNotifications },

    // ✅ Botão que você queria: paga todos os recorrentes SEM APAGAR
    { label: "Pagar tudo (recorrentes)", danger: false, onClick: payAllRecurring },

    { label: "Limpar concluídos (avulsos)", danger: true, onClick: askClearDone },
    { label: "Apagar tudo", danger: true, onClick: askClearAll },
  ];

  // Lista visível calculada:
  // - filtra por aba (pendentes/concluídos/todos)
  // - filtra por busca
  // - ordena por data (recorrente: nextDueISO, avulso: quando)
  const visible = useMemo(() => {
    const q = normalizeText(search);
    let base = list;

    // Filtra pela tab
    if (tab !== "all") {
      base = base.filter((i) => {
        if (i.tipo === "avulso") return tab === "done" ? i.done : !i.done;
        // recorrente entra sempre como "pending" (não faz sentido done fixo)
        return tab !== "done";
      });
    }

    // Filtra por texto no título
    if (q) base = base.filter((i) => normalizeText(i.titulo).includes(q));

    // ordena: recorrentes por nextDue, avulsos por quando
    return base.slice().sort((a, b) => {
      const ax = a.tipo === "recorrente" ? (a.nextDueISO || "") : (a.quando || "");
      const bx = b.tipo === "recorrente" ? (b.nextDueISO || "") : (b.quando || "");
      return String(ax).localeCompare(String(bx));
    });
  }, [list, tab, search]);

  // JSX da tela
  return (
    <div className="page">
      {/* Toast de mensagens */}
      <Toast text={toastText} />

      {/* Cabeçalho com título e botão ⋯ (menu) */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-end" }}>
        <div>
          <h2 className="page-title">⏰ Lembretes</h2>
          <p className="muted small" style={{ marginTop: 6 }}>
            Avulsos e recorrentes (editar + pagar/feito)
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="icon-btn"
            onClick={(e) => {
              // Evita clique “subir” e abre o modal do menu
              e.preventDefault();
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

      {/* MODAL DO MENU */}
      <Modal open={menuModalOpen} title="Opções" onClose={() => setMenuModalOpen(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Botões do menu */}
          {menuItems.map((it) => (
            <button
              key={it.label}
              type="button"
              className="chip"
              style={{
                width: "100%",
                textAlign: "left",
                borderColor: it.danger ? "rgba(248,113,113,.55)" : undefined,
                color: it.danger ? "var(--negative)" : undefined,
              }}
              onClick={() => {
                // Fecha modal e executa ação do item
                setMenuModalOpen(false);
                it.onClick?.();
              }}
            >
              {it.label}
            </button>
          ))}

          {/* Botão para fechar o menu */}
          <button
            type="button"
            className="primary-btn"
            style={{ width: "auto", padding: "10px 14px", alignSelf: "flex-end" }}
            onClick={() => setMenuModalOpen(false)}
          >
            Fechar
          </button>
        </div>
      </Modal>

      {/* Card: adicionar lembrete */}
      <div className="card mt">
        {/* Primeira linha: tipo + ativar notificações */}
        <div className="filters-grid">
          <div className="field">
            <label>Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="avulso">Avulso (uma vez)</option>
              <option value="recorrente">Recorrente (de quanto em quanto)</option>
            </select>
          </div>

          <div className="field">
            <label>Notificações</label>
            <button type="button" className="chip" onClick={enableNotifications}>
              🔔 Ativar
            </button>
          </div>
        </div>

        {/* Campo título + dica de voz */}
        <div className="field mt">
          <label>Título</label>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder='Ex: "Lavar banheiro"' />
          <div className="muted small" style={{ marginTop: 6 }}>
            {voiceSupported ? (
              <>
                Dica: 🎙️ fale o título → ⏹️ pare → ajuste se quiser.
                {voiceError ? <div style={{ marginTop: 6, color: "var(--negative)" }}>⚠️ {voiceError}</div> : null}
              </>
            ) : (
              <>Seu navegador não suporta ditado por voz.</>
            )}
          </div>
        </div>

        {/* Botões: voz e limpar título */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="primary-btn"
            style={{
              width: "auto",
              padding: "10px 14px",
              // Quando está gravando, muda o fundo para sinalizar
              background: listening ? "rgba(248,113,113,.25)" : undefined,
            }}
            onClick={(e) => {
              // Evita clique subir e alterna gravação
              e.stopPropagation();
              toggleVoice();
            }}
          >
            {listening ? "⏹️ Parar" : "🎙️ Voz"}
          </button>

          <button
            type="button"
            className="chip"
            style={{ width: "auto" }}
            onClick={(e) => {
              // Limpa o título e o buffer final de voz
              e.stopPropagation();
              setTitulo("");
              voiceFinalRef.current = "";
              toastMsg("Título limpo.");
            }}
          >
            Limpar título
          </button>
        </div>

        {/* Se avulso: mostra datetime-local; se recorrente: mostra a cada/unidade/horário */}
        {tipo === "avulso" ? (
          <div className="field" style={{ marginTop: 12 }}>
            <label>Quando</label>
            <input value={quando} onChange={(e) => setQuando(e.target.value)} type="datetime-local" />
          </div>
        ) : (
          <div className="filters-grid" style={{ marginTop: 12 }}>
            <div className="field">
              <label>A cada</label>
              <input value={every} onChange={(e) => setEvery(e.target.value)} inputMode="numeric" placeholder="Ex: 3" />
            </div>
            <div className="field">
              <label>Unidade</label>
              <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="dias">dias</option>
                <option value="semanas">semanas</option>
              </select>
            </div>
            <div className="field">
              <label>Horário</label>
              <input type="time" value={timeHHmm} onChange={(e) => setTimeHHmm(e.target.value)} />
            </div>
          </div>
        )}

        {/* Botão salvar */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            className="primary-btn"
            style={{ width: "auto", padding: "10px 14px" }}
            onClick={(e) => {
              // Evita clique subir e salva
              e.stopPropagation();
              add();
            }}
          >
            Salvar
          </button>
        </div>
      </div>

      {/* Card: busca + tabs */}
      <div className="card mt">
        <div className="field">
          <label>Buscar</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ex.: banheiro, máquina..." />
        </div>

        {/* Abas de filtro */}
        <div className="chips-row">
          <button type="button" className={"chip " + (tab === "pending" ? "chip-active" : "")} onClick={() => setTab("pending")}>
            Pendentes
          </button>
          <button type="button" className={"chip " + (tab === "done" ? "chip-active" : "")} onClick={() => setTab("done")}>
            Concluídos
          </button>
          <button type="button" className={"chip " + (tab === "all" ? "chip-active" : "")} onClick={() => setTab("all")}>
            Todos
          </button>
        </div>
      </div>

      {/* Card: lista */}
      <div className="card mt">
        {/* Se não tem nada visível, mostra mensagem */}
        {visible.length === 0 ? (
          <p className="muted">{list.length === 0 ? "Nenhum lembrete ainda." : "Nada nesse filtro/busca."}</p>
        ) : (
          // Lista de itens visíveis (filtrados e ordenados)
          <ul className="list">
            {visible.map((i) => {
              // Se o item atual está em edição
              const isEditing = editingId === i.id;

              return (
                <li key={i.id} className="list-item" style={{ alignItems: "flex-start", gap: 10 }}>
                  {/* Coluna principal: conteúdo do item */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {!isEditing ? (
                      <>
                        {/* Título e badge de tipo */}
                        <div
                          style={{
                            fontWeight: 800,
                            // Ajusta opacidade para itens concluídos (avulso) ou pausados (recorrente)
                            opacity: i.tipo === "avulso" && i.done ? 0.65 : i.tipo === "recorrente" && i.enabled === false ? 0.6 : 1,
                            // Risco no texto quando avulso concluído
                            textDecoration: i.tipo === "avulso" && i.done ? "line-through" : "none",
                          }}
                        >
                          {i.titulo}{" "}
                          <span className="muted small" style={{ fontWeight: 600 }}>
                            {i.tipo === "recorrente" ? "• recorrente" : "• avulso"}
                          </span>
                        </div>

                        {/* Linha de detalhes: data/hora do avulso ou programação do recorrente */}
                        <div className="muted small" style={{ marginTop: 4 }}>
                          {i.tipo === "avulso" ? (
                            <>📅 {fmtBRDateTimeLocal(i.quando)}</>
                          ) : (
                            <>
                              ⏱ Próximo: <b>{fmtBRDateTimeISO(i.nextDueISO)}</b> • a cada <b>{i.every}</b> {i.unit} • {i.timeHHmm}{" "}
                              {i.enabled === false ? "• (pausado)" : ""}
                            </>
                          )}
                        </div>
                      </>
                    ) : (
                      // Modo edição: mostra formulário no lugar do texto normal
                      <div>
                        <div className="muted small" style={{ marginBottom: 8 }}>
                          Editando
                        </div>

                        <div className="field" style={{ marginTop: 0 }}>
                          <label>Título</label>
                          <input value={editingTitulo} onChange={(e) => setEditingTitulo(e.target.value)} />
                        </div>

                        {editingTipo === "avulso" ? (
                          <div className="field">
                            <label>Quando</label>
                            <input type="datetime-local" value={editingQuando} onChange={(e) => setEditingQuando(e.target.value)} />
                          </div>
                        ) : (
                          <div className="filters-grid">
                            <div className="field">
                              <label>A cada</label>
                              <input value={editingEvery} onChange={(e) => setEditingEvery(e.target.value)} inputMode="numeric" />
                            </div>
                            <div className="field">
                              <label>Unidade</label>
                              <select value={editingUnit} onChange={(e) => setEditingUnit(e.target.value)}>
                                <option value="dias">dias</option>
                                <option value="semanas">semanas</option>
                              </select>
                            </div>
                            <div className="field">
                              <label>Horário</label>
                              <input type="time" value={editingTime} onChange={(e) => setEditingTime(e.target.value)} />
                            </div>
                          </div>
                        )}

                        {/* Botões salvar/cancelar no modo edição */}
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="primary-btn"
                            style={{ width: "auto", padding: "8px 12px" }}
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
                      </div>
                    )}
                  </div>

                  {/* Coluna de ações (botões) */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {!isEditing ? (
                      <>
                        {/* Ações específicas por tipo */}
                        {i.tipo === "avulso" ? (
                          // Botão “Feito/Reabrir” para avulso
                          <button
                            type="button"
                            className={"chip " + (i.done ? "chip-active" : "")}
                            style={{ width: "auto" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleDoneAvulso(i.id);
                            }}
                          >
                            {i.done ? "Reabrir" : "Feito"}
                          </button>
                        ) : (
                          <>
                            {/* Botão “Pago/Feito” do recorrente: move para próximo ciclo */}
                            <button
                              type="button"
                              className="primary-btn"
                              style={{ width: "auto", padding: "8px 12px" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                payRecurring(i.id);
                              }}
                              title="Marca como feito e agenda o próximo"
                            >
                              Pago/Feito
                            </button>

                            {/* Botão para pausar/ativar recorrente */}
                            <button
                              type="button"
                              className={"chip " + (i.enabled ? "chip-active" : "")}
                              style={{ width: "auto" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRecurringEnabled(i.id);
                              }}
                              title="Pausar/ativar recorrente"
                            >
                              {i.enabled ? "Ativo" : "Pausado"}
                            </button>
                          </>
                        )}

                        {/* Botão editar */}
                        <button
                          type="button"
                          className="chip"
                          style={{ width: "auto" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(i, e);
                          }}
                        >
                          Editar
                        </button>

                        {/* Botão excluir (com estilo de perigo) */}
                        <button
                          type="button"
                          className="chip"
                          style={{ width: "auto", borderColor: "rgba(248,113,113,.55)", color: "var(--negative)" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            askRemove(i.id);
                          }}
                        >
                          Excluir
                        </button>
                      </>
                    ) : (
                      // Se estiver editando, mostra botão para fechar/cancelar edição
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
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Modal confirmar */}
      <Modal open={confirmOpen} title={confirmCfg.title || "Confirmar"} onClose={() => setConfirmOpen(false)}>
        {/* Corpo do confirm */}
        <div className="muted" style={{ lineHeight: 1.35 }}>
          {confirmCfg.body}
        </div>

        {/* Botões do confirm */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" className="chip" style={{ width: "auto" }} onClick={() => setConfirmOpen(false)}>
            Cancelar
          </button>
          <button
            type="button"
            className="primary-btn"
            style={{
              width: "auto",
              padding: "10px 14px",
              // Se for ação perigosa, pinta de vermelho
              background: confirmCfg.danger ? "#f97373" : undefined,
              color: confirmCfg.danger ? "#111827" : undefined,
            }}
            onClick={() => {
              // Fecha modal e executa ação configurada
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
