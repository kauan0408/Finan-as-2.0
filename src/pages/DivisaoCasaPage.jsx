// ✅ Arquivo: src/pages/LembretesPage.jsx
// ✅ ALTERAÇÃO PEDIDA:
// - Adicionei um modal BONITO perguntando se tem certeza antes de executar "Pago/Feito" nos recorrentes.
// - NÃO mexi na lógica do payRecurring: só encapsulei a chamada com um confirm modal.
// - Reaproveitei o seu Modal existente (confirmOpen/confirmCfg) para não poluir mais código.
// - Agora o botão "Pago/Feito" chama askPayRecurring(i) em vez de payRecurring(i.id).

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFinance } from "../App.jsx"; // ✅ usa o contexto do App (online)

const LS_KEY_FALLBACK = "pwa_lembretes_v1"; // ✅ fallback antigo (só pra tentar migrar)

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

function toYMD(dateObj) {
  const d = new Date(dateObj);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseYMD(ymd) {
  try {
    const [y, m, d] = String(ymd || "").split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  } catch {
    return null;
  }
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

function startOfDay(dateObj) {
  const d = new Date(dateObj);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(dateObj) {
  const d = new Date(dateObj);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * ✅ CORRIGIDO: normaliza unidade (trim/lower) e aceita variações
 */
function unitToDays(unit, every) {
  const n = Math.max(1, Number(every || 1));
  const u = String(unit || "dias").trim().toLowerCase();
  if (u === "semanas" || u === "semana" || u.startsWith("sem")) return n * 7;
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

  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

// Ajusta "dia do mês" para último dia do mês
function clampDayToMonth(year, monthIndex, day) {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(Math.max(1, day), last);
}

/**
 * ✅ Intervalo (a cada X dias/semanas)
 */
function computeNextDueIntervalFromBase(baseDate, intervalDays, timeHHmm) {
  const interval = Math.max(1, Number(intervalDays || 1));
  const now = Date.now();
  const minFuture = now + 60 * 1000;

  let cand = makeDateAtTime(baseDate, timeHHmm || "09:00");
  while (cand.getTime() < minFuture) {
    cand = addDays(cand, interval);
  }
  return cand;
}

/**
 * ✅ Semanal (dias da semana)
 */
function computeNextDueWeekdays(fromDate, weekdays, timeHHmm) {
  const days = Array.isArray(weekdays) ? Array.from(new Set(weekdays)) : [];
  if (!days.length) return null;

  const now = Date.now();
  const minFuture = now + 60 * 1000;

  const start = new Date(fromDate);
  for (let i = 0; i <= 366; i++) {
    const dayBase = addDays(start, i);
    const dow = dayBase.getDay();
    if (!days.includes(dow)) continue;

    const cand = makeDateAtTime(dayBase, timeHHmm || "09:00");
    if (cand.getTime() >= minFuture) return cand;
  }
  return null;
}

/**
 * ✅ Mensal (lista de dias)
 */
function computeNextDueMonthDays(fromDate, monthDays, timeHHmm) {
  const md = Array.isArray(monthDays) ? monthDays.slice().sort((a, b) => a - b) : [];
  if (!md.length) return null;

  const now = Date.now();
  const minFuture = now + 60 * 1000;

  const start = new Date(fromDate);

  for (let mAdd = 0; mAdd <= 36; mAdd++) {
    const monthDate = new Date(start.getFullYear(), start.getMonth() + mAdd, 1);
    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();

    for (const dayWanted of md) {
      const dClamped = clampDayToMonth(y, m, dayWanted);
      const candDay = new Date(y, m, dClamped);
      const cand = makeDateAtTime(candDay, timeHHmm || "09:00");
      if (cand.getTime() < minFuture) continue;

      const fromKey = toLocalDateKey(fromDate);
      const candKey = toLocalDateKey(cand);
      if (candKey < fromKey) continue;

      return cand;
    }
  }
  return null;
}

/* -------------------- conflito de dia -------------------- */

function hasDateConflict(list, dateKey, excludeId) {
  const items = Array.isArray(list) ? list : [];
  for (const it of items) {
    if (excludeId && it.id === excludeId) continue;

    if (it.tipo === "avulso") {
      if (it.done) continue;
      const dt = parseLocalDateTime(it.quando);
      if (!dt) continue;
      if (toLocalDateKey(dt) === dateKey) return true;
      continue;
    }

    if (it.tipo === "recorrente") {
      if (it.enabled === false) continue;
      const dt = new Date(it.nextDueISO || "");
      if (Number.isNaN(dt.getTime())) continue;
      if (toLocalDateKey(dt) === dateKey) return true;
    }
  }
  return false;
}

/* -------------------- motor de recorrência -------------------- */

function parseFixedDatesList(text) {
  const parts = String(text || "")
    .split(/[,;\n]/g)
    .map((x) => x.trim())
    .filter(Boolean);

  const ok = parts
    .map((s) => (/\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ""))
    .filter(Boolean);

  return Array.from(new Set(ok)).sort();
}

/**
 * ✅ Avança a partir do "fromDate" (usado para criar/editar e em conflitos)
 */
function computeNextDueAdvanced(itemLike, fromDate) {
  const scheduleType = itemLike?.scheduleType || "intervalo";
  const timeHHmm = itemLike?.timeHHmm || "09:00";

  if (scheduleType === "diario") {
    const baseDay = startOfDay(fromDate);
    const cand = makeDateAtTime(baseDay, timeHHmm);
    if (cand.getTime() >= Date.now() + 60 * 1000) return cand;
    return makeDateAtTime(addDays(baseDay, 1), timeHHmm);
  }

  if (scheduleType === "semanal") {
    return computeNextDueWeekdays(fromDate, itemLike.weekdays || [], timeHHmm);
  }

  if (scheduleType === "mensal") {
    const day = Number(itemLike.diaMes || 1);
    return computeNextDueMonthDays(fromDate, [day], timeHHmm);
  }

  if (scheduleType === "aniversario") {
    const base = parseYMD(itemLike.dataBaseYMD || "");
    if (!base) return null;

    const now = Date.now();
    const minFuture = now + 60 * 1000;

    const from = new Date(fromDate);
    const m = base.getMonth();
    const d = base.getDate();

    for (let add = 0; add <= 10; add++) {
      const year = from.getFullYear() + add;
      const dayClamped = clampDayToMonth(year, m, d);
      const candDay = new Date(year, m, dayClamped);
      const cand = makeDateAtTime(candDay, timeHHmm);
      if (cand.getTime() < minFuture) continue;
      return cand;
    }
    return null;
  }

  if (scheduleType === "personalizado") {
    const datesYMD = Array.isArray(itemLike.datasFixas) ? itemLike.datasFixas.slice().sort() : [];
    if (!datesYMD.length) return null;

    const baseKey = toYMD(fromDate);
    const now = Date.now();
    const minFuture = now + 60 * 1000;

    for (const ymd of datesYMD) {
      if (ymd < baseKey) continue;
      const d0 = parseYMD(ymd);
      if (!d0) continue;
      const cand = makeDateAtTime(d0, timeHHmm);
      if (cand.getTime() < minFuture) continue;
      return cand;
    }
    return null;
  }

  const intervalDays = unitToDays(itemLike.unit || "dias", itemLike.every || 1);
  return computeNextDueIntervalFromBase(fromDate, intervalDays, timeHHmm);
}

function computeNextDueWithConflict(itemLike, fromDate, fullList, excludeId) {
  const conflictMode = itemLike?.conflictMode || (itemLike?.noSameDay ? "shift" : "allow");

  const noSameDayShift = conflictMode === "shift";
  const block = conflictMode === "block";

  let base = new Date(fromDate);
  if (Number.isNaN(base.getTime())) base = new Date();

  for (let guard = 0; guard < 520; guard++) {
    const cand = computeNextDueAdvanced(itemLike, base);
    if (!cand) return null;

    const key = toLocalDateKey(cand);
    const conflict = hasDateConflict(fullList, key, excludeId);

    if (!conflict) return cand;

    if (block) return { __conflict: true, dateKey: key, cand };
    if (!noSameDayShift) return cand;

    base = addDays(startOfDay(cand), 1);
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
  const { user, lembretes, setLembretes } = useFinance();

  const list = Array.isArray(lembretes) ? lembretes : [];

  function save(next) {
    setLembretes(Array.isArray(next) ? next : []);
  }

  // ✅ MIGRAÇÃO (uma vez)
  useEffect(() => {
    if (list.length > 0) return;
    try {
      const saved = safeJSONParse(localStorage.getItem(LS_KEY_FALLBACK) || "[]", []);
      if (Array.isArray(saved) && saved.length > 0) {
        setLembretes(saved);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ UI/Form
  const [tipo, setTipo] = useState("avulso");
  const [titulo, setTitulo] = useState("");
  const [quando, setQuando] = useState("");

  const [scheduleType, setScheduleType] = useState("intervalo");
  const [every, setEvery] = useState("3");
  const [unit, setUnit] = useState("dias");

  const [timeHHmm, setTimeHHmm] = useState("09:00");
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]);
  const [diaMes, setDiaMes] = useState("5");
  const [dataBaseYMD, setDataBaseYMD] = useState("");
  const [datasFixasText, setDatasFixasText] = useState("2026-02-05, 2026-03-10");

  const [nivel, setNivel] = useState("rapido");
  const [conflictMode, setConflictMode] = useState("allow");

  const [toastText, setToastText] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("pending");
  const [range, setRange] = useState("all");

  const [menuModalOpen, setMenuModalOpen] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmCfg, setConfirmCfg] = useState({
    title: "",
    body: "",
    danger: false,
    action: null,
    confirmText: "Confirmar",
    cancelText: "Cancelar",
    extra: null,
  });

  // ✅ novo modal: criar lembrete
  const [addModalOpen, setAddModalOpen] = useState(false);

  // ✅ novo modal: ajuda/info
  const [infoModalOpen, setInfoModalOpen] = useState(false);

  // ✅ Edit (COMPLETO)
  const [editingId, setEditingId] = useState(null);
  const [editingTipo, setEditingTipo] = useState("avulso");
  const [editingTitulo, setEditingTitulo] = useState("");
  const [editingQuando, setEditingQuando] = useState("");

  const [editingScheduleType, setEditingScheduleType] = useState("intervalo");
  const [editingEvery, setEditingEvery] = useState("3");
  const [editingUnit, setEditingUnit] = useState("dias");
  const [editingTime, setEditingTime] = useState("09:00");
  const [editingWeekdays, setEditingWeekdays] = useState([1, 2, 3, 4, 5]);
  const [editingDiaMes, setEditingDiaMes] = useState("5");
  const [editingDataBaseYMD, setEditingDataBaseYMD] = useState("");
  const [editingDatasFixasText, setEditingDatasFixasText] = useState("2026-02-05, 2026-03-10");
  const [editingNivel, setEditingNivel] = useState("rapido");
  const [editingConflictMode, setEditingConflictMode] = useState("allow");

  // 🎙️ voz
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const recRef = useRef(null);
  const voiceFinalRef = useRef("");

  // ✅ timers de notificação (pra não duplicar)
  const notifTimersRef = useRef([]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ✅ Notificações: pede permissão
  async function enableNotifications() {
    if (!("Notification" in window)) return alert("Seu navegador não suporta notificações.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") alert("Notificações não permitidas.");
    else toastMsg("Notificações ativadas ✅");
  }

  async function showTopBarNotification(title, body) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.showNotification) {
          await reg.showNotification(title, {
            body,
            tag: "lembretes",
            renotify: true,
          });
          return;
        }
      }
    } catch {}

    try {
      new Notification(title, { body });
    } catch {}
  }

  function clearAllNotificationTimers() {
    const arr = notifTimersRef.current || [];
    arr.forEach((id) => {
      try {
        clearTimeout(id);
      } catch {}
    });
    notifTimersRef.current = [];
  }

  function scheduleNotificationAt(title, whenDate, body) {
    if (!whenDate) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const ms = whenDate.getTime() - Date.now();
    if (ms <= 0) return;

    const MAX_MS = 7 * 24 * 60 * 60 * 1000;
    if (ms > MAX_MS) return;

    const id = setTimeout(() => {
      showTopBarNotification("⏰ Lembrete", body || title);
    }, ms);

    notifTimersRef.current.push(id);
  }

  // ✅ Notificação "tarefas de hoje" (1x por dia, quando o app abrir)
  function notifyTodayTasksOncePerDay() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const todayKey = toLocalDateKey(new Date());
    const keyLS = user?.uid ? `pwa_today_notif_${user.uid}` : "pwa_today_notif_local";
    const last = localStorage.getItem(keyLS) || "";
    if (last === todayKey) return;

    const from = startOfDay(new Date());
    const to = endOfDay(new Date());

    const todays = list
      .filter((i) => {
        if (i.tipo === "avulso") {
          if (i.done) return false;
          const dt = parseLocalDateTime(i.quando);
          if (!dt) return false;
          return dt.getTime() >= from.getTime() && dt.getTime() <= to.getTime();
        }
        if (i.tipo === "recorrente") {
          if (i.enabled === false) return false;
          const dt = new Date(i.nextDueISO || "");
          if (Number.isNaN(dt.getTime())) return false;
          return dt.getTime() >= from.getTime() && dt.getTime() <= to.getTime();
        }
        return false;
      })
      .slice(0, 8);

    if (todays.length === 0) return;

    const body = todays.map((t) => `• ${t.titulo}`).join("\n");
    showTopBarNotification("📌 Tarefas de hoje", body);

    try {
      localStorage.setItem(keyLS, todayKey);
    } catch {}
  }

  /**
   * ✅ PAGO/FEITO: calcula o próximo a partir do nextDueISO (vencimento atual)
   * ✅ respeita todos os tipos (intervalo, diario, semanal, mensal, aniversario, personalizado)
   */
  function computeNextFromCurrentDue(item, fullList) {
    const due = new Date(item?.nextDueISO || "");
    const baseDue = Number.isNaN(due.getTime()) ? new Date() : due;

    const conflictMode = item?.conflictMode || (item?.noSameDay ? "shift" : "allow");
    const noSameDayShift = conflictMode === "shift";
    const block = conflictMode === "block";

    const st = String(item?.scheduleType || "intervalo").trim().toLowerCase();
    const time = item?.timeHHmm || "09:00";

    function nextStrict(base) {
      const from = addDays(startOfDay(base), 1);

      if (st === "intervalo") {
        const intervalDays = unitToDays(item?.unit, item?.every || 1);
        const nextBase = addDays(startOfDay(base), intervalDays);
        return makeDateAtTime(nextBase, time);
      }

      if (st === "diario") {
        return makeDateAtTime(from, time);
      }

      if (st === "semanal") {
        const days = Array.isArray(item?.weekdays) ? Array.from(new Set(item.weekdays)) : [];
        if (!days.length) return null;

        for (let i = 0; i <= 366; i++) {
          const dayBase = addDays(from, i);
          const dow = dayBase.getDay();
          if (!days.includes(dow)) continue;
          return makeDateAtTime(dayBase, time);
        }
        return null;
      }

      if (st === "mensal") {
        const dayWanted = Number(item?.diaMes || 1);
        if (!dayWanted || dayWanted < 1 || dayWanted > 31) return null;

        for (let mAdd = 0; mAdd <= 36; mAdd++) {
          const monthDate = new Date(from.getFullYear(), from.getMonth() + mAdd, 1);
          const y = monthDate.getFullYear();
          const m = monthDate.getMonth();

          const dClamped = clampDayToMonth(y, m, dayWanted);
          const candDay = new Date(y, m, dClamped);
          const cand = makeDateAtTime(candDay, time);

          if (cand.getTime() < from.getTime()) continue;
          return cand;
        }
        return null;
      }

      if (st === "aniversario") {
        const baseA = parseYMD(item?.dataBaseYMD || "");
        if (!baseA) return null;

        const month = baseA.getMonth();
        const day = baseA.getDate();

        for (let add = 0; add <= 10; add++) {
          const year = from.getFullYear() + add;
          const dayClamped = clampDayToMonth(year, month, day);
          const candDay = new Date(year, month, dayClamped);
          const cand = makeDateAtTime(candDay, time);

          if (cand.getTime() < from.getTime()) continue;
          return cand;
        }
        return null;
      }

      if (st === "personalizado") {
        const listDates = Array.isArray(item?.datasFixas) ? item.datasFixas.slice().sort() : [];
        if (!listDates.length) return null;

        const fromKey = toYMD(from);
        for (const ymd of listDates) {
          if (ymd < fromKey) continue;
          const d0 = parseYMD(ymd);
          if (!d0) continue;
          const cand = makeDateAtTime(d0, time);
          if (cand.getTime() < from.getTime()) continue;
          return cand;
        }
        return null;
      }

      const intervalDays = unitToDays(item?.unit, item?.every || 1);
      const nextBase = addDays(startOfDay(base), intervalDays);
      return makeDateAtTime(nextBase, time);
    }

    let base = new Date(baseDue);
    if (Number.isNaN(base.getTime())) base = new Date();

    for (let guard = 0; guard < 520; guard++) {
      const cand = nextStrict(base);
      if (!cand) return null;

      const key = toLocalDateKey(cand);
      const conflict = hasDateConflict(fullList, key, item.id);

      if (!conflict) return cand;

      if (block) return { __conflict: true, dateKey: key, cand };
      if (!noSameDayShift) return cand;

      base = addDays(startOfDay(cand), 1);
    }

    return null;
  }

  /**
   * ✅ CORRIGIDO DO JEITO QUE VOCÊ QUER:
   * - Notifica quando chega a hora/dia
   * - NÃO gira o nextDueISO sozinho
   * - Só gira quando você clicar Pago/Feito
   */
  function checkRecurringTick() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const now = Date.now();
    const todayKey = toLocalDateKey(new Date());
    let changed = false;

    const next = list.map((item) => {
      if (item.tipo !== "recorrente") return item;
      if (item.enabled === false) return item;

      const due = new Date(item.nextDueISO || "");
      if (Number.isNaN(due.getTime())) return item;

      // ainda não chegou
      if (now + 30 * 1000 < due.getTime()) return item;

      // já notifiquei hoje
      if (item.lastNotifiedDate === todayKey) return item;

      // ✅ notifica, mas NÃO muda a data aqui
      showTopBarNotification("📌 Lembrete do dia", `${item.titulo} hoje`);

      changed = true;
      return {
        ...item,
        lastNotifiedDate: todayKey,
        updatedAt: nowISO(),
      };
    });

    if (changed) save(next);
  }

  // ✅ Re-agenda timers sempre que a lista muda
  useEffect(() => {
    clearAllNotificationTimers();

    notifyTodayTasksOncePerDay();

    (list || []).forEach((i) => {
      if (i.tipo === "avulso" && i.quando && !i.done) {
        const dt = parseLocalDateTime(i.quando);
        if (dt) scheduleNotificationAt(i.titulo, dt, i.titulo);
      }
      if (i.tipo === "recorrente" && i.nextDueISO && i.enabled !== false) {
        const dt = new Date(i.nextDueISO);
        if (!Number.isNaN(dt.getTime())) {
          scheduleNotificationAt(`${i.titulo} hoje`, dt, `${i.titulo} hoje`);
        }
      }
    });

    checkRecurringTick();
    const id = setInterval(checkRecurringTick, 60 * 1000);

    return () => {
      clearInterval(id);
      clearAllNotificationTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  // ✅ adicionar
  function add() {
    const t = titulo.trim();
    if (!t) return toastMsg("Preencha o título.");

    if (tipo === "avulso") {
      if (!quando) return toastMsg("Preencha a data/hora.");

      const dt = parseLocalDateTime(quando);
      if (!dt) return toastMsg("Data/hora inválida.");

      const k = toLocalDateKey(dt);
      if (conflictMode === "block" && hasDateConflict(list, k, null)) {
        return toastMsg("Já existe um lembrete para esse dia.");
      }

      const item = {
        id: uuid(),
        tipo: "avulso",
        titulo: t,
        quando,
        done: false,
        nivel,
        conflictMode,
        createdAt: nowISO(),
        doneAt: null,
        updatedAt: nowISO(),
      };

      const next = [item, ...list].sort((a, b) =>
        String(a.quando || "").localeCompare(String(b.quando || ""))
      );
      save(next);

      scheduleNotificationAt(item.titulo, dt, item.titulo);

      setTitulo("");
      setQuando("");
      voiceFinalRef.current = "";
      setAddModalOpen(false);
      toastMsg("Lembrete salvo.");
      return;
    }

    if (scheduleType === "semanal" && (!Array.isArray(weekdays) || weekdays.length === 0)) {
      return toastMsg("Marque pelo menos 1 dia da semana.");
    }
    if (scheduleType === "mensal") {
      const d = Number(diaMes);
      if (!d || d < 1 || d > 31) return toastMsg("Dia do mês inválido (1 a 31).");
    }
    if (scheduleType === "aniversario") {
      if (!dataBaseYMD || !parseYMD(dataBaseYMD))
        return toastMsg("Informe a data do aniversário (YYYY-MM-DD).");
    }
    if (scheduleType === "personalizado") {
      const arr = parseFixedDatesList(datasFixasText);
      if (!arr.length) return toastMsg("Informe pelo menos 1 data no personalizado.");
    }

    const itemLike = {
      tipo: "recorrente",
      scheduleType,
      weekdays: weekdays || [],
      diaMes: Number(diaMes || 1),
      dataBaseYMD: dataBaseYMD || "",
      datasFixas: parseFixedDatesList(datasFixasText),
      every: String(Math.max(1, Number(every || 1))),
      unit,
      timeHHmm,
      nivel,
      conflictMode,
      noSameDay: conflictMode === "shift",
    };

    const computed = computeNextDueWithConflict(itemLike, new Date(), list, null);
    if (!computed) return toastMsg("Não consegui calcular a próxima data. Verifique as opções.");
    if (computed.__conflict) return toastMsg("Já existe um lembrete para esse dia.");

    const item = {
      id: uuid(),
      tipo: "recorrente",
      titulo: t,

      scheduleType,
      weekdays: itemLike.weekdays,
      diaMes: itemLike.diaMes,
      dataBaseYMD: itemLike.dataBaseYMD,
      datasFixas: itemLike.datasFixas,
      nivel,
      conflictMode,

      every: itemLike.every,
      unit: itemLike.unit,
      timeHHmm: itemLike.timeHHmm,

      enabled: true,
      nextDueISO: computed.toISOString(),
      lastNotifiedDate: null,
      paidAt: null,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    const next = [item, ...list].sort((a, b) =>
      String(a.nextDueISO || "").localeCompare(String(b.nextDueISO || ""))
    );
    save(next);

    scheduleNotificationAt(`${item.titulo} hoje`, new Date(item.nextDueISO), `${item.titulo} hoje`);

    setTitulo("");
    setScheduleType("intervalo");
    setEvery("3");
    setUnit("dias");
    setTimeHHmm("09:00");
    setWeekdays([1, 2, 3, 4, 5]);
    setDiaMes("5");
    setDataBaseYMD("");
    setDatasFixasText("2026-02-05, 2026-03-10");
    setNivel("rapido");
    setConflictMode("allow");
    voiceFinalRef.current = "";
    setAddModalOpen(false);
    toastMsg("Recorrente salvo.");
  }

  // ✅ botão "Feito/Reabrir" do avulso
  function toggleDoneAvulso(id) {
    const next = list.map((i) => {
      if (i.id !== id) return i;
      if (i.tipo !== "avulso") return i;
      const done = !i.done;
      return { ...i, done, doneAt: done ? nowISO() : null, updatedAt: nowISO() };
    });
    save(next);
  }

  // ✅ botão "Pago/Feito" do recorrente (AGORA É AQUI QUE ELE GIRA)
  function payRecurring(id) {
    const todayKey = toLocalDateKey(new Date());

    const next = list.map((i) => {
      if (i.id !== id) return i;
      if (i.tipo !== "recorrente") return i;

      const computed = computeNextFromCurrentDue(i, list);

      if (computed && computed.__conflict) {
        toastMsg("Conflito: já existe lembrete nesse dia. Ajuste o modo de conflito ou a agenda.");
        return { ...i, paidAt: nowISO(), lastNotifiedDate: todayKey, updatedAt: nowISO() };
      }

      if (!computed || !computed.toISOString) return i;

      return {
        ...i,
        paidAt: nowISO(),
        lastNotifiedDate: todayKey,
        nextDueISO: computed.toISOString(),
        updatedAt: nowISO(),
      };
    });

    save(next);
    toastMsg("Pago/Feito ✅ Próximo agendado.");
  }

  // ✅ NOVO: pergunta bonitinho antes de pagar
  function askPayRecurring(item) {
    const dueText = item?.nextDueISO ? fmtBRDateTimeISO(item.nextDueISO) : "-";
    const st = labelScheduleType(item);
    const time = item?.timeHHmm || "09:00";

    setConfirmCfg({
      title: "Confirmar pagamento",
      body: (
        <div>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Marcar como Pago/Feito?</div>

          <div className="muted" style={{ lineHeight: 1.35 }}>
            <div style={{ marginBottom: 8 }}>
              <b>{item?.titulo || "Lembrete"}</b>
            </div>

            <div style={{ marginBottom: 8 }}>
              Próximo agendado atual: <b>{dueText}</b>
            </div>

            <div style={{ marginBottom: 8 }}>
              Tipo: <b>{st}</b> • Horário: <b>{time}</b>
            </div>

            <div
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 12,
                background: "rgba(16,185,129,.10)",
                border: "1px solid rgba(16,185,129,.25)",
              }}
            >
              ✅ Ao confirmar, o app vai marcar como pago e calcular a <b>próxima data</b>.
            </div>
          </div>
        </div>
      ),
      danger: false,
      confirmText: "Sim, pagar",
      cancelText: "Agora não",
      action: () => payRecurring(item.id),
    });

    setConfirmOpen(true);
  }

  function askRemove(id) {
    setConfirmCfg({
      title: "Excluir lembrete",
      body: "Excluir este lembrete?",
      danger: true,
      confirmText: "Excluir",
      cancelText: "Cancelar",
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
      setEditingNivel(item.nivel || "rapido");
      setEditingConflictMode(item.conflictMode || "allow");

      setEditingScheduleType("intervalo");
      setEditingEvery("3");
      setEditingUnit("dias");
      setEditingTime("09:00");
      setEditingWeekdays([1, 2, 3, 4, 5]);
      setEditingDiaMes("5");
      setEditingDataBaseYMD("");
      setEditingDatasFixasText("2026-02-05, 2026-03-10");
      return;
    }

    setEditingQuando("");

    setEditingNivel(item.nivel || "rapido");
    setEditingConflictMode(item.conflictMode || (item.noSameDay ? "shift" : "allow"));

    setEditingScheduleType(item.scheduleType || "intervalo");
    setEditingEvery(String(item.every || "3"));
    setEditingUnit(item.unit || "dias");
    setEditingTime(item.timeHHmm || "09:00");
    setEditingWeekdays(Array.isArray(item.weekdays) ? item.weekdays : [1, 2, 3, 4, 5]);
    setEditingDiaMes(String(item.diaMes || 5));
    setEditingDataBaseYMD(item.dataBaseYMD || "");
    setEditingDatasFixasText(
      Array.isArray(item.datasFixas) && item.datasFixas.length
        ? item.datasFixas.join(", ")
        : "2026-02-05, 2026-03-10"
    );
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingTipo("avulso");
    setEditingTitulo("");
    setEditingQuando("");

    setEditingScheduleType("intervalo");
    setEditingEvery("3");
    setEditingUnit("dias");
    setEditingTime("09:00");
    setEditingWeekdays([1, 2, 3, 4, 5]);
    setEditingDiaMes("5");
    setEditingDataBaseYMD("");
    setEditingDatasFixasText("2026-02-05, 2026-03-10");
    setEditingNivel("rapido");
    setEditingConflictMode("allow");
  }

  function commitEdit(id) {
    const t = editingTitulo.trim();
    if (!t) return toastMsg("Preencha o título.");

    const next = list.map((i) => {
      if (i.id !== id) return i;

      const newTipo = editingTipo || i.tipo || "avulso";

      if (newTipo === "avulso") {
        if (!editingQuando) {
          toastMsg("Preencha a data/hora.");
          return i;
        }
        const dt = parseLocalDateTime(editingQuando);
        if (!dt) {
          toastMsg("Data/hora inválida.");
          return i;
        }
        const k = toLocalDateKey(dt);
        const cm = editingConflictMode || "allow";
        if (cm === "block" && hasDateConflict(list, k, i.id)) {
          toastMsg("Já existe um lembrete para esse dia.");
          return i;
        }

        return {
          ...i,
          tipo: "avulso",
          titulo: t,
          quando: editingQuando,
          done: i.tipo === "avulso" ? !!i.done : false,
          doneAt: i.tipo === "avulso" ? i.doneAt : null,
          nivel: editingNivel || "rapido",
          conflictMode: cm,
          updatedAt: nowISO(),
        };
      }

      const cm = editingConflictMode || "allow";
      const st = editingScheduleType || "intervalo";

      if (st === "semanal" && (!editingWeekdays || editingWeekdays.length === 0)) {
        toastMsg("Marque pelo menos 1 dia da semana.");
        return i;
      }
      if (st === "mensal") {
        const d = Number(editingDiaMes);
        if (!d || d < 1 || d > 31) {
          toastMsg("Dia do mês inválido (1 a 31).");
          return i;
        }
      }
      if (st === "aniversario") {
        if (!editingDataBaseYMD || !parseYMD(editingDataBaseYMD)) {
          toastMsg("Informe a data do aniversário (YYYY-MM-DD).");
          return i;
        }
      }
      if (st === "personalizado") {
        const arr = parseFixedDatesList(editingDatasFixasText);
        if (!arr.length) {
          toastMsg("Informe pelo menos 1 data no personalizado.");
          return i;
        }
      }

      const itemLike = {
        ...i,
        tipo: "recorrente",
        titulo: t,

        scheduleType: st,
        every: String(Math.max(1, Number(editingEvery || 1))),
        unit: editingUnit || "dias",
        timeHHmm: editingTime || "09:00",
        weekdays: editingWeekdays || [],
        diaMes: Number(editingDiaMes || 1),
        dataBaseYMD: editingDataBaseYMD || "",
        datasFixas: parseFixedDatesList(editingDatasFixasText),
        nivel: editingNivel || "rapido",
        conflictMode: cm,
        noSameDay: cm === "shift",
      };

      const computed = computeNextDueWithConflict(itemLike, new Date(), list, i.id);

      if (computed && computed.__conflict) {
        toastMsg("Já existe um lembrete para esse dia.");
        return i;
      }
      if (!computed || !computed.toISOString) {
        toastMsg("Não consegui calcular a próxima data. Verifique as opções.");
        return i;
      }

      return {
        ...i,
        tipo: "recorrente",
        titulo: t,

        scheduleType: itemLike.scheduleType,
        every: itemLike.every,
        unit: itemLike.unit,
        timeHHmm: itemLike.timeHHmm,
        weekdays: itemLike.weekdays,
        diaMes: itemLike.diaMes,
        dataBaseYMD: itemLike.dataBaseYMD,
        datasFixas: itemLike.datasFixas,
        nivel: itemLike.nivel,
        conflictMode: itemLike.conflictMode,

        enabled: i.enabled === false ? false : true,
        nextDueISO: computed.toISOString(),
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
      confirmText: "Apagar",
      cancelText: "Cancelar",
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
      confirmText: "Apagar tudo",
      cancelText: "Cancelar",
      action: () => {
        save([]);
        toastMsg("Tudo apagado.");
      },
    });
    setConfirmOpen(true);
  }

  const menuItems = [
    { label: "Ativar notificações", danger: false, onClick: enableNotifications },
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

    if (range !== "all") {
      const now = new Date();
      const from = startOfDay(now);
      const to = range === "today" ? endOfDay(now) : endOfDay(addDays(now, 6));

      base = base.filter((i) => {
        if (i.tipo === "avulso") {
          if (i.done) return false;
          const dt = parseLocalDateTime(i.quando);
          if (!dt) return false;
          return dt.getTime() >= from.getTime() && dt.getTime() <= to.getTime();
        }
        if (i.tipo === "recorrente") {
          if (i.enabled === false) return false;
          const dt = new Date(i.nextDueISO || "");
          if (Number.isNaN(dt.getTime())) return false;
          return dt.getTime() >= from.getTime() && dt.getTime() <= to.getTime();
        }
        return true;
      });
    }

    if (q) base = base.filter((i) => normalizeText(i.titulo).includes(q));

    return base
      .slice()
      .sort((a, b) => {
        const ax = a.tipo === "recorrente" ? a.nextDueISO || "" : a.quando || "";
        const bx = b.tipo === "recorrente" ? b.nextDueISO || "" : b.quando || "";
        return String(ax).localeCompare(String(bx));
      });
  }, [list, tab, search, range]);

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

  function labelScheduleType(it) {
    const st = it.scheduleType || "intervalo";
    if (st === "diario") return "diário";
    if (st === "semanal") return "semanal";
    if (st === "mensal") return "mensal";
    if (st === "aniversario") return "aniversário";
    if (st === "personalizado") return "datas fixas";
    return "intervalo";
  }

  function labelNivel(n) {
    const v = String(n || "").toLowerCase();
    if (v === "medio") return "médio";
    if (v === "demorado") return "demorado";
    return "rápido";
  }

  return (
    <div className="page">
      <Toast text={toastText} />

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-end" }}>
        <div>
          <h2 className="page-title">⏰ Lembretes</h2>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="chip"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setInfoModalOpen(true);
            }}
            title="Ajuda/Info"
          >
            ℹ️ Ajuda/Info
          </button>

          <button
            type="button"
            className="primary-btn"
            style={{ width: "auto", padding: "10px 14px" }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setAddModalOpen(true);
            }}
          >
            ➕ Novo lembrete
          </button>

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

      {/* Modal Info */}
      <Modal open={infoModalOpen} title="Informações" onClose={() => setInfoModalOpen(false)}>
        <div className="muted small" style={{ lineHeight: 1.4 }}>
          <div style={{ marginBottom: 10 }}>
            {user?.uid ? "☁️ Online: sincronizando com sua conta" : "📵 Offline: salvando só no aparelho (faça login para sincronizar)"}
          </div>

          <div style={{ marginBottom: 10 }}>
            🔔 Sem push, o app só consegue garantir agendamento quando ele abre (o sistema pode pausar timers).
          </div>

          <div style={{ marginBottom: 10 }}>
            📌 Notificações do jeito certo:
            <br />• Mostra só o que é para fazer no dia.
            <br />• O recorrente só vai para a próxima data quando você clicar em <b>Pago/Feito</b>.
          </div>

          <div>
            Conflito no mesmo dia:
            <br />• <b>Permitir</b>: aceita mais de um no mesmo dia.
            <br />• <b>Empurrar</b>: se já tiver outro, empurra para o próximo dia livre.
            <br />• <b>Bloquear</b>: não salva se já existir naquele dia.
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" className="primary-btn" style={{ width: "auto", padding: "10px 14px" }} onClick={() => setInfoModalOpen(false)}>
              Fechar
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal criar lembrete */}
      <Modal open={addModalOpen} title="Novo lembrete" onClose={() => setAddModalOpen(false)}>
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

        <div className="filters-grid mt">
          <div className="field">
            <label>Nível/Duração</label>
            <select value={nivel} onChange={(e) => setNivel(e.target.value)}>
              <option value="rapido">Rápido</option>
              <option value="medio">Médio</option>
              <option value="demorado">Demorado</option>
            </select>
          </div>

          <div className="field">
            <label>Conflito no mesmo dia</label>
            <select value={conflictMode} onChange={(e) => setConflictMode(e.target.value)}>
              <option value="allow">Permitir</option>
              <option value="shift">Empurrar para outro dia</option>
              <option value="block">Bloquear (não salvar)</option>
            </select>
            <div className="muted small" style={{ marginTop: 6 }}>
              “Bloquear” impede criar se já existir algo naquele dia.
            </div>
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
            <div className="filters-grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Tipo de recorrência</label>
                <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value)}>
                  <option value="intervalo">Intervalo (a cada X dias/semanas)</option>
                  <option value="diario">Diário</option>
                  <option value="semanal">Semanal (dias da semana)</option>
                  <option value="mensal">Mensal (dia do mês)</option>
                  <option value="aniversario">Aniversário (anual)</option>
                  <option value="personalizado">Datas fixas (lista)</option>
                </select>
              </div>

              <div className="field">
                <label>Horário</label>
                <input type="time" value={timeHHmm} onChange={(e) => setTimeHHmm(e.target.value)} />
              </div>
            </div>

            {scheduleType === "intervalo" ? (
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

            {scheduleType === "semanal" ? (
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

            {scheduleType === "mensal" ? (
              <div className="field" style={{ marginTop: 12 }}>
                <label>Dia do mês</label>
                <input value={diaMes} onChange={(e) => setDiaMes(e.target.value)} inputMode="numeric" placeholder="Ex: 5" />
                <div className="muted small" style={{ marginTop: 6 }}>
                  Se o mês não tiver esse dia, ele usa o último dia do mês.
                </div>
              </div>
            ) : null}

            {scheduleType === "aniversario" ? (
              <div className="field" style={{ marginTop: 12 }}>
                <label>Data do aniversário</label>
                <input type="date" value={dataBaseYMD} onChange={(e) => setDataBaseYMD(e.target.value)} />
              </div>
            ) : null}

            {scheduleType === "personalizado" ? (
              <div className="field" style={{ marginTop: 12 }}>
                <label>Datas fixas (YYYY-MM-DD)</label>
                <input
                  value={datasFixasText}
                  onChange={(e) => setDatasFixasText(e.target.value)}
                  placeholder="Ex: 2026-02-05, 2026-03-10"
                />
                <div className="muted small" style={{ marginTop: 6 }}>
                  Separe por vírgula ou quebra de linha.
                </div>
              </div>
            ) : null}
          </>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            className="chip"
            style={{ width: "auto" }}
            onClick={() => setAddModalOpen(false)}
          >
            Cancelar
          </button>

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
      </Modal>

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

      {/* Card: busca + tabs */}
      <div className="card mt">
        <div className="field">
          <label>Buscar</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ex.: internet, banho..." />
        </div>

        <div className="chips-row" style={{ flexWrap: "wrap" }}>
          <button type="button" className={"chip " + (tab === "pending" ? "chip-active" : "")} onClick={() => setTab("pending")}>
            Pendentes
          </button>
          <button type="button" className={"chip " + (tab === "done" ? "chip-active" : "")} onClick={() => setTab("done")}>
            Concluídos
          </button>
          <button type="button" className={"chip " + (tab === "all" ? "chip-active" : "")} onClick={() => setTab("all")}>
            Todos
          </button>

          <span style={{ width: 12 }} />

          <button type="button" className={"chip " + (range === "today" ? "chip-active" : "")} onClick={() => setRange("today")}>
            Hoje
          </button>
          <button type="button" className={"chip " + (range === "week" ? "chip-active" : "")} onClick={() => setRange("week")}>
            Esta semana
          </button>
          <button type="button" className={"chip " + (range === "all" ? "chip-active" : "")} onClick={() => setRange("all")}>
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
                            opacity:
                              i.tipo === "avulso" && i.done
                                ? 0.65
                                : i.tipo === "recorrente" && i.enabled === false
                                ? 0.6
                                : 1,
                            textDecoration: i.tipo === "avulso" && i.done ? "line-through" : "none",
                          }}
                        >
                          {i.titulo}{" "}
                          <span className="muted small" style={{ fontWeight: 600 }}>
                            {i.tipo === "recorrente" ? `• recorrente (${labelScheduleType(i)})` : "• avulso"}
                          </span>
                        </div>

                        <div className="muted small" style={{ marginTop: 4 }}>
                          <span>⏳ {labelNivel(i.nivel)} </span>
                          <span>• Conflito: {i.conflictMode || (i.noSameDay ? "shift" : "allow")}</span>
                        </div>

                        <div className="muted small" style={{ marginTop: 6 }}>
                          {i.tipo === "avulso" ? (
                            <>📅 {fmtBRDateTimeLocal(i.quando)}</>
                          ) : (
                            <>
                              ⏱ Próximo: <b>{fmtBRDateTimeISO(i.nextDueISO)}</b> • {i.timeHHmm}{" "}
                              {i.enabled === false ? "• (pausado)" : ""}
                            </>
                          )}
                        </div>
                      </>
                    ) : (
                      <div>
                        <div className="muted small" style={{ marginBottom: 8 }}>
                          Editando (completo)
                        </div>

                        <div className="filters-grid">
                          <div className="field">
                            <label>Tipo</label>
                            <select value={editingTipo} onChange={(e) => setEditingTipo(e.target.value)}>
                              <option value="avulso">Avulso</option>
                              <option value="recorrente">Recorrente</option>
                            </select>
                          </div>

                          <div className="field">
                            <label>Nível/Duração</label>
                            <select value={editingNivel} onChange={(e) => setEditingNivel(e.target.value)}>
                              <option value="rapido">Rápido</option>
                              <option value="medio">Médio</option>
                              <option value="demorado">Demorado</option>
                            </select>
                          </div>
                        </div>

                        <div className="field" style={{ marginTop: 10 }}>
                          <label>Conflito no mesmo dia</label>
                          <select value={editingConflictMode} onChange={(e) => setEditingConflictMode(e.target.value)}>
                            <option value="allow">Permitir</option>
                            <option value="shift">Empurrar</option>
                            <option value="block">Bloquear</option>
                          </select>
                        </div>

                        <div className="field" style={{ marginTop: 10 }}>
                          <label>Título</label>
                          <input value={editingTitulo} onChange={(e) => setEditingTitulo(e.target.value)} />
                        </div>

                        {editingTipo === "avulso" ? (
                          <div className="field" style={{ marginTop: 10 }}>
                            <label>Quando</label>
                            <input value={editingQuando} onChange={(e) => setEditingQuando(e.target.value)} type="datetime-local" />
                          </div>
                        ) : (
                          <>
                            <div className="filters-grid" style={{ marginTop: 10 }}>
                              <div className="field">
                                <label>Tipo de recorrência</label>
                                <select value={editingScheduleType} onChange={(e) => setEditingScheduleType(e.target.value)}>
                                  <option value="intervalo">Intervalo</option>
                                  <option value="diario">Diário</option>
                                  <option value="semanal">Semanal</option>
                                  <option value="mensal">Mensal</option>
                                  <option value="aniversario">Aniversário</option>
                                  <option value="personalizado">Datas fixas</option>
                                </select>
                              </div>

                              <div className="field">
                                <label>Horário</label>
                                <input type="time" value={editingTime} onChange={(e) => setEditingTime(e.target.value)} />
                              </div>
                            </div>

                            {editingScheduleType === "intervalo" ? (
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

                            {editingScheduleType === "semanal" ? (
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

                            {editingScheduleType === "mensal" ? (
                              <div className="field" style={{ marginTop: 10 }}>
                                <label>Dia do mês</label>
                                <input value={editingDiaMes} onChange={(e) => setEditingDiaMes(e.target.value)} inputMode="numeric" />
                              </div>
                            ) : null}

                            {editingScheduleType === "aniversario" ? (
                              <div className="field" style={{ marginTop: 10 }}>
                                <label>Data do aniversário</label>
                                <input type="date" value={editingDataBaseYMD} onChange={(e) => setEditingDataBaseYMD(e.target.value)} />
                              </div>
                            ) : null}

                            {editingScheduleType === "personalizado" ? (
                              <div className="field" style={{ marginTop: 10 }}>
                                <label>Datas fixas (YYYY-MM-DD)</label>
                                <input value={editingDatasFixasText} onChange={(e) => setEditingDatasFixasText(e.target.value)} />
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
                                askPayRecurring(i); // ✅ aqui!
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
            {confirmCfg.cancelText || "Cancelar"}
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
            {confirmCfg.confirmText || "Confirmar"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
