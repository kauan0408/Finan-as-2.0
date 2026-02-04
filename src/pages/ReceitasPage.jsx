// src/pages/ReceitasPage.jsx

// Importa React e hooks:
// - useEffect: efeitos (carregar do localStorage, fechar modal no ESC, etc.)
// - useMemo: memoriza cálculos (lista filtrada, receita atual, índice)
// - useRef: referência persistente (timer do “page flip”)
// - useState: estados da UI e do formulário
import React, { useEffect, useMemo, useRef, useState } from "react";

// Chave do localStorage onde as receitas serão salvas
const LS_KEY = "pwa_receitas_v1";

// Faz parse de JSON com segurança: se der erro, devolve um fallback
function safeJSONParse(v, fallback) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

// Gera um id único:
// - usa crypto.randomUUID se existir
// - senão usa random + timestamp
function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

// Retorna o horário atual em ISO string (para createdAt/updatedAt)
function nowISO() {
  return new Date().toISOString();
}

// Normaliza texto para busca:
// - tira espaços extras
// - coloca em minúsculo
// - remove acentos/diacríticos
function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Converte um File (input type="file") para DataURL (base64) para poder:
// - salvar no localStorage
// - mostrar preview com <img src="...">
async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Categorias disponíveis para selecionar no app
const CATEGORIAS = ["Doces", "Salgados", "Massas", "Bebidas", "Festa", "Fit", "Pães", "Molhos", "Outros"];

/* ---------------- OCR (opcional) ----------------
   - Se tesseract.js estiver instalado, lê o texto da foto e tenta preencher.
   - Se não estiver, não quebra: só abre o form com a foto.
*/
// Faz OCR na imagem usando tesseract.js (se existir no projeto).
// Se não existir, lança erro (para cair no fallback).
async function ocrImageToText(file) {
  try {
    const mod = await import("tesseract.js");
    const Tesseract = mod?.default || mod;
    const { data } = await Tesseract.recognize(file, "por");
    return String(data?.text || "");
  } catch (e) {
    throw new Error("OCR indisponível (instale tesseract.js).");
  }
}

/* tenta achar título/ingredientes/preparo no texto reconhecido */
// Extrai campos “título”, “ingredientes” e “preparo” do texto reconhecido.
// É uma heurística simples: procura palavras-chave e separa as partes.
function parseRecipeFromText(text) {
  const raw = String(text || "").replace(/\r/g, "");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // título: primeira linha "boa"
  const titulo = (lines[0] || "").slice(0, 80);

  const lower = raw.toLowerCase();

  // acha marcadores comuns
  const idxIng = lower.indexOf("ingredientes") >= 0 ? lower.indexOf("ingredientes") : -1;
  const idxPrep =
    lower.indexOf("modo de preparo") >= 0
      ? lower.indexOf("modo de preparo")
      : lower.indexOf("preparo") >= 0
      ? lower.indexOf("preparo")
      : -1;

  let ingredientes = "";
  let preparo = "";

  // Se achou “ingredientes” e depois “preparo”, separa usando esses pontos
  if (idxIng >= 0 && idxPrep > idxIng) {
    ingredientes = raw.slice(idxIng, idxPrep);
    preparo = raw.slice(idxPrep);
  } else if (idxPrep >= 0) {
    // se só achou preparo, separa por heurística:
    // tudo antes = ingredientes (provável), depois = preparo
    const before = raw.slice(0, idxPrep);
    const after = raw.slice(idxPrep);
    ingredientes = before;
    preparo = after;
  } else {
    // fallback: tenta dividir metade/metade (quando não encontrou marcadores)
    const mid = Math.floor(raw.length / 2);
    ingredientes = raw.slice(0, mid);
    preparo = raw.slice(mid);
  }

  // limpa cabeçalhos comuns do começo (se existirem)
  ingredientes = ingredientes.replace(/^\s*ingredientes\s*[:\-]?\s*/i, "").trim();
  preparo = preparo.replace(/^\s*(modo\s+de\s+preparo|preparo)\s*[:\-]?\s*/i, "").trim();

  return {
    titulo: titulo || "",
    ingredientes: ingredientes || "",
    preparo: preparo || "",
  };
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

/**
 * Parser “Entrada rápida”:
 * - entende cabeçalhos comuns: Título, Categoria, Tempo, Rendimento, Dificuldade, Tags,
 *   Ingredientes, Modo de preparo/Preparo, Observações/Dicas, Armazenamento/Validade.
 * - se não tiver cabeçalho, tenta heurística:
 *   * linhas com "-" ou "•" viram ingredientes
 *   * linhas com "1)" / "1." viram preparo
 */
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

  // 1) tenta capturar metadados em linhas tipo "Campo: valor"
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

  // 2) separa blocos por cabeçalhos (ingredientes / preparo / observações / armazenamento)
  const lower = raw.toLowerCase();

  const idxIng = lower.search(/\bingredientes\b/);
  const idxPrep = lower.search(/\b(modo\s+de\s+preparo|preparo)\b/);
  const idxObs = lower.search(/\b(observa(ç|c)ões|dicas)\b/);
  const idxArm = lower.search(/\b(armazenamento|validade)\b/);

  // monta lista de cortes válidos
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
    // remove o cabeçalho da primeira linha do chunk
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

    // título (se não veio em "Título:")
    if (!out.titulo) {
      // pega a primeira linha "boa" antes de ingredientes/preparo
      const head = raw
        .slice(0, cuts[0].idx)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      out.titulo = (head[0] || "").slice(0, 80);
    }
  } else {
    // 3) heurística se não tiver cabeçalhos
    const clean = lines.map((l) => l.trim()).filter(Boolean);

    out.titulo = out.titulo || (clean[0] || "").slice(0, 80);

    const ingLines = [];
    const prepLines = [];
    const otherLines = [];

    for (const l of clean.slice(1)) {
      const t = l.trim();
      if (looksLikeListLine(t) && !/^\d+[\)\.\-]/.test(t)) {
        // "-" ou "•" => ingrediente
        ingLines.push(t);
      } else if (/^\d+[\)\.\-]/.test(t) || /^[a-z]\)/i.test(t)) {
        // "1)" "1." "a)" => preparo
        prepLines.push(t);
      } else {
        otherLines.push(t);
      }
    }

    out.ingredientes = ingLines.join("\n").trim();
    out.preparo = prepLines.join("\n").trim();

    // se sobrou texto, joga em observações
    if (otherLines.length) out.observacoes = otherLines.join("\n").trim();
  }

  // limpeza final
  out.titulo = cleanHeading(out.titulo);
  out.ingredientes = String(out.ingredientes || "").trim();
  out.preparo = String(out.preparo || "").trim();

  return out;
}

