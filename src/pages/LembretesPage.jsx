// src/pages/LembretesPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "pwa_lembretes_v1";

/* -------- helpers -------- */

function safeJSONParse(v, fallback) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function nowISO() {
  return new Date().toISOString();
}

function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

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

function toLocalDateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fmtBRDateTimeISO(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("pt-BR");
}

function fmtBRDateTimeLocal(datetimeLocal) {
  const d = parseLocalDateTime(datetimeLocal);
  if (!d) return "-";
  return d.toLocaleString("pt-BR");
}

function addDays(dateObj, days) {
  const d = new Date(dateObj);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function unitToDays(unit, every) {
  const n = Math.max(1, Number(every || 1));
  if (unit === "semanas") return n * 7;
  return n;
}

function makeDateAtTime(baseDate, timeHHmm) {
  const d = new Date(baseDate);
  const [hh, mm] = String(timeHHmm || "09:00").split(":").map(Number);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
}

// ✅ Parse "1, 5, 10" -> [1,5,10]
function parseMonthDaysList(s) {
  const raw = String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const nums = raw
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 31);

  // remove duplicados e ordena
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

// Ajusta "dia do mês" para último dia do mês (ex: 31 em fevereiro vira 28/29)
function clampDayToMonth(year, monthIndex, day) {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(Math.max(1, day), last);
}

// ✅ Próxima ocorrência por intervalo (mantém o seu comportamento)
function computeNextDueIntervalFromNow(intervalDays, timeHHmm) {
  const base = makeDateAtTime(new Date(), timeHHmm || "09:00");
  if (base.getTime() <= Date.now()) return addDays(base, intervalDays || 1);
  return base;
}

// ✅ Próxima ocorrência a partir de uma data base (usado para “pagar/feito” e tick)
function computeNextDueIntervalFromBase(baseDate, intervalDays, timeHHmm) {
  const base = makeDateAtTime(baseDate, timeHHmm || "09:00");
  // se base já passou, joga para o próximo ciclo
  const now = Date.now();
  if (base.getTime() <= now) return addDays(base, intervalDays || 1);
  return base;
}

// ✅ Próxima ocorrência por "dias da semana" (0=dom ... 6=sab)
// weekdays: array de números [1,2,3...] (seg=1, ter=2 etc)
function computeNextDueWeekdays(fromDate, weekdays, timeHHmm) {
  const days = Array.isArray(weekdays) ? weekdays.slice() : [];
  if (days.length === 0) return null;

  // tenta de hoje até +21 dias
  for (let i = 0; i <= 21; i++) {
    const candDay = addDays(fromDate, i);
    const day = candDay.getDay();
    if (!days.includes(day)) continue;

    const cand = makeDateAtTime(candDay, timeHHmm || "09:00");
    // se for hoje e já passou, continua procurando
    if (cand.getTime() <= Date.now()) {
      // mas só se estamos testando "a partir de agora"; se fromDate for futuro, ok
      if (toLocalDateKey(fromDate) === toLocalDateKey(new Date()) && i === 0) continue;
      // se fromDate já é no futuro, o Date.now pode ser menor, então aceita
      if (cand.getTime() <= Date.now()) continue;
    }
    return cand;
  }
  return null;
}

// ✅ Próxima ocorrência por "dias do mês" (ex: [1, 10, 15])
function computeNextDueMonthDays(fromDate, monthDays, timeHHmm) {
  const md = Array.isArray(monthDays) ? monthDays.slice() : [];
  if (md.length === 0) return null;

  const start = new Date(fromDate);
  const now = Date.now();

  // procura até 24 meses à frente
  for (let mAdd = 0; mAdd <= 24; mAdd++) {
    const y = start.getFullYear();
    const m = start.getMonth();

    const monthDate = new Date(y, m + mAdd, 1);
    const year2 = monthDate.getFullYear();
    const month2 = monthDate.getMonth();

    for (const dayWanted of md) {
      const dClamped = clampDayToMonth(year2, month2, dayWanted);
      const candDay = new Date(year2, month2, dClamped);
      const cand = makeDateAtTime(candDay, timeHHmm || "09:00");

      // precisa ser >= fromDate (por dia) e no futuro (por hora)
      // e também precisa estar no futuro real
      if (cand.getTime() <= now) continue;

      // se estamos no mesmo mês e a data é antes do "fromDate" (dia), pula
      const fromKey = toLocalDateKey(fromDate);
      const candKey = toLocalDateKey(cand);
      if (candKey < fromKey) continue;

      return cand;
    }
  }
  return null;
}

// ✅ Verifica conflito de "mesmo dia"
function hasDateConflict(list, dateKey, excludeId) {
  const items = Array.isArray(list) ? list : [];
  for (const it of items) {
    if (excludeId && it.id === excludeId) continue;

    // avulso: considera só se ainda não foi concluído
    if (it.tipo === "avulso") {
      if (it.done) continue;
      const dt = parseLocalDateTime(it.quando);
      if (!dt) continue;
      if (toLocalDateKey(dt) === dateKey) return true;
      continue;
    }

    // recorrente: considera só se estiver ativo
    if (it.tipo === "recorrente") {
      if (it.enabled === false) continue;
      const dt = new Date(it.nextDueISO || "");
      if (Number.isNaN(dt.getTime())) continue;
      if (toLocalDateKey(dt) === dateKey) return true;
    }
  }
  return false;
}

// ✅ Calcula próximo vencimento pelo "modo" e, se quiser, evita conflito
function computeNextDueForRecurring(itemLike, fromDate, fullList, excludeId) {
  const mode = itemLike?.scheduleMode || "interval"; // interval | weekdays | monthdays
  const timeHHmm = itemLike?.timeHHmm || "09:00";
  const noSameDay = itemLike?.noSameDay === true; // true = NÃO deixar 2 no mesmo dia

  const tryCompute = (base) => {
    if (mode === "weekdays") {
      return computeNextDueWeekdays(base, itemLike.weekdays || [], timeHHmm);
    }
    if (mode === "monthdays") {
      return computeNextDueMonthDays(base, itemLike.monthDays || [], timeHHmm);
    }
    // interval default
    const intervalDays = unitToDays(itemLike.unit || "dias", itemLike.every || 1);
    return computeNextDueIntervalFromBase(base, intervalDays, timeHHmm);
  };

  let base = new Date(fromDate);
  // garante base como "hoje" se vier inválido
  if (Number.isNaN(base.getTime())) base = new Date();

  // tenta achar uma data válida e, se noSameDay, sem conflito
  for (let guard = 0; guard < 220; guard++) {
    const cand = tryCompute(base);
    if (!cand) return null;

    const key = toLocalDateKey(cand);

    if (!noSameDay) return cand;

    const conflict = hasDateConflict(fullList, key, excludeId);
    if (!conflict) return cand;

    // se conflitou, empurra a base 1 dia para frente e tenta de novo
    const nextBase = new Date(cand);
    nextBase.setHours(0, 0, 0, 0);
    base = addDays(nextBase, 1);
  }

  return null;
}

/* ---------------- UI pieces (Modal / Toast) ---------------- */

function Toast({ text }) {
  if (!text) return null;
  return <div className="toast">{text}</div>;
}

function Modal({ open, title, children, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

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

export default function LembretesPage() {
  const [list, setList] = useState([]);

  // ✅ Form
  const [tipo, setTipo] = useState("avulso"); // avulso | recorrente
  const [titulo, setTitulo] = useState("");
  const [quando, setQuando] = useState("");

  // ✅ Recorrente (NOVO)
  const [scheduleMode, setScheduleMode] = useState("interval"); // interval | weekdays | monthdays

  // interval
  const [every, setEvery] = useState("3");
  const [unit, setUnit] = useState("dias");

  // horário
  const [timeHHmm, setTimeHHmm] = useState("09:00");

  // weekdays (0=dom..6=sab)
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]); // seg-sex padrão

  // monthdays (string input + array)
  const [monthDaysText, setMonthDaysText] = useState("5, 15, 25");

  // ✅ regra: não deixar dois no mesmo dia (se você não quiser)
  const [noSameDay, setNoSameDay] = useState(false);

  // ✅ UI
  const [toastText, setToastText] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("pending"); // pending | done | all

  const [menuModalOpen, setMenuModalOpen] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmCfg, setConfirmCfg] = useState({ title: "", body: "", danger: false, action: null });

  // ✅ Edit
  const [editingId, setEditingId] = useState(null);
  const [editingTipo, setEditingTipo] = useState("avulso");
  const [editingTitulo, setEditingTitulo] = useState("");
  const [editingQuando, setEditingQuando] = useState("");

  // edição recorrente
  const [editingScheduleMode, setEditingScheduleMode] = useState("interval");
  const [editingEvery, setEditingEvery] = useState("3");
  const [editingUnit, setEditingUnit] = useState("dias");
  const [editingTime, setEditingTime] = useState("09:00");
  const [editingWeekdays, setEditingWeekdays] = useState([1, 2, 3, 4, 5]);
  const [editingMonthDaysText, setEditingMonthDaysText] = useState("5, 15, 25");
  const [editingNoSameDay, setEditingNoSameDay] = useState(false);

  // 🎙️ voz
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const recRef = useRef(null);
  const voiceFinalRef = useRef("");

  // ✅ Load
  useEffect(() => {
    const saved = safeJSONParse(localStorage.getItem(LS_KEY) || "[]", []);
    setList(Array.isArray(saved) ? saved : []);
  }, []);

  function save(next) {
    setList(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  }

  function toastMsg(t) {
    setToastText(t);
  }

  useEffect(() => {
    if (!toastText) return;
    const t = setTimeout(() => setToastText(""), 2200);
    return () => clearTimeout(t);
  }, [toastText]);

  // ✅ Voice init
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setVoiceSupported(false);
      return;
    }

    setVoiceSupported(true);

    const rec = new SR();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.continuous = true;

    rec.onstart = () => {
      setVoiceError("");
      setListening(true);
      toastMsg("🎙️ Gravando... fale o título. Depois clique em Parar.");
    };

    rec.onend = () => {
      setListening(false);
    };

    rec.onerror = (e) => {
      setVoiceError(e?.error || "Erro no microfone");
      setListening(false);
    };

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) voiceFinalRef.current += text + " ";
        else interim += text;
      }
      const preview = (voiceFinalRef.current + interim).trim();
      if (preview) setTitulo(preview);
    };

    recRef.current = rec;

    return () => {
      try {
        rec.stop();
      } catch {}
    };
  }, []);

  function toggleVoice() {
    setVoiceError("");
    if (!voiceSupported) return alert("Seu navegador não suporta ditado por voz.");
    const rec = recRef.current;
    if (!rec) return;

    try {
      if (listening) rec.stop();
      else {
        voiceFinalRef.current = titulo ? titulo + " " : "";
        rec.start();
      }
    } catch {
      setVoiceError("Não consegui iniciar o microfone. Tente novamente.");
      setListening(false);
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window)) return alert("Seu navegador não suporta notificações.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") alert("Notificações não permitidas.");
    else toastMsg("Notificações ativadas ✅");
  }

  function scheduleInPageNotification(title, whenDate) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (!whenDate) return;

    const ms = whenDate.getTime() - Date.now();
    if (ms <= 0) return;

    setTimeout(() => {
      try {
        new Notification("⏰ Lembrete", { body: title });
      } catch {}
    }, ms);
  }

  // ✅ checa recorrentes: no horário do dia dispara e move pro próximo
  function checkRecurringTick() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const todayKey = toLocalDateKey(new Date());
    const now = Date.now();
    let changed = false;

    const next = list.map((item) => {
      if (item.tipo !== "recorrente") return item;
      if (!item.enabled) return item;

      const due = new Date(item.nextDueISO || "");
      if (Number.isNaN(due.getTime())) return item;

      if (now < due.getTime()) return item;

      if (item.lastNotifiedDate === todayKey) return item;

      try {
        new Notification("📌 Lembrete do dia", { body: `${item.titulo} hoje` });
      } catch {}

      // ✅ recalcula próximo pelo modo (interval/semana/mês) e com regra de conflito se noSameDay=true
      const nextDue = computeNextDueForRecurring(
        item,
        addDays(new Date(), 1), // base: amanhã (não repete no mesmo instante)
        list,
        item.id
      );

      if (!nextDue) return item;

      changed = true;
      return {
        ...item,
        lastNotifiedDate: todayKey,
        nextDueISO: nextDue.toISOString(),
        updatedAt: nowISO(),
      };
    });

    if (changed) save(next);
  }

  useEffect(() => {
    (list || []).forEach((i) => {
      if (i.tipo === "avulso" && i.quando) {
        const dt = parseLocalDateTime(i.quando);
        if (dt) scheduleInPageNotification(i.titulo, dt);
      }
      if (i.tipo === "recorrente" && i.nextDueISO && i.enabled) {
        const dt = new Date(i.nextDueISO);
        if (!Number.isNaN(dt.getTime())) scheduleInPageNotification(`${i.titulo} hoje`, dt);
      }
    });

    checkRecurringTick();
    const id = setInterval(checkRecurringTick, 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  // ✅ adicionar
  function add() {
    const t = titulo.trim();
    if (!t) return toastMsg("Preencha o título.");

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

      const next = [item, ...list].sort((a, b) => String(a.quando || "").localeCompare(String(b.quando || "")));
      save(next);

      const dt = parseLocalDateTime(item.quando);
      scheduleInPageNotification(item.titulo, dt);

      setTitulo("");
      setQuando("");
      voiceFinalRef.current = "";
      toastMsg("Lembrete salvo.");
      return;
    }

    // ✅ recorrente
    const monthDaysArr = parseMonthDaysList(monthDaysText);

    // validação por modo
    if (scheduleMode === "weekdays" && (!Array.isArray(weekdays) || weekdays.length === 0)) {
      return toastMsg("Marque pelo menos 1 dia da semana.");
    }
    if (scheduleMode === "monthdays" && monthDaysArr.length === 0) {
      return toastMsg("Digite pelo menos 1 dia do mês (ex: 5, 10, 15).");
    }

    // monta “itemLike” para calcular a próxima data
    const itemLike = {
      tipo: "recorrente",
      scheduleMode,
      every: String(Math.max(1, Number(every || 1))),
      unit,
      timeHHmm,
      weekdays: weekdays || [],
      monthDays: monthDaysArr,
      noSameDay: noSameDay === true,
    };

    // base = agora (para achar próxima no futuro)
    const nextDue = computeNextDueForRecurring(itemLike, new Date(), list, null);
    if (!nextDue) return toastMsg("Não consegui calcular a próxima data. Verifique as opções.");

    const item = {
      id: uuid(),
      tipo: "recorrente",
      titulo: t,

      // ✅ modo e config
      scheduleMode,
      every: itemLike.every,
      unit: itemLike.unit,
      timeHHmm: itemLike.timeHHmm,
      weekdays: itemLike.weekdays,
      monthDays: itemLike.monthDays,
      noSameDay: itemLike.noSameDay,

      enabled: true,
      nextDueISO: nextDue.toISOString(),
      lastNotifiedDate: null,
      paidAt: null,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    const next = [item, ...list].sort((a, b) => String(a.nextDueISO || "").localeCompare(String(b.nextDueISO || "")));
    save(next);

    scheduleInPageNotification(`${item.titulo} hoje`, new Date(item.nextDueISO));

    setTitulo("");
    setScheduleMode("interval");
    setEvery("3");
    setUnit("dias");
    setTimeHHmm("09:00");
    setWeekdays([1, 2, 3, 4, 5]);
    setMonthDaysText("5, 15, 25");
    setNoSameDay(false);
    voiceFinalRef.current = "";
    toastMsg("Recorrente salvo.");
  }

  function toggleDoneAvulso(id) {
    const next = list.map((i) => {
      if (i.id !== id) return i;
      if (i.tipo !== "avulso") return i;
      const done = !i.done;
      return { ...i, done, doneAt: done ? nowISO() : null, updatedAt: nowISO() };
    });
    save(next);
  }

  // ✅ pagar/feito recorrente -> recalcula próxima ocorrência pelo modo
  function payRecurring(id) {
    const todayKey = toLocalDateKey(new Date());

    const next = list.map((i) => {
      if (i.id !== id) return i;
      if (i.tipo !== "recorrente") return i;

      const base = new Date(); // ao pagar, considera "a partir de agora"
      const nextDue = computeNextDueForRecurring(i, base, list, i.id);
      if (!nextDue) return i;

      return {
        ...i,
        paidAt: nowISO(),
        lastNotifiedDate: todayKey,
        nextDueISO: nextDue.toISOString(),
        updatedAt: nowISO(),
      };
    });

    save(next);
    toastMsg("Pago/Feito ✅ Próximo agendado.");
  }

  function payAllRecurring() {
    const todayKey = toLocalDateKey(new Date());
    let count = 0;

    const next = list.map((i) => {
      if (i.tipo !== "recorrente") return i;
      if (!i.enabled) return i;

      const base = new Date();
      const nextDue = computeNextDueForRecurring(i, base, list, i.id);
      if (!nextDue) return i;

      count += 1;
      return {
        ...i,
        paidAt: nowISO(),
        lastNotifiedDate: todayKey,
        nextDueISO: nextDue.toISOString(),
        updatedAt: nowISO(),
      };
    });

    if (count === 0) return toastMsg("Nenhum recorrente para pagar.");
    save(next);
    toastMsg(`Pago/Feito ✅ (${count}) recorrente(s)`);
  }

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

  function startEdit(item, e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    setEditingId(item.id);
    setEditingTipo(item.tipo || "avulso");
    setEditingTitulo(item.titulo || "");

    if (item.tipo === "avulso") {
      setEditingQuando(item.quando || "");

      // reset recorrente
      setEditingScheduleMode("interval");
      setEditingEvery("3");
      setEditingUnit("dias");
      setEditingTime("09:00");
      setEditingWeekdays([1, 2, 3, 4, 5]);
      setEditingMonthDaysText("5, 15, 25");
      setEditingNoSameDay(false);
    } else {
      setEditingQuando("");

      setEditingScheduleMode(item.scheduleMode || "interval");
      setEditingEvery(String(item.every || "3"));
      setEditingUnit(item.unit || "dias");
      setEditingTime(item.timeHHmm || "09:00");
      setEditingWeekdays(Array.isArray(item.weekdays) ? item.weekdays : [1, 2, 3, 4, 5]);
      setEditingMonthDaysText(
        Array.isArray(item.monthDays) && item.monthDays.length
          ? item.monthDays.join(", ")
          : "5, 15, 25"
      );
      setEditingNoSameDay(item.noSameDay === true);
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingTipo("avulso");
    setEditingTitulo("");
    setEditingQuando("");

    setEditingScheduleMode("interval");
    setEditingEvery("3");
    setEditingUnit("dias");
    setEditingTime("09:00");
    setEditingWeekdays([1, 2, 3, 4, 5]);
    setEditingMonthDaysText("5, 15, 25");
    setEditingNoSameDay(false);
  }

  function commitEdit(id) {
    const t = editingTitulo.trim();
    if (!t) return toastMsg("Preencha o título.");

    const next = list.map((i) => {
      if (i.id !== id) return i;

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

      // ✅ recorrente: aplica novas configs e recalcula nextDueISO
      const mdArr = parseMonthDaysList(editingMonthDaysText);

      if (editingScheduleMode === "weekdays" && (!editingWeekdays || editingWeekdays.length === 0)) {
        toastMsg("Marque pelo menos 1 dia da semana.");
        return i;
      }
      if (editingScheduleMode === "monthdays" && mdArr.length === 0) {
        toastMsg("Digite pelo menos 1 dia do mês.");
        return i;
      }

      const itemLike = {
        ...i,
        titulo: t,
        scheduleMode: editingScheduleMode,
        every: String(Math.max(1, Number(editingEvery || 1))),
        unit: editingUnit,
        timeHHmm: editingTime,
        weekdays: editingWeekdays || [],
        monthDays: mdArr,
        noSameDay: editingNoSameDay === true,
      };

      const nextDue = computeNextDueForRecurring(itemLike, new Date(), list, i.id);
      if (!nextDue) {
        toastMsg("Não consegui calcular a próxima data. Verifique as opções.");
        return i;
      }

      return {
        ...i,
        titulo: t,
        scheduleMode: itemLike.scheduleMode,
        every: itemLike.every,
        unit: itemLike.unit,
        timeHHmm: itemLike.timeHHmm,
        weekdays: itemLike.weekdays,
        monthDays: itemLike.monthDays,
        noSameDay: itemLike.noSameDay,
        nextDueISO: nextDue.toISOString(),
        updatedAt: nowISO(),
      };
    });

    save(next);
    cancelEdit();
    toastMsg("Atualizado.");
  }

  function toggleRecurringEnabled(id) {
    const next = list.map((i) => {
      if (i.id !== id) return i;
      if (i.tipo !== "recorrente") return i;
      return { ...i, enabled: !i.enabled, updatedAt: nowISO() };
    });
    save(next);
  }

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

  const menuItems = [
    { label: "Ativar notificações", danger: false, onClick: enableNotifications },
    { label: "Pagar tudo (recorrentes)", danger: false, onClick: payAllRecurring },
    { label: "Limpar concluídos (avulsos)", danger: true, onClick: askClearDone },
    { label: "Apagar tudo", danger: true, onClick: askClearAll },
  ];

  const visible = useMemo(() => {
    const q = normalizeText(search);
    let base = list;

    if (tab !== "all") {
      base = base.filter((i) => {
        if (i.tipo === "avulso") return tab === "done" ? i.done : !i.done;
        return tab !== "done";
      });
    }

    if (q) base = base.filter((i) => normalizeText(i.titulo).includes(q));

    return base.slice().sort((a, b) => {
      const ax = a.tipo === "recorrente" ? (a.nextDueISO || "") : (a.quando || "");
      const bx = b.tipo === "recorrente" ? (b.nextDueISO || "") : (b.quando || "");
      return String(ax).localeCompare(String(bx));
    });
  }, [list, tab, search]);

  // helpers UI: toggle weekday
  function toggleWeekday(arr, d) {
    const set = new Set(Array.isArray(arr) ? arr : []);
    if (set.has(d)) set.delete(d);
    else set.add(d);
    return Array.from(set).sort((a, b) => a - b);
  }

  const weekdayLabels = [
    { d: 1, label: "Seg" },
    { d: 2, label: "Ter" },
    { d: 3, label: "Qua" },
    { d: 4, label: "Qui" },
    { d: 5, label: "Sex" },
    { d: 6, label: "Sáb" },
    { d: 0, label: "Dom" },
  ];

  return (
    <div className="page">
      <Toast text={toastText} />

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-end" }}>
        <div>
          <h2 className="page-title">⏰ Lembretes</h2>
          <p className="muted small" style={{ marginTop: 6 }}>
            Avulsos e recorrentes (dias exatos + evitar conflitos)
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="icon-btn"
            onClick={(e) => {
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

      <Modal open={menuModalOpen} title="Opções" onClose={() => setMenuModalOpen(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
                setMenuModalOpen(false);
                it.onClick?.();
              }}
            >
              {it.label}
            </button>
          ))}

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

      {/* Card: adicionar */}
      <div className="card mt">
        <div className="filters-grid">
          <div className="field">
            <label>Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="avulso">Avulso (uma vez)</option>
              <option value="recorrente">Recorrente</option>
            </select>
          </div>

          <div className="field">
            <label>Notificações</label>
            <button type="button" className="chip" onClick={enableNotifications}>
              🔔 Ativar
            </button>
          </div>
        </div>

        <div className="field mt">
          <label>Título</label>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder='Ex: "Pagar internet"' />
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

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="primary-btn"
            style={{
              width: "auto",
              padding: "10px 14px",
              background: listening ? "rgba(248,113,113,.25)" : undefined,
            }}
            onClick={(e) => {
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
              e.stopPropagation();
              setTitulo("");
              voiceFinalRef.current = "";
              toastMsg("Título limpo.");
            }}
          >
            Limpar título
          </button>
        </div>

        {tipo === "avulso" ? (
          <div className="field" style={{ marginTop: 12 }}>
            <label>Quando</label>
            <input value={quando} onChange={(e) => setQuando(e.target.value)} type="datetime-local" />
          </div>
        ) : (
          <>
            {/* ✅ NOVO: modo do recorrente */}
            <div className="filters-grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Modo do recorrente</label>
                <select value={scheduleMode} onChange={(e) => setScheduleMode(e.target.value)}>
                  <option value="interval">De quanto em quanto (intervalo)</option>
                  <option value="weekdays">Dias exatos da semana</option>
                  <option value="monthdays">Dias exatos do mês</option>
                </select>
              </div>

              <div className="field">
                <label>Horário</label>
                <input type="time" value={timeHHmm} onChange={(e) => setTimeHHmm(e.target.value)} />
              </div>
            </div>

            {/* ✅ conflito */}
            <div className="field" style={{ marginTop: 10 }}>
              <label>Permitir 2 lembretes no mesmo dia?</label>
              <select value={noSameDay ? "nao" : "sim"} onChange={(e) => setNoSameDay(e.target.value === "nao")}>
                <option value="sim">Sim (pode ter 2 no mesmo dia)</option>
                <option value="nao">Não (evitar ficar no mesmo dia)</option>
              </select>
              <div className="muted small" style={{ marginTop: 6 }}>
                Se “Não”, o app empurra o próximo vencimento para o próximo dia válido sem conflito.
              </div>
            </div>

            {/* interval */}
            {scheduleMode === "interval" ? (
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
              </div>
            ) : null}

            {/* weekdays */}
            {scheduleMode === "weekdays" ? (
              <div className="field" style={{ marginTop: 12 }}>
                <label>Dias da semana</label>
                <div className="chips-row" style={{ flexWrap: "wrap" }}>
                  {weekdayLabels.map((w) => (
                    <button
                      key={w.d}
                      type="button"
                      className={"chip " + (weekdays.includes(w.d) ? "chip-active" : "")}
                      onClick={() => setWeekdays((prev) => toggleWeekday(prev, w.d))}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* monthdays */}
            {scheduleMode === "monthdays" ? (
              <div className="field" style={{ marginTop: 12 }}>
                <label>Dias do mês</label>
                <input
                  value={monthDaysText}
                  onChange={(e) => setMonthDaysText(e.target.value)}
                  placeholder="Ex: 1, 5, 10, 15"
                />
                <div className="muted small" style={{ marginTop: 6 }}>
                  Dica: use vírgula. Ex.: <b>5, 15, 25</b>
                </div>
              </div>
            ) : null}
          </>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            className="primary-btn"
            style={{ width: "auto", padding: "10px 14px" }}
            onClick={(e) => {
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
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ex.: internet, banheiro..." />
        </div>

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
        {visible.length === 0 ? (
          <p className="muted">{list.length === 0 ? "Nenhum lembrete ainda." : "Nada nesse filtro/busca."}</p>
        ) : (
          <ul className="list">
            {visible.map((i) => {
              const isEditing = editingId === i.id;

              return (
                <li key={i.id} className="list-item" style={{ alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {!isEditing ? (
                      <>
                        <div
                          style={{
                            fontWeight: 800,
                            opacity: i.tipo === "avulso" && i.done ? 0.65 : i.tipo === "recorrente" && i.enabled === false ? 0.6 : 1,
                            textDecoration: i.tipo === "avulso" && i.done ? "line-through" : "none",
                          }}
                        >
                          {i.titulo}{" "}
                          <span className="muted small" style={{ fontWeight: 600 }}>
                            {i.tipo === "recorrente" ? "• recorrente" : "• avulso"}
                          </span>
                        </div>

                        <div className="muted small" style={{ marginTop: 4 }}>
                          {i.tipo === "avulso" ? (
                            <>📅 {fmtBRDateTimeLocal(i.quando)}</>
                          ) : (
                            <>
                              ⏱ Próximo: <b>{fmtBRDateTimeISO(i.nextDueISO)}</b> • {i.timeHHmm}{" "}
                              {i.enabled === false ? "• (pausado)" : ""}{" "}
                              {i.noSameDay ? "• (sem conflito)" : ""}
                              <div className="muted small" style={{ marginTop: 6 }}>
                                {i.scheduleMode === "weekdays" ? (
                                  <>📌 Dias da semana: {(i.weekdays || []).join(", ") || "-"}</>
                                ) : i.scheduleMode === "monthdays" ? (
                                  <>📌 Dias do mês: {(i.monthDays || []).join(", ") || "-"}</>
                                ) : (
                                  <>
                                    🔁 Intervalo: a cada <b>{i.every}</b> {i.unit}
                                  </>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </>
                    ) : (
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
                          <>
                            <div className="filters-grid">
                              <div className="field">
                                <label>Modo</label>
                                <select value={editingScheduleMode} onChange={(e) => setEditingScheduleMode(e.target.value)}>
                                  <option value="interval">Intervalo</option>
                                  <option value="weekdays">Dias da semana</option>
                                  <option value="monthdays">Dias do mês</option>
                                </select>
                              </div>

                              <div className="field">
                                <label>Horário</label>
                                <input type="time" value={editingTime} onChange={(e) => setEditingTime(e.target.value)} />
                              </div>
                            </div>

                            <div className="field" style={{ marginTop: 10 }}>
                              <label>Permitir 2 no mesmo dia?</label>
                              <select
                                value={editingNoSameDay ? "nao" : "sim"}
                                onChange={(e) => setEditingNoSameDay(e.target.value === "nao")}
                              >
                                <option value="sim">Sim</option>
                                <option value="nao">Não</option>
                              </select>
                            </div>

                            {editingScheduleMode === "interval" ? (
                              <div className="filters-grid" style={{ marginTop: 10 }}>
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
                              </div>
                            ) : null}

                            {editingScheduleMode === "weekdays" ? (
                              <div className="field" style={{ marginTop: 10 }}>
                                <label>Dias da semana</label>
                                <div className="chips-row" style={{ flexWrap: "wrap" }}>
                                  {weekdayLabels.map((w) => (
                                    <button
                                      key={w.d}
                                      type="button"
                                      className={"chip " + (editingWeekdays.includes(w.d) ? "chip-active" : "")}
                                      onClick={() => setEditingWeekdays((prev) => toggleWeekday(prev, w.d))}
                                    >
                                      {w.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            {editingScheduleMode === "monthdays" ? (
                              <div className="field" style={{ marginTop: 10 }}>
                                <label>Dias do mês</label>
                                <input
                                  value={editingMonthDaysText}
                                  onChange={(e) => setEditingMonthDaysText(e.target.value)}
                                  placeholder="Ex: 1, 5, 10"
                                />
                              </div>
                            ) : null}
                          </>
                        )}

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

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {!isEditing ? (
                      <>
                        {i.tipo === "avulso" ? (
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

                            <button
                              type="button"
                              className={"chip " + (i.enabled ? "chip-active" : "")}
                              style={{ width: "auto" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRecurringEnabled(i.id);
                              }}
                            >
                              {i.enabled ? "Ativo" : "Pausado"}
                            </button>
                          </>
                        )}

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
            className="primary-btn"
            style={{
              width: "auto",
              padding: "10px 14px",
              background: confirmCfg.danger ? "#f97373" : undefined,
              color: confirmCfg.danger ? "#111827" : undefined,
            }}
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
