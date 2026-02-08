// src/pages/ReceitasPage.jsx

import React, { useEffect, useMemo, useRef, useState } from "react";

// ✅ Firebase (salvar online quando estiver logada)
import { auth, db } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";

// Chave do localStorage onde as receitas serão salvas
const LS_KEY = "pwa_receitas_v1";

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

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Categorias
const CATEGORIAS = ["Doces", "Salgados", "Massas", "Bebidas", "Festa", "Fit", "Pães", "Molhos", "Outros"];

/* ---------------- OCR (opcional) ---------------- */

async function ocrImageToText(file) {
  try {
    const mod = await import("tesseract.js");
    const Tesseract = mod?.default || mod;
    const { data } = await Tesseract.recognize(file, "por");
    return String(data?.text || "");
  } catch {
    throw new Error("OCR indisponível (instale tesseract.js).");
  }
}

function parseRecipeFromText(text) {
  const raw = String(text || "").replace(/\r/g, "");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const titulo = (lines[0] || "").slice(0, 80);
  const lower = raw.toLowerCase();

  const idxIng = lower.indexOf("ingredientes") >= 0 ? lower.indexOf("ingredientes") : -1;
  const idxPrep =
    lower.indexOf("modo de preparo") >= 0
      ? lower.indexOf("modo de preparo")
      : lower.indexOf("preparo") >= 0
      ? lower.indexOf("preparo")
      : -1;

  let ingredientes = "";
  let preparo = "";

  if (idxIng >= 0 && idxPrep > idxIng) {
    ingredientes = raw.slice(idxIng, idxPrep);
    preparo = raw.slice(idxPrep);
  } else if (idxPrep >= 0) {
    const before = raw.slice(0, idxPrep);
    const after = raw.slice(idxPrep);
    ingredientes = before;
    preparo = after;
  } else {
    const mid = Math.floor(raw.length / 2);
    ingredientes = raw.slice(0, mid);
    preparo = raw.slice(mid);
  }

  ingredientes = ingredientes.replace(/^\s*ingredientes\s*[:\-]?\s*/i, "").trim();
  preparo = preparo.replace(/^\s*(modo\s+de\s+preparo|preparo)\s*[:\-]?\s*/i, "").trim();

  return { titulo: titulo || "", ingredientes: ingredientes || "", preparo: preparo || "" };
}

/* ---------------- COLAR (entrada única) ---------------- */

function looksLikeListLine(line) {
  const s = line.trim();
  if (!s) return false;
  return s.startsWith("-") || s.startsWith("•") || /^\d+[\)\.\-]/.test(s) || /^[a-z]\)/i.test(s);
}

function cleanHeading(s) {
  return String(s || "").replace(/^\s*[:\-–—]\s*/, "").trim();
}