// Componente principal da página de Receitas
export default function ReceitasPage() {
  // Lista de receitas armazenadas
  const [items, setItems] = useState([]);

  // Controla a tela atual:
  // - "lista": listagem com filtros
  // - "form": criar/editar receita
  // - "ver": visualizar receita como “livro”
  // - "importar": importar por foto do dispositivo
  // - "colar": colar texto único e organizar
  const [modo, setModo] = useState("lista");

  // filtro
  const [q, setQ] = useState(""); // Texto de pesquisa
  const [cat, setCat] = useState("Todas"); // Categoria do filtro
  const [somenteFavoritas, setSomenteFavoritas] = useState(false); // Mostra apenas favoritas

  // form
  const [editId, setEditId] = useState(null); // id em edição (se null, é nova)
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
  const [foto, setFoto] = useState(""); // Foto como DataURL

  // ✅ colar/entrada rápida (texto único)
  const [quickText, setQuickText] = useState("");

  // importar por imagem
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importHint, setImportHint] = useState("");

  // ver receita
  const [currentId, setCurrentId] = useState(null);
  const [pageFlipDir, setPageFlipDir] = useState("next"); // next | prev
  const flipTimer = useRef(null);

  // visual simples
  const [viewMode, setViewMode] = useState("foto"); // foto | texto

  // ---------------- MODAL BONITO ----------------
  const [modal, setModal] = useState({
    open: false,
    title: "",
    message: "",
    variant: "info", // info | danger
    confirmText: "OK",
    cancelText: "",
    onConfirm: null,
    onCancel: null,
  });

  // Abre modal simples (equivalente ao alert)
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

  // Abre modal de confirmação (equivalente ao confirm)
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

  // ✅ Fecha o modal ao apertar ESC
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

  // Carrega receitas do localStorage ao montar
  useEffect(() => {
    const saved = safeJSONParse(localStorage.getItem(LS_KEY), []);
    setItems(Array.isArray(saved) ? saved : []);
  }, []);

  // Salva lista no estado e no localStorage
  function save(next) {
    setItems(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  }

  // Lista filtrada e ordenada
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

  // Receita atual aberta no modo "ver"
  const current = useMemo(() => {
    return (items || []).find((r) => r.id === currentId) || null;
  }, [items, currentId]);

  // Índice da receita atual dentro da lista filtrada
  const currentIndex = useMemo(() => {
    if (!currentId) return -1;
    return filtered.findIndex((r) => r.id === currentId);
  }, [filtered, currentId]);

  // Reseta campos do formulário
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

    // não reseta tudo à força: só preenche o que tiver
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
    setFoto(dataUrl);
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
      foto,
      updatedAt: nowISO(),
    };

    if (editId) {
      const next = (items || []).map((r) => (r.id === editId ? { ...r, ...base } : r));
      save(next);
    } else {
      const next = [
        {
          id: uuid(),
          createdAt: nowISO(),
          favorita: false,
          ...base,
        },
        ...(items || []),
      ];
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

  // Render principal
  return (
    <div className="page receitas">
      <h2 className="page-title">🍳 Receitas</h2>

      {/* MODO LISTA */}
      {modo === "lista" && (
        <>
          <div className="card">
            <div className="field">
              <label>Pesquisar</label>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex: brigadeiro, leite ninho, farinha, forno..." />
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

              <button type="button" className="primary-btn" onClick={openColar} style={{ flex: 1 }} title="Colar texto de uma receita e organizar">
                ✍️ Colar
              </button>

              <button type="button" className="primary-btn" onClick={openImport} style={{ flex: 1 }} title="Importar por foto do dispositivo">
                🖼 Importar
              </button>
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

      {/* MODO COLAR (entrada única) */}
      {modo === "colar" && (
        <div className="card">
          <div className="card-header-row">
            <h3 style={{ margin: 0 }}>Colar receita (texto único)</h3>
            <button
              type="button"
              className="chip"
              style={{ width: "auto" }}
              onClick={() => {
                setModo("lista");
                setQuickText("");
              }}
            >
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
- ...

Modo de preparo:
1) Bata no liquidificador...
2) ...`}
            />
          </div>

          <button
            type="button"
            className="primary-btn"
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
                  <option key={c} value={c}>
                    {c}
                  </option>
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
            <label>Foto (opcional)</label>
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
            <textarea
              className="receita-textarea"
              value={ingredientes}
              onChange={(e) => setIngredientes(e.target.value)}
              placeholder={"Ex:\n- 1 lata de leite condensado\n- 1 colher (sopa) de manteiga\n- 4 colheres (sopa) de chocolate"}
            />
          </div>

          <div className="field">
            <label>Modo de preparo *</label>
            <textarea
              className="receita-textarea"
              value={preparo}
              onChange={(e) => setPreparo(e.target.value)}
              placeholder={"Ex:\n1) Misture tudo na panela\n2) Mexa até desgrutar\n3) Enrole e passe no granulado"}
            />
          </div>

          <div className="field">
            <label>Observações / Dicas</label>
            <textarea
              className="receita-textarea"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Ex: ponto do brigadeiro, fogo baixo, tempo..."
            />
          </div>

          <div className="field">
            <label>Armazenamento / Validade</label>
            <textarea
              className="receita-textarea"
              value={armazenamento}
              onChange={(e) => setArmazenamento(e.target.value)}
              placeholder="Ex: 3 dias fora, 7 dias geladeira, 30 dias freezer..."
            />
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
              <img
                src={current.foto}
                alt="Foto da receita"
                style={{ width: "100%", display: "block", borderRadius: 12, objectFit: "cover" }}
              />

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  className={"chip " + (viewMode === "foto" ? "chip-active" : "")}
                  style={{ width: "auto" }}
                  onClick={() => setViewMode("foto")}
                >
                  🖼 Só foto
                </button>
                <button
                  type="button"
                  className={"chip " + (viewMode === "texto" ? "chip-active" : "")}
                  style={{ width: "auto" }}
                  onClick={() => setViewMode("texto")}
                >
                  📄 Ver texto
                </button>
              </div>
            </div>
          ) : null}

          {viewMode === "texto" || !current.foto ? (
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
                    <span key={t} className="tag-pill">
                      #{t}
                    </span>
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
            <button
              type="button"
              className="primary-btn"
              onClick={goNext}
              disabled={currentIndex < 0 || currentIndex >= filtered.length - 1}
            >
              Próxima receita ▶
            </button>
          </div>
        </div>
      )}

      {/* ---------------- MODAL ÚNICO DO APP ---------------- */}
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
// Formata ISO como "dd/mm/aaaa hh:mm"
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