function parseQuickRecipe(rawText) {
  const raw = String(rawText || "").replace(/\r/g, "");
  const lines = raw.split("\n").map((l) => l.trimEnd());

  const out = {
    titulo: "",
    categoria: "",
    tempo: "",
    rendimento: "",
    dificuldade: "",
    tags: "",
    ingredientes: "",
    preparo: "",
    observacoes: "",
    armazenamento: "",
  };

  // Campo: valor
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;

    const m = l.match(/^([A-Za-zÀ-ÿ\s]+)\s*:\s*(.+)$/i);
    if (!m) continue;

    const key = m[1].trim().toLowerCase();
    const val = m[2].trim();

    if (key.includes("título") || key === "titulo") out.titulo = val;
    else if (key.includes("categoria")) out.categoria = val;
    else if (key.includes("tempo")) out.tempo = val;
    else if (key.includes("rendimento")) out.rendimento = val;
    else if (key.includes("dificuldade")) out.dificuldade = val;
    else if (key.includes("tags")) out.tags = val;
  }

  const lower = raw.toLowerCase();
  const idxIng = lower.search(/\bingredientes\b/);
  const idxPrep = lower.search(/\b(modo\s+de\s+preparo|preparo)\b/);
  const idxObs = lower.search(/\b(observa(ç|c)ões|dicas)\b/);
  const idxArm = lower.search(/\b(armazenamento|validade)\b/);

  const cuts = [
    { name: "ingredientes", idx: idxIng },
    { name: "preparo", idx: idxPrep },
    { name: "observacoes", idx: idxObs },
    { name: "armazenamento", idx: idxArm },
  ]
    .filter((c) => c.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  function sliceSection(fromIdx, toIdx) {
    const chunk = raw.slice(fromIdx, toIdx < 0 ? raw.length : toIdx);
    return chunk
      .replace(
        /^\s*(ingredientes|modo\s+de\s+preparo|preparo|observa(ç|c)ões|dicas|armazenamento|validade)\s*[:\-]?\s*/i,
        ""
      )
      .trim();
  }

  if (cuts.length) {
    for (let i = 0; i < cuts.length; i++) {
      const cur = cuts[i];
      const next = cuts[i + 1];
      const content = sliceSection(cur.idx, next ? next.idx : -1);

      if (cur.name === "ingredientes") out.ingredientes = content;
      if (cur.name === "preparo") out.preparo = content;
      if (cur.name === "observacoes") out.observacoes = content;
      if (cur.name === "armazenamento") out.armazenamento = content;
    }

    if (!out.titulo) {
      const head = raw
        .slice(0, cuts[0].idx)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      out.titulo = (head[0] || "").slice(0, 80);
    }
  } else {
    const clean = lines.map((l) => l.trim()).filter(Boolean);

    out.titulo = out.titulo || (clean[0] || "").slice(0, 80);

    const ingLines = [];
    const prepLines = [];
    const otherLines = [];

    for (const l of clean.slice(1)) {
      const t = l.trim();
      if (looksLikeListLine(t) && !/^\d+[\)\.\-]/.test(t)) ingLines.push(t);
      else if (/^\d+[\)\.\-]/.test(t) || /^[a-z]\)/i.test(t)) prepLines.push(t);
      else otherLines.push(t);
    }

    out.ingredientes = ingLines.join("\n").trim();
    out.preparo = prepLines.join("\n").trim();
    if (otherLines.length) out.observacoes = otherLines.join("\n").trim();
  }

  out.titulo = cleanHeading(out.titulo);
  out.ingredientes = String(out.ingredientes || "").trim();
  out.preparo = String(out.preparo || "").trim();

  return out;
}

// ✅ helper: pega data ISO "mais recente"
function getLatestISO(list) {
  const arr = Array.isArray(list) ? list : [];
  let best = "";
  for (const r of arr) {
    const iso = String(r?.updatedAt || r?.createdAt || "");
    if (iso && iso > best) best = iso;
  }
  return best;
}

/* ------------------- REGRA IMPORTANTE -------------------
   ✅ Firestore: salva receitas SEM foto
   ✅ LocalStorage: salva receitas COM foto
---------------------------------------------------------- */

// Remove foto para enviar ao Firestore
function stripFotosForCloud(arr) {
  const list = Array.isArray(arr) ? arr : [];
  return list.map((r) => {
    const { foto, ...rest } = r || {};
    return { ...rest, foto: "" }; // garante que nunca vai foto/base64
  });
}

// Reaplica fotos do local (por id) em cima do que veio do cloud
function mergeLocalFotos(cloudArr, localArr) {
  const c = Array.isArray(cloudArr) ? cloudArr : [];
  const l = Array.isArray(localArr) ? localArr : [];
  const map = new Map(l.map((r) => [r?.id, r?.foto || ""]));
  return c.map((r) => {
    const localFoto = map.get(r?.id) || "";
    return { ...r, foto: localFoto || "" };
  });
}

/* -------------------- Page -------------------- */

export default function ReceitasPage() {
  const [items, setItems] = useState([]);
  const [uid, setUid] = useState(null);

  // evita “ida e volta” no primeiro load
  const hydratingRef = useRef(false);

  const [modo, setModo] = useState("lista");

  // filtro
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("Todas");
  const [somenteFavoritas, setSomenteFavoritas] = useState(false);

  // form
  const [editId, setEditId] = useState(null);
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState("Doces");
  const [tempo, setTempo] = useState("");
  const [rendimento, setRendimento] = useState("");
  const [dificuldade, setDificuldade] = useState("Fácil");
  const [tags, setTags] = useState("");
  const [ingredientes, setIngredientes] = useState("");
  const [preparo, setPreparo] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [armazenamento, setArmazenamento] = useState("");
  const [foto, setFoto] = useState(""); // ✅ fica só no localStorage

  // colar
  const [quickText, setQuickText] = useState("");

  // importar
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importHint, setImportHint] = useState("");

  // ver
  const [currentId, setCurrentId] = useState(null);
  const [pageFlipDir, setPageFlipDir] = useState("next");
  const flipTimer = useRef(null);

  const [viewMode, setViewMode] = useState("foto");

  // modal
  const [modal, setModal] = useState({
    open: false,
    title: "",
    message: "",
    variant: "info",
    confirmText: "OK",
    cancelText: "",
    onConfirm: null,
    onCancel: null,
  });

  function showInfo(title, message) {
    setModal({
      open: true,
      title: title || "Aviso",
      message: String(message || ""),
      variant: "info",
      confirmText: "OK",
      cancelText: "",
      onConfirm: () => setModal((m) => ({ ...m, open: false })),
      onCancel: null,
    });
  }

  function showConfirm(title, message, onYes) {
    setModal({
      open: true,
      title: title || "Confirmar",
      message: String(message || ""),
      variant: "danger",
      confirmText: "Sim, apagar",
      cancelText: "Cancelar",
      onConfirm: () => {
        setModal((m) => ({ ...m, open: false }));
        if (typeof onYes === "function") onYes();
      },
      onCancel: () => setModal((m) => ({ ...m, open: false })),
    });
  }

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape" && modal.open) {
        if (modal.onCancel) modal.onCancel();
        else if (modal.onConfirm) modal.onConfirm();
        else setModal((m) => ({ ...m, open: false }));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modal.open, modal.onCancel, modal.onConfirm]);

  // login
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid || null);
    });
    return () => unsub();
  }, []);

  // load local primeiro
  useEffect(() => {
    const saved = safeJSONParse(localStorage.getItem(LS_KEY), []);
    setItems(Array.isArray(saved) ? saved : []);
  }, []);

  // load/sync Firestore quando logar (MAS SEM FOTO NO CLOUD)
  useEffect(() => {
    let cancelled = false;

    async function loadCloudAndMerge() {
      if (!uid) return;

      try {
        const ref = doc(db, "users", uid, "pwa", "receitas");
        const snap = await getDoc(ref);

        const local = safeJSONParse(localStorage.getItem(LS_KEY), []);
        const localArr = Array.isArray(local) ? local : [];
        const localLatest = getLatestISO(localArr);

        if (!snap.exists()) {
          // cloud não existe: sobe o local (SEM FOTO)
          if (localArr.length) {
            const payload = stripFotosForCloud(localArr);
            await setDoc(ref, { items: payload, updatedAt: nowISO() }, { merge: true });
          }
          return;
        }

        const data = snap.data() || {};
        const cloudArrRaw = Array.isArray(data.items) ? data.items : [];
        const cloudLatest = getLatestISO(cloudArrRaw);

        // Decide quem “ganha” (mais novo)
        const pickCloud = cloudLatest >= localLatest;

        // escolhido (cloud ou local), mas:
        // - se for cloud, reaplica fotos do local (por id)
        // - se for local, mantém fotos no aparelho e manda SEM FOTO pro cloud depois
        let chosen = pickCloud ? mergeLocalFotos(cloudArrRaw, localArr) : localArr;

        if (cancelled) return;

        hydratingRef.current = true;
        setItems(chosen);
        localStorage.setItem(LS_KEY, JSON.stringify(chosen));
        setTimeout(() => {
          hydratingRef.current = false;
        }, 0);

        // se local era mais novo, atualiza cloud (SEM FOTO)
        if (!pickCloud && chosen.length) {
          const payload = stripFotosForCloud(chosen);
          await setDoc(ref, { items: payload, updatedAt: nowISO() }, { merge: true });
        }
      } catch (e) {
        // ✅ FIX: mostrar erro real (antes você não via nada no app)
        console.error("Falha ao carregar/sincronizar receitas (cloud):", e);
        showInfo(
          "Não consegui sincronizar online",
          "As receitas continuam salvas no aparelho.\n\nAbra o Console (F12 > Console) para ver o erro e me mande a mensagem."
        );
      }
    }

    loadCloudAndMerge();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // ✅ salva local + cloud (SEM FOTO NO CLOUD)
  async function save(next) {
    setItems(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next));

    if (hydratingRef.current) return;

    if (uid) {
      try {
        const ref = doc(db, "users", uid, "pwa", "receitas");
        const payload = stripFotosForCloud(next); // ✅ aqui garante: foto nunca vai
        await setDoc(ref, { items: payload, updatedAt: nowISO() }, { merge: true });
      } catch (e) {
        // ✅ FIX: mostrar erro real (antes era só console)
        console.error("Falha ao salvar receitas no cloud:", e);
        showInfo(
          "Falha ao salvar online",
          "Salvei no aparelho, mas não consegui salvar na nuvem.\n\nAbra o Console (F12 > Console) e me mande o erro."
        );
      }
    }
  }

  const filtered = useMemo(() => {
    const nq = normalizeText(q);
    return (items || [])
      .filter((r) => (cat === "Todas" ? true : r.categoria === cat))
      .filter((r) => (somenteFavoritas ? !!r.favorita : true))
      .filter((r) => {
        if (!nq) return true;
        const blob = normalizeText(
          [r.titulo, r.categoria, r.tags?.join?.(", ") || "", r.ingredientes || "", r.preparo || "", r.observacoes || ""].join(" ")
        );
        return blob.includes(nq);
      })
      .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
  }, [items, q, cat, somenteFavoritas]);

  const current = useMemo(() => {
    return (items || []).find((r) => r.id === currentId) || null;
  }, [items, currentId]);

  const currentIndex = useMemo(() => {
    if (!currentId) return -1;
    return filtered.findIndex((r) => r.id === currentId);
  }, [filtered, currentId]);

  function resetForm() {
    setEditId(null);
    setTitulo("");
    setCategoria("Doces");
    setTempo("");
    setRendimento("");
    setDificuldade("Fácil");
    setTags("");
    setIngredientes("");
    setPreparo("");
    setObservacoes("");
    setArmazenamento("");
    setFoto("");
  }

  function applyParsedToForm(parsed) {
    if (!parsed) return;
    if (parsed.titulo) setTitulo(parsed.titulo);
    if (parsed.categoria) setCategoria(parsed.categoria);
    if (parsed.tempo) setTempo(parsed.tempo);
    if (parsed.rendimento) setRendimento(parsed.rendimento);
    if (parsed.dificuldade) setDificuldade(parsed.dificuldade);
    if (parsed.tags) setTags(parsed.tags);
    if (parsed.ingredientes) setIngredientes(parsed.ingredientes);
    if (parsed.preparo) setPreparo(parsed.preparo);
    if (parsed.observacoes) setObservacoes(parsed.observacoes);
    if (parsed.armazenamento) setArmazenamento(parsed.armazenamento);
  }

  function openNew() {
    resetForm();
    setModo("form");
  }

  function openImport() {
    setImportError("");
    setImportHint("");
    setImportLoading(false);
    setImportFile(null);
    setImportPreview("");
    setModo("importar");
  }

  function openColar() {
    resetForm();
    setQuickText("");
    setModo("colar");
  }

  function openEdit(r) {
    setEditId(r.id);
    setTitulo(r.titulo || "");
    setCategoria(r.categoria || "Doces");
    setTempo(r.tempo || "");
    setRendimento(r.rendimento || "");
    setDificuldade(r.dificuldade || "Fácil");
    setTags((r.tags || []).join(", "));
    setIngredientes(r.ingredientes || "");
    setPreparo(r.preparo || "");
    setObservacoes(r.observacoes || "");
    setArmazenamento(r.armazenamento || "");
    setFoto(r.foto || "");
    setModo("form");
  }

  function openView(id) {
    setCurrentId(id);
    setPageFlipDir("next");
    triggerFlip();
    setViewMode("foto");
    setModo("ver");
  }

  function triggerFlip() {
    if (flipTimer.current) clearTimeout(flipTimer.current);
    document.documentElement.classList.add("page-flip-active");
    flipTimer.current = setTimeout(() => {
      document.documentElement.classList.remove("page-flip-active");
    }, 520);
  }

  function toggleFavorita(id) {
    const next = (items || []).map((r) => (r.id === id ? { ...r, favorita: !r.favorita, updatedAt: nowISO() } : r));
    save(next);
  }

  function removeReceita(id) {
    showConfirm("Apagar receita", "Tem certeza que deseja apagar esta receita?", () => {
      const next = (items || []).filter((r) => r.id !== id);
      save(next);
      if (currentId === id) {
        setModo("lista");
        setCurrentId(null);
      }
    });
  }

  async function onFotoChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await fileToDataUrl(f);
    setFoto(dataUrl); // ✅ fica no localStorage; no cloud vai como ""
  }

  // colar
  function tagsToArray(tagsText) {
    return String(tagsText || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function saveParsedRecipeDirect(parsed) {
    const t = String(parsed?.titulo || "").trim();
    if (!t) return showInfo("Faltou título", "Coloque um título.");
    if (!String(parsed?.ingredientes || "").trim()) return showInfo("Faltou ingredientes", "Coloque os ingredientes.");
    if (!String(parsed?.preparo || "").trim()) return showInfo("Faltou preparo", "Coloque o modo de preparo.");

    const catParsed = String(parsed?.categoria || "").trim();
    const catFinal = catParsed ? (CATEGORIAS.includes(catParsed) ? catParsed : "Outros") : "Doces";

    const difParsed = String(parsed?.dificuldade || "").trim();
    const difFinal = difParsed || "Fácil";

    const base = {
      titulo: t,
      categoria: catFinal,
      tempo: String(parsed?.tempo || "").trim(),
      rendimento: String(parsed?.rendimento || "").trim(),
      dificuldade: difFinal,
      tags: tagsToArray(parsed?.tags || ""),
      ingredientes: String(parsed?.ingredientes || "").trim(),
      preparo: String(parsed?.preparo || "").trim(),
      observacoes: String(parsed?.observacoes || "").trim(),
      armazenamento: String(parsed?.armazenamento || "").trim(),
      foto: "",
      updatedAt: nowISO(),
    };

    const next = [{ id: uuid(), createdAt: nowISO(), favorita: false, ...base }, ...(items || [])];

    save(next);
    setModo("lista");
    resetForm();
    setQuickText("");
    showInfo("Salvo ✅", "Receita salva direto a partir do texto colado.");
  }

  function submit() {
    const t = titulo.trim();
    if (!t) return showInfo("Faltou título", "Coloque um título.");
    if (!ingredientes.trim()) return showInfo("Faltou ingredientes", "Coloque os ingredientes.");
    if (!preparo.trim()) return showInfo("Faltou preparo", "Coloque o modo de preparo.");

    const tagsArr = tags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const base = {
      titulo: t,
      categoria,
      tempo: tempo.trim(),
      rendimento: rendimento.trim(),
      dificuldade,
      tags: tagsArr,
      ingredientes: ingredientes.trim(),
      preparo: preparo.trim(),
      observacoes: observacoes.trim(),
      armazenamento: armazenamento.trim(),
      foto, // ✅ local ok / cloud vai ser removida no save()
      updatedAt: nowISO(),
    };

    if (editId) {
      const next = (items || []).map((r) => (r.id === editId ? { ...r, ...base } : r));
      save(next);
    } else {
      const next = [{ id: uuid(), createdAt: nowISO(), favorita: false, ...base }, ...(items || [])];
      save(next);
    }

    setModo("lista");
    resetForm();
  }

  function goPrev() {
    if (currentIndex <= 0) return;
    setPageFlipDir("prev");
    setCurrentId(filtered[currentIndex - 1].id);
    triggerFlip();
  }

  function goNext() {
    if (currentIndex < 0 || currentIndex >= filtered.length - 1) return;
    setPageFlipDir("next");
    setCurrentId(filtered[currentIndex + 1].id);
    triggerFlip();
  }

  async function onImportFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setImportError("");
    setImportHint("");
    setImportFile(f);

    try {
      const preview = await fileToDataUrl(f);
      setImportPreview(preview);
      setImportHint("Agora clique em “Ler receita da foto” para preencher automaticamente (se OCR estiver disponível).");
    } catch (err) {
      console.error(err);
      setImportError("Não consegui ler essa imagem. Tente outra.");
    }
  }

  async function lerReceitaDaFoto() {
    setImportError("");
    setImportHint("");
    if (!importFile || !importPreview) {
      setImportError("Escolha uma foto primeiro.");
      return;
    }

    setImportLoading(true);
    try {
      const text = await ocrImageToText(importFile);
      const parsed = parseRecipeFromText(text);

      resetForm();
      setFoto(importPreview);

      if (parsed.titulo) setTitulo(parsed.titulo);
      if (parsed.ingredientes) setIngredientes(parsed.ingredientes);
      if (parsed.preparo) setPreparo(parsed.preparo);

      setCategoria("Doces");
      setDificuldade("Fácil");

      setModo("form");
    } catch (err) {
      console.error(err);

      resetForm();
      setFoto(importPreview);
      setModo("form");

      showInfo(
        "OCR indisponível",
        "Não consegui ler a receita automaticamente.\n\nSe quiser leitura automática, instale: npm i tesseract.js"
      );
    } finally {
      setImportLoading(false);
    }
  }

  return (
    <div className="page receitas">
      <h2 className="page-title">🍳 Receitas</h2>

      {/* MODO LISTA */}
      {modo === "lista" && (
        <>
          <div className="card">
            <div className="field">
              <label>Pesquisar</label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ex: brigadeiro, leite ninho, farinha, forno..."
              />
            </div>

            <div className="filters-grid">
              <div className="field">
                <label>Categoria</label>
                <select value={cat} onChange={(e) => setCat(e.target.value)}>
                  <option value="Todas">Todas</option>
                  {CATEGORIAS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Favoritas</label>
                <button
                  type="button"
                  className={"chip " + (somenteFavoritas ? "chip-active" : "")}
                  onClick={() => setSomenteFavoritas((v) => !v)}
                >
                  {somenteFavoritas ? "⭐ Só favoritas" : "☆ Mostrar todas"}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button type="button" className="primary-btn" onClick={openNew} style={{ flex: 1 }}>
                + Nova receita
              </button>

              <button
                type="button"
                className="primary-btn"
                onClick={openColar}
                style={{ flex: 1 }}
                title="Colar texto de uma receita e organizar"
              >
                ✍️ Colar
              </button>

              <button
                type="button"
                className="primary-btn"
                onClick={openImport}
                style={{ flex: 1 }}
                title="Importar por foto do dispositivo"
              >
                🖼 Importar
              </button>
            </div>

            {/* ✅ status do cloud */}
            <div className="muted small" style={{ marginTop: 10 }}>
              {uid
                ? "☁️ Salvando online (SEM fotos). Fotos ficam só no aparelho."
                : "📱 Salvando só neste aparelho (sem login)."}
            </div>
          </div>

          <div className="card mt">
            <div className="muted small">
              Total: <b>{filtered.length}</b>
            </div>

            {filtered.length === 0 ? (
              <p className="muted mt">Nenhuma receita encontrada.</p>
            ) : (
              <ul className="list mt">
                {filtered.map((r) => (
                  <li key={r.id} className="list-item">
                    <button type="button" className="receita-row" onClick={() => openView(r.id)} title="Abrir">
                      <div className="receita-title" style={{ gap: 10 }}>
                        {r.foto ? (
                          <img
                            src={r.foto}
                            alt=""
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 10,
                              objectFit: "cover",
                              border: "1px solid rgba(255,255,255,.12)",
                            }}
                          />
                        ) : (
                          <span className="receita-emoji">📖</span>
                        )}

                        <div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <b>{r.titulo}</b>
                            {r.favorita ? <span className="badge">⭐</span> : null}
                          </div>
                          <div className="muted small">
                            {r.categoria} • {r.tempo || "—"} • {r.rendimento || "—"} • {r.dificuldade || "—"}
                          </div>
                        </div>
                      </div>
                    </button>

                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className={"chip " + (r.favorita ? "chip-active" : "")}
                        onClick={() => toggleFavorita(r.id)}
                        style={{ width: "auto" }}
                        title="Favoritar"
                      >
                        {r.favorita ? "⭐" : "☆"}
                      </button>

                      <button type="button" className="chip" onClick={() => openEdit(r)} style={{ width: "auto" }} title="Editar">
                        ✏️
                      </button>

                      <button type="button" className="chip" onClick={() => removeReceita(r.id)} style={{ width: "auto" }} title="Apagar">
                        🗑️
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {/* MODO IMPORTAR */}
      {modo === "importar" && (
        <div className="card">
          <div className="card-header-row">
            <h3 style={{ margin: 0 }}>Importar por imagem</h3>
            <button
              type="button"
              className="chip"
              style={{ width: "auto" }}
              onClick={() => {
                setModo("lista");
                setImportError("");
                setImportHint("");
                setImportFile(null);
                setImportPreview("");
              }}
            >
              Voltar
            </button>
          </div>

          <div className="field mt">
            <label>Foto do dispositivo</label>
            <input type="file" accept="image/*" onChange={onImportFileChange} />
            <div className="muted small" style={{ marginTop: 6 }}>
              Escolha uma foto da receita (print, papel, livro, etc.). O app vai tentar ler e preencher sozinho.
            </div>
          </div>

          {importError ? (
            <div className="card mt" style={{ border: "1px solid rgba(255,80,80,.35)" }}>
              <b style={{ color: "#ffb4b4" }}>Erro:</b> <span className="muted">{importError}</span>
            </div>
          ) : null}

          {importHint ? <p className="muted small mt">{importHint}</p> : null}

          {importPreview ? (
            <div className="mt">
              <div className="muted small">Prévia:</div>
              <div className="mt" style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,.12)" }}>
                <img src={importPreview} alt="Prévia" style={{ width: "100%", display: "block" }} />
              </div>

              <button type="button" className="primary-btn mt" onClick={lerReceitaDaFoto} disabled={importLoading}>
                {importLoading ? "Lendo..." : "Ler receita da foto e preencher"}
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* MODO COLAR */}
      {modo === "colar" && (
        <div className="card">
          <div className="card-header-row">
            <h3 style={{ margin: 0 }}>Colar receita (texto único)</h3>
            <button type="button" className="chip" style={{ width: "auto" }} onClick={() => (setModo("lista"), setQuickText(""))}>
              Voltar
            </button>
          </div>

          <div className="muted small mt">
            Cole a receita completa. Se tiver cabeçalhos, melhor ainda (Ingredientes, Modo de preparo, etc.).
          </div>

          <div className="field mt">
            <label>Texto da receita</label>
            <textarea
              className="receita-textarea"
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              placeholder={`Título: Bolo de cenoura
Categoria: Doces
Tempo: 50 min
Rendimento: 12 fatias
Dificuldade: Fácil
Tags: bolo, forno, chocolate

Ingredientes:
- 3 cenouras
- 3 ovos

Modo de preparo:
1) Bata no liquidificador...
2) ...`}
            />
          </div>

          <button
            type="button"
            className="primary-btn"
            onClick={() => saveParsedRecipeDirect(parseQuickRecipe(quickText))}
            disabled={!quickText.trim()}
          >
            ✅ Organizar e salvar
          </button>

          <button
            type="button"
            className="primary-btn mt"
            onClick={() => {
              const parsed = parseQuickRecipe(quickText);
              resetForm();
              applyParsedToForm(parsed);
              setCategoria((c) => c || "Doces");
              setDificuldade((d) => d || "Fácil");
              setModo("form");
            }}
            disabled={!quickText.trim()}
          >
            Organizar e abrir no formulário
          </button>

          <button type="button" className="chip mt" style={{ width: "100%" }} onClick={() => setQuickText("")} disabled={!quickText.trim()}>
            Limpar
          </button>
        </div>
      )}

      {/* MODO FORM */}
      {modo === "form" && (
        <div className="card">
          <div className="card-header-row">
            <h3 style={{ margin: 0 }}>{editId ? "Editar receita" : "Nova receita"}</h3>
            <button type="button" className="chip" style={{ width: "auto" }} onClick={() => (setModo("lista"), resetForm())}>
              Voltar
            </button>
          </div>

          <div className="field mt">
            <label>Título *</label>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex: Brigadeiro tradicional" />
          </div>

          <div className="filters-grid">
            <div className="field">
              <label>Categoria</label>
              <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Dificuldade</label>
              <select value={dificuldade} onChange={(e) => setDificuldade(e.target.value)}>
                <option>Fácil</option>
                <option>Médio</option>
                <option>Difícil</option>
              </select>
            </div>
          </div>

          <div className="filters-grid">
            <div className="field">
              <label>Tempo</label>
              <input value={tempo} onChange={(e) => setTempo(e.target.value)} placeholder="Ex: 40 min" />
            </div>
            <div className="field">
              <label>Rendimento</label>
              <input value={rendimento} onChange={(e) => setRendimento(e.target.value)} placeholder="Ex: 25 unidades" />
            </div>
          </div>

          <div className="field">
            <label>Tags (separe por vírgula)</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Ex: festa, sem forno, rápido" />
          </div>

          <div className="field">
            <label>Foto (opcional) — fica só no aparelho</label>
            <input type="file" accept="image/*" onChange={onFotoChange} />

            {foto ? (
              <div className="receita-foto-preview mt">
                <img src={foto} alt="Receita" />
                <button type="button" className="chip" style={{ width: "auto" }} onClick={() => setFoto("")}>
                  Remover foto
                </button>
              </div>
            ) : null}
          </div>

          <div className="field">
            <label>Ingredientes *</label>
            <textarea className="receita-textarea" value={ingredientes} onChange={(e) => setIngredientes(e.target.value)} />
          </div>

          <div className="field">
            <label>Modo de preparo *</label>
            <textarea className="receita-textarea" value={preparo} onChange={(e) => setPreparo(e.target.value)} />
          </div>

          <div className="field">
            <label>Observações / Dicas</label>
            <textarea className="receita-textarea" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </div>

          <div className="field">
            <label>Armazenamento / Validade</label>
            <textarea className="receita-textarea" value={armazenamento} onChange={(e) => setArmazenamento(e.target.value)} />
          </div>

          <button type="button" className="primary-btn" onClick={submit}>
            {editId ? "Salvar alterações" : "Salvar receita"}
          </button>
        </div>
      )}

      {/* MODO VER */}
      {modo === "ver" && current && (
        <div className={"recipe-book " + (pageFlipDir === "next" ? "flip-next" : "flip-prev")}>
          <div className="recipe-book-top">
            <button type="button" className="chip" style={{ width: "auto" }} onClick={() => setModo("lista")}>
              ← Voltar
            </button>

            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="chip" style={{ width: "auto" }} onClick={() => toggleFavorita(current.id)}>
                {current.favorita ? "⭐ Favorita" : "☆ Favoritar"}
              </button>
              <button type="button" className="chip" style={{ width: "auto" }} onClick={() => openEdit(current)}>
                ✏️ Editar
              </button>
              <button type="button" className="chip" style={{ width: "auto" }} onClick={() => removeReceita(current.id)}>
                🗑️ Apagar
              </button>
            </div>
          </div>

          {current.foto ? (
            <div className="card" style={{ padding: 10, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,.12)" }}>
              <img src={current.foto} alt="Foto da receita" style={{ width: "100%", display: "block", borderRadius: 12, objectFit: "cover" }} />

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button type="button" className={"chip " + (viewMode === "foto" ? "chip-active" : "")} style={{ width: "auto" }} onClick={() => setViewMode("foto")}>
                  🖼 Só foto
                </button>
                <button type="button" className={"chip " + (viewMode === "texto" ? "chip-active" : "")} style={{ width: "auto" }} onClick={() => setViewMode("texto")}>
                  📄 Ver texto
                </button>
              </div>
            </div>
          ) : null}

          {(viewMode === "texto" || !current.foto) ? (
            <div className={"paper card " + (document.documentElement.classList.contains("page-flip-active") ? "paper-flip" : "")}>
              <div className="paper-header">
                <div>
                  <div className="paper-title">{current.titulo}</div>
                  <div className="paper-meta">
                    <span className="badge">{current.categoria}</span>
                    <span className="badge">{current.dificuldade}</span>
                    {current.tempo ? <span className="badge">⏱ {current.tempo}</span> : null}
                    {current.rendimento ? <span className="badge">🍽 {current.rendimento}</span> : null}
                  </div>
                </div>
              </div>

              {current.tags?.length ? (
                <div className="paper-tags">
                  {current.tags.map((t) => (
                    <span key={t} className="tag-pill">#{t}</span>
                  ))}
                </div>
              ) : null}

              <div className="paper-grid">
                <section>
                  <h4>Ingredientes</h4>
                  <pre className="paper-pre">{current.ingredientes}</pre>
                </section>

                <section>
                  <h4>Modo de preparo</h4>
                  <pre className="paper-pre">{current.preparo}</pre>
                </section>
              </div>

              {(current.observacoes || current.armazenamento) && (
                <div className="paper-extra">
                  {current.observacoes ? (
                    <div>
                      <h4>Dicas / Observações</h4>
                      <pre className="paper-pre">{current.observacoes}</pre>
                    </div>
                  ) : null}

                  {current.armazenamento ? (
                    <div className="mt">
                      <h4>Armazenamento / Validade</h4>
                      <pre className="paper-pre">{current.armazenamento}</pre>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="paper-footer">
                <span className="muted small">Atualizada em: {fmtBRDateTime(current.updatedAt || current.createdAt)}</span>
              </div>
            </div>
          ) : null}

          <div className="recipe-nav mt">
            <button type="button" className="primary-btn" onClick={goPrev} disabled={currentIndex <= 0}>
              ◀ Receita anterior
            </button>
            <button type="button" className="primary-btn" onClick={goNext} disabled={currentIndex < 0 || currentIndex >= filtered.length - 1}>
              Próxima receita ▶
            </button>
          </div>
        </div>
      )}

      {/* MODAL */}
      {modal.open && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (modal.onCancel) modal.onCancel();
            else if (modal.onConfirm) modal.onConfirm();
            else setModal((m) => ({ ...m, open: false }));
          }}
          role="presentation"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={modal.title || "Modal"}>
            <h3 style={{ marginTop: 0 }}>{modal.title}</h3>

            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              {modal.message}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              {modal.cancelText ? (
                <button
                  type="button"
                  className="chip"
                  style={{ width: "auto" }}
                  onClick={() => (modal.onCancel ? modal.onCancel() : setModal((m) => ({ ...m, open: false })))}
                >
                  {modal.cancelText}
                </button>
              ) : null}

              <button
                type="button"
                className="primary-btn"
                style={{ width: "auto", padding: "8px 12px" }}
                onClick={() => (modal.onConfirm ? modal.onConfirm() : setModal((m) => ({ ...m, open: false })))}
              >
                {modal.confirmText || "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* helpers */
function fmtBRDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}
