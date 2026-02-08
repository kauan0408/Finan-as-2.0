// src/pages/TransacoesPage.jsx
// Página de lançamento de transações (manual + por voz com revisão)
// ✅ Ajustado para funcionar melhor no ANDROID + APP INSTALADO (PWA):
// - Pede permissão real do microfone (getUserMedia) antes de iniciar
// - NÃO recria o SpeechRecognition (useEffect roda só 1x)
// - Usa continuous=false (mais estável no mobile) + auto-restart controlado
// - Timer de silêncio 3s continua funcionando
// ✅ Corrigido: se detectar nome do cartão no texto, ASSUME crédito e seleciona o cartão
// ✅ Corrigido (DATA/HORA): puxa SEMPRE data e hora atuais do aparelho (local) e salva com data+hora corretas

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFinance } from "../App.jsx";

// ✅ Data local (YYYY-MM-DD) sem UTC
function toInputDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ✅ Hora local (HH:MM)
function toInputTimeLocal(d) {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/* =========================================================
   ✅ (NOVO) data padrão respeitando mesReferencia (setinha)
   - Se você estiver em Fevereiro/2026, o lançamento cai em Fevereiro/2026
   - Mantém o "dia de hoje" dentro do mês escolhido (limitando ao último dia do mês)
   ========================================================= */
function toInputDateInMesReferencia(mesReferencia, base = new Date()) {
  const ano = Number(mesReferencia?.ano ?? base.getFullYear());
  const mes0 = Number(mesReferencia?.mes ?? base.getMonth());

  const lastDay = new Date(ano, mes0 + 1, 0).getDate();
  const dia = Math.min(base.getDate(), lastDay);

  const d = new Date(
    ano,
    mes0,
    dia,
    base.getHours(),
    base.getMinutes(),
    base.getSeconds(),
    base.getMilliseconds()
  );

  return toInputDateLocal(d);
}

export default function TransacoesPage() {
  const { adicionarTransacao, cartoes, mesReferencia, transacoes } = useFinance();

  // Form
  const [tipo, setTipo] = useState("despesa");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("Essencial");
  const [formaPagamento, setFormaPagamento] = useState("dinheiro");
  const [cartaoId, setCartaoId] = useState("");
  const [fixo, setFixo] = useState(false);
  const [mensagem, setMensagem] = useState("");

  const [parcelado, setParcelado] = useState(false);
  const [numeroParcelas, setNumeroParcelas] = useState(2);

  // ✅ DATA/HORA AUTOMÁTICAS (do aparelho) — NÃO depende de mesReferencia
  const [dataTransacao, setDataTransacao] = useState(() => toInputDateLocal(new Date()));
  const [horaTransacao, setHoraTransacao] = useState(() => toInputTimeLocal(new Date()));

  // ✅ se a pessoa mexer manualmente, não sobrescreve
  const [dataFoiEditada, setDataFoiEditada] = useState(false);
  const [horaFoiEditada, setHoraFoiEditada] = useState(false);

  // ✅ sempre que entrar na página (mount), garante hoje/agora
  useEffect(() => {
    const now = new Date();
    setDataTransacao(toInputDateLocal(now));
    setHoraTransacao(toInputTimeLocal(now));
    // não marca como editada, porque é automático
  }, []);

  // ✅ se mudar mesReferencia (ex.: você mudou mês lá nas Finanças),
  // a data/hora continuam sendo HOJE/AGORA (a não ser que você tenha editado manualmente)
  useEffect(() => {
    const now = new Date();
    if (!dataFoiEditada) setDataTransacao(toInputDateLocal(now));
    if (!horaFoiEditada) setHoraTransacao(toInputTimeLocal(now));
  }, [mesReferencia, dataFoiEditada, horaFoiEditada]);

  /* =========================================================
     ✅ (NOVO) REGRA FINAL: se NÃO foi editada, a DATA do lançamento
     deve cair no mês da setinha (mesReferencia).
     - Isso sobrescreve a data "HOJE" acima, mas só quando pode.
     ========================================================= */
  useEffect(() => {
    if (dataFoiEditada) return;
    const now = new Date();
    const d = toInputDateInMesReferencia(mesReferencia, now);
    setDataTransacao(d);
  }, [mesReferencia, dataFoiEditada]);

  const isDespesa = tipo === "despesa";

  // Crédito: limite
  const [mostrarConfirmCredito, setMostrarConfirmCredito] = useState(false);
  const [pendenteCredito, setPendenteCredito] = useState(null);

  // Revisão por voz
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewText, setReviewText] = useState("");

  // Voz
  const [gravando, setGravando] = useState(false);
  const [processandoAudio, setProcessandoAudio] = useState(false);
  const recognitionRef = useRef(null);
  const [suportaVoz, setSuportaVoz] = useState(true);

  const speechBufferRef = useRef("");
  const lastFinalRef = useRef("");
  const silenceTimerRef = useRef(null);
  const SILENCE_MS = 3000;

  // Controle para restart no mobile
  const wantListeningRef = useRef(false);
  const manualStopRef = useRef(false);

  function mostrarMensagem(texto) {
    setMensagem(texto);
    setTimeout(() => setMensagem(""), 2600);
  }

  async function garantirPermissaoMicrofone() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  // =========================
  // ✅ Salvar transação (com parcelamento)
  // =========================
  const processarTransacao = (dados) => {
    const {
      tipoForm,
      valorForm,
      descricaoForm,
      categoriaForm,
      formaForm,
      cartaoIdForm,
      parceladoForm,
      numeroParcelasForm,
      dataBaseISO,
    } = dados;

    const v = parseFloat(String(valorForm).replace(",", "."));
    if (isNaN(v) || v <= 0) {
      mostrarMensagem("Informe um valor válido.");
      return;
    }

    const baseDate = dataBaseISO ? new Date(dataBaseISO) : new Date();

    const isDespesaLocal = tipoForm === "despesa";
    const ehDespesaCreditoLocal =
      isDespesaLocal && formaForm === "credito" && cartaoIdForm;

    const listaParaSalvar = [];

    if (ehDespesaCreditoLocal && parceladoForm && Number(numeroParcelasForm) > 1) {
      const n = clamp(parseInt(numeroParcelasForm, 10) || 2, 2, 36);
      const valorParcela = v / n;

      const groupId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Date.now().toString(36) + Math.random().toString(36).slice(2);

      for (let i = 1; i <= n; i++) {
        const dataParcela = new Date(baseDate);
        dataParcela.setMonth(dataParcela.getMonth() + (i - 1));

        listaParaSalvar.push({
          tipo: "despesa",
          valor: Number(valorParcela.toFixed(2)),
          descricao: descricaoForm?.trim()
            ? `${descricaoForm} (parc. ${i}/${n})`
            : `Parcela ${i}/${n}`,
          categoria: categoriaForm,
          formaPagamento: "credito",
          cartaoId: cartaoIdForm,
          fixo: false,
          dataHora: dataParcela.toISOString(), // mantém ISO para consistência no banco
          parcelaAtual: i,
          parcelaTotal: n,
          groupId,
          totalCompra: v,
        });
      }

      mostrarMensagem(`Compra parcelada em ${n}x lançada.`);
    } else {
      listaParaSalvar.push({
        tipo: tipoForm,
        valor: v,
        descricao: descricaoForm,
        categoria: isDespesaLocal ? categoriaForm : null,
        formaPagamento: formaForm,
        cartaoId: formaForm === "credito" ? cartaoIdForm || null : null,
        fixo: false,
        dataHora: baseDate.toISOString(),
        parcelaAtual: null,
        parcelaTotal: null,
        groupId: null,
        totalCompra: v,
      });

      mostrarMensagem("Transação salva!");
    }

    listaParaSalvar.forEach((t) => adicionarTransacao(t));

    setValor("");
    setDescricao("");
    setCategoria("Essencial");
    setFormaPagamento("dinheiro");
    setCartaoId("");
    setFixo(false);
    setTipo("despesa");
    setParcelado(false);
    setNumeroParcelas(2);

    setReviewText("");
    setReviewOpen(false);

    // ✅ depois de salvar: volta pra HOJE + AGORA automaticamente
    const now = new Date();
    setDataFoiEditada(false);
    setHoraFoiEditada(false);
    setDataTransacao(toInputDateLocal(now));
    setHoraTransacao(toInputTimeLocal(now));
  };

  // ✅ monta uma ISO usando DATA + HORA escolhidas (no horário local)
  const montarBaseDateISO = (yyyyMmDd, hhmm) => {
    const agora = new Date();

    const [y, m, d] = String(yyyyMmDd || toInputDateLocal(agora))
      .split("-")
      .map(Number);

    const [hh, mm] = String(hhmm || toInputTimeLocal(agora))
      .split(":")
      .map(Number);

    const dt = new Date(
      y,
      (m || 1) - 1,
      d || 1,
      Number.isFinite(hh) ? hh : agora.getHours(),
      Number.isFinite(mm) ? mm : agora.getMinutes(),
      agora.getSeconds(),
      agora.getMilliseconds()
    );

    return dt.toISOString();
  };

  const confirmarSalvarAtual = () => {
    const v = parseFloat(String(valor).replace(",", "."));
    if (isNaN(v) || v <= 0) {
      mostrarMensagem("Informe um valor válido.");
      return;
    }

    // ✅ usa data + hora do formulário
    const baseISO = montarBaseDateISO(dataTransacao, horaTransacao);

    const ehDespesaCredito =
      tipo === "despesa" && formaPagamento === "credito" && cartaoId;

    if (ehDespesaCredito) {
      const cartao = cartoes.find((c) => c.id === cartaoId);
      const limite = cartao?.limite || 0;

      if (limite > 0) {
        let totalCompras = 0;
        let totalPagamentos = 0;

        transacoes.forEach((t) => {
          if (t.cartaoId === cartaoId) {
            if (t.tipo === "despesa" && t.formaPagamento === "credito") {
              totalCompras += Number(t.valor || 0);
            }
            if (t.tipo === "pagamentoCartao") {
              totalPagamentos += Number(t.valor || 0);
            }
          }
        });

        const gastoAtual = Math.max(0, totalCompras - totalPagamentos);
        const restante = limite - gastoAtual;

        if (v > restante + 0.01) {
          const excedente = v - Math.max(restante, 0);

          setPendenteCredito({
            dados: {
              tipoForm: tipo,
              valorForm: valor,
              descricaoForm: descricao,
              categoriaForm: categoria,
              formaForm: formaPagamento,
              cartaoIdForm: cartaoId,
              parceladoForm: parcelado,
              numeroParcelasForm: numeroParcelas,
              dataBaseISO: baseISO,
            },
            excedente,
            limite,
            gastoAtual,
            cartaoNome: cartao?.nome || "Cartão",
          });

          setMostrarConfirmCredito(true);
          return;
        }
      }
    }

    processarTransacao({
      tipoForm: tipo,
      valorForm: valor,
      descricaoForm: descricao,
      categoriaForm: categoria,
      formaForm: formaPagamento,
      cartaoIdForm: cartaoId,
      parceladoForm: parcelado,
      numeroParcelasForm: numeroParcelas,
      dataBaseISO: baseISO,
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    confirmarSalvarAtual();
  };

  const onChangeTipo = (novoTipo) => {
    setTipo(novoTipo);
    if (novoTipo === "receita") {
      setFixo(false);
      setParcelado(false);
    }
  };

  const onChangeForma = (e) => {
    const v = e.target.value;
    setFormaPagamento(v);
    if (v !== "credito") {
      setCartaoId("");
      setParcelado(false);
    }
  };

  const confirmarCompraEstourandoLimite = () => {
    if (!pendenteCredito) return;
    processarTransacao(pendenteCredito.dados);
    setPendenteCredito(null);
    setMostrarConfirmCredito(false);
  };

  const cancelarCompraCredito = () => {
    setPendenteCredito(null);
    setMostrarConfirmCredito(false);
  };

  // =========================
  // ✅ Inteligência
  // =========================
  const cartoesNorm = useMemo(() => {
    return (cartoes || []).map((c) => ({
      ...c,
      _normNome: normalizeText(c.nome),
      _normWords: normalizeText(c.nome)
        .split(/\s+/)
        .map((p) => p.trim())
        .filter(Boolean),
    }));
  }, [cartoes]);

  const extrairDataYYYYMMDD = (tNorm) => {
    const hoje = new Date();
    let dt = new Date(hoje);

    if (tNorm.includes("hoje")) {
    } else if (tNorm.includes("ontem")) {
      dt.setDate(dt.getDate() - 1);
    } else if (tNorm.includes("amanha") || tNorm.includes("amanhã")) {
      dt.setDate(dt.getDate() + 1);
    } else {
      const mDia = tNorm.match(/\bdia\s+(\d{1,2})\b/);
      if (mDia && mDia[1]) {
        const dia = clamp(parseInt(mDia[1], 10) || hoje.getDate(), 1, 31);

        // aqui sim pode usar mesReferencia para “dia 15” dentro do mês selecionado,
        // mas se mesReferencia vier errado, ainda assim a DATA padrão do form é HOJE.
        const ano = mesReferencia?.ano ?? hoje.getFullYear();
        const mes = (mesReferencia?.mes ?? hoje.getMonth()) + 1;

        const y = ano;
        const mm = String(mes).padStart(2, "0");
        const dd = String(dia).padStart(2, "0");
        return `${y}-${mm}-${dd}`;
      }
      return null;
    }

    return toInputDateLocal(dt);
  };

  const extrairDadosDoTexto = (texto) => {
    const tOriginal = String(texto || "").trim();
    const tNorm = normalizeText(tOriginal);

    // 1) Tipo
    let tipoAuto = "despesa";
    if (
      tNorm.includes("receita") ||
      tNorm.includes("ganho") ||
      tNorm.includes("salario") ||
      tNorm.includes("salário") ||
      tNorm.includes("entrada")
    ) {
      tipoAuto = "receita";
    }

    // 2) Valor
    let valorAuto = "";
    let m = tNorm.match(/r\$\s*(\d+(?:[.,]\d{1,2})?)/i);
    if (!m) m = tNorm.match(/(\d+(?:[.,]\d{1,2})?)\s*(reais?|real)\b/i);

    if (!m) {
      const allNums = tNorm.match(/\b\d+(?:[.,]\d{1,2})?\b/g);
      if (allNums?.length) {
        const candidates = allNums
          .map((x) => String(x).replace(",", "."))
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n) && n > 0);

        if (candidates.length) {
          const sorted = [...candidates].sort((a, b) => b - a);
          const max = sorted[0];

          const pareceParcelas =
            (tNorm.includes("x") || tNorm.includes("vez") || tNorm.includes("parcela")) &&
            max <= 36 &&
            sorted.length > 1;

          const escolhido = pareceParcelas ? sorted[1] : max;
          if (Number.isFinite(escolhido) && escolhido > 0) valorAuto = String(escolhido);
        }
      }
    } else if (m?.[1]) {
      valorAuto = String(m[1]).replace(",", ".");
    }

    // 3) Forma
    let formaAuto = "dinheiro";
    if (tNorm.includes("pix") || tNorm.includes("pics")) formaAuto = "pix";
    else if (tNorm.includes("debito") || tNorm.includes("débito")) formaAuto = "debito";
    else if (tNorm.includes("credito") || tNorm.includes("crédito")) formaAuto = "credito";
    else if (tNorm.includes("dinheiro")) formaAuto = "dinheiro";
    else if (tNorm.includes("cartao") || tNorm.includes("cartão")) formaAuto = "credito";

    // 4) Categoria simples
    let categoriaAuto = "Essencial";
    if (tNorm.includes("lazer")) categoriaAuto = "Lazer";
    if (tNorm.includes("essencial")) categoriaAuto = "Essencial";
    if (tNorm.includes("burrice")) categoriaAuto = "Burrice";
    if (tNorm.includes("investido") || tNorm.includes("investimento") || tNorm.includes("investir"))
      categoriaAuto = "Investido";

    // 5) Parcelas
    let parceladoAuto = false;
    let numeroParcelasAuto = 2;

    let mParc =
      tNorm.match(/\b(\d{1,2})\s*x\b/i) ||
      tNorm.match(/\b(\d{1,2})\s*(vez|vezes|parcela|parcelas)\b/i);

    if (mParc?.[1]) {
      const n = clamp(parseInt(mParc[1], 10) || 2, 2, 36);
      parceladoAuto = true;
      numeroParcelasAuto = n;
    } else if (tNorm.includes("parcelado")) {
      parceladoAuto = true;
      numeroParcelasAuto = 2;
    }

    // 6) Cartão
    let cartaoIdAuto = "";
    if (cartoesNorm.length) {
      const hit =
        cartoesNorm.find((c) => c._normNome && tNorm.includes(c._normNome)) ||
        cartoesNorm.find((c) =>
          (c._normWords || []).some((w) => w.length >= 3 && tNorm.includes(w))
        );

      if (hit) cartaoIdAuto = hit.id;
    }

    if (cartaoIdAuto) {
      formaAuto = "credito";
    }

    // 7) Data
    const dataAuto = extrairDataYYYYMMDD(tNorm);

    // 8) Stopwords
    const stopCartoes = new Set();
    (cartoesNorm || []).forEach((c) => {
      (c._normWords || []).forEach((w) => stopCartoes.add(w));
    });

    const stop = new Set([
      "despesa",
      "receita",
      "entrada",
      "ganho",
      "de",
      "por",
      "no",
      "na",
      "em",
      "r$",
      "real",
      "reais",
      "categoria",
      "essencial",
      "lazer",
      "burrice",
      "investido",
      "pix",
      "pics",
      "debito",
      "débito",
      "credito",
      "crédito",
      "dinheiro",
      "cartao",
      "cartão",
      "hoje",
      "ontem",
      "amanha",
      "amanhã",
      "dia",
      "parcelado",
      "parcela",
      "parcelas",
      "vez",
      "vezes",
      "x",
      ...stopCartoes,
    ]);

    const palavras = tNorm
      .replace(/[^\p{L}\p{N}\s$.,]/gu, " ")
      .split(/\s+/)
      .filter(Boolean);

    const desc = palavras
      .map((p) => p.replace(/[.,]/g, ""))
      .filter((p) => {
        if (!p) return false;
        if (stop.has(p)) return false;
        if (/^\d+(?:[.,]\d{1,2})?$/.test(p)) return false;
        return true;
      })
      .join(" ")
      .trim();

    const descricaoAuto = desc || tOriginal;

    return {
      tipoAuto,
      valorAuto,
      descricaoAuto,
      categoriaAuto,
      formaAuto,
      cartaoIdAuto,
      parceladoAuto,
      numeroParcelasAuto,
      dataAuto,
      textoOriginal: tOriginal,
    };
  };

  const aplicarDadosNoFormulario = (dados) => {
    setTipo(dados.tipoAuto);

    if (dados.valorAuto) setValor(String(dados.valorAuto));

    setDescricao(dados.descricaoAuto || "");
    setCategoria(dados.categoriaAuto || "Essencial");

    const formaFinal = dados.parceladoAuto ? "credito" : (dados.formaAuto || "dinheiro");
    setFormaPagamento(formaFinal);

    if (formaFinal === "credito") {
      if (dados.cartaoIdAuto) setCartaoId(dados.cartaoIdAuto);
    } else {
      setCartaoId("");
    }

    if (formaFinal === "credito" && dados.parceladoAuto) {
      setParcelado(true);
      setNumeroParcelas(dados.numeroParcelasAuto || 2);
    } else {
      setParcelado(false);
      setNumeroParcelas(2);
    }

    if (dados.dataAuto) {
      setDataTransacao(dados.dataAuto);
      setDataFoiEditada(true);
    }

    // ✅ mantém a hora atual quando veio por voz (não força)
    setReviewText(dados.textoOriginal || "");
    setReviewOpen(true);
  };

  const finalizarPorSilencio = () => {
    const finalText = String(speechBufferRef.current || "").trim();

    if (!finalText) {
      mostrarMensagem("❌ Não entendi. Tente falar de novo.");
      return;
    }

    const dados = extrairDadosDoTexto(finalText);

    if (!dados.valorAuto || Number(String(dados.valorAuto).replace(",", ".")) <= 0) {
      mostrarMensagem("❌ Não achei o valor. Fale: 'R$ 50 ...' ou '50 reais ...'");
      return;
    }

    aplicarDadosNoFormulario(dados);
    mostrarMensagem("✅ Pronto! Confira e confirme.");
  };

  // =========================
  // ✅ SpeechRecognition (Android/PWA)
  // =========================
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSuportaVoz(false);
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setProcessandoAudio(false);
      setGravando(true);

      speechBufferRef.current = "";
      lastFinalRef.current = "";

      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      mostrarMensagem("🎤 Ouvindo... (paro após 3s de silêncio)");
    };

    rec.onresult = (event) => {
      let interim = "";
      let finalChunk = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const txt = r[0]?.transcript || "";
        if (r.isFinal) finalChunk += txt + " ";
        else interim += txt + " ";
      }

      if (finalChunk.trim()) {
        lastFinalRef.current += finalChunk;
      }

      speechBufferRef.current = (lastFinalRef.current + " " + interim).trim();

      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        manualStopRef.current = false;
        wantListeningRef.current = false;

        try {
          rec.stop();
        } catch {}

        setGravando(false);
        setProcessandoAudio(false);

        finalizarPorSilencio();
      }, SILENCE_MS);
    };

    rec.onerror = (e) => {
      console.error("SpeechRecognition erro:", e);

      setGravando(false);
      setProcessandoAudio(false);

      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      wantListeningRef.current = false;
      manualStopRef.current = true;

      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        mostrarMensagem("❌ Microfone bloqueado. Libere a permissão do navegador/app.");
      } else if (e?.error === "no-speech") {
        mostrarMensagem("❌ Não ouvi nada. Fale mais perto do microfone.");
      } else {
        mostrarMensagem("❌ Erro ao usar voz neste navegador/app.");
      }
    };

    rec.onend = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      if (manualStopRef.current) {
        manualStopRef.current = false;
        setGravando(false);
        setProcessandoAudio(false);
        return;
      }

      if (wantListeningRef.current) {
        setTimeout(() => {
          try {
            rec.start();
          } catch {}
        }, 250);
      } else {
        setGravando(false);
        setProcessandoAudio(false);
      }
    };

    recognitionRef.current = rec;

    return () => {
      try {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        rec.onresult = null;
        rec.onstart = null;
        rec.onerror = null;
        rec.onend = null;
        rec.abort();
      } catch {}
    };
  }, []);

  const iniciarGravacao = async () => {
    if (!suportaVoz || !recognitionRef.current) {
      mostrarMensagem("❌ Seu navegador/app não suporta voz. Use o Chrome.");
      return;
    }

    setProcessandoAudio(true);

    const ok = await garantirPermissaoMicrofone();
    if (!ok) {
      setProcessandoAudio(false);
      mostrarMensagem("❌ Permissão do microfone negada. Ative nas permissões do app.");
      return;
    }

    try {
      speechBufferRef.current = "";
      lastFinalRef.current = "";
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      manualStopRef.current = false;
      wantListeningRef.current = true;

      recognitionRef.current.start();
    } catch (e) {
      console.error(e);
      setProcessandoAudio(false);
      mostrarMensagem("❌ Não consegui iniciar o áudio. Clique de novo.");
    }
  };

  const pararGravacao = () => {
    if (!recognitionRef.current) return;

    try {
      wantListeningRef.current = false;
      manualStopRef.current = true;

      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      recognitionRef.current.stop();
    } catch (e) {
      console.error(e);
    } finally {
      setGravando(false);
      setProcessandoAudio(false);

      if (String(speechBufferRef.current || "").trim()) {
        finalizarPorSilencio();
      }
    }
  };

  const cartaoSelecionadoNome = useMemo(() => {
    const c = cartoes.find((x) => x.id === cartaoId);
    return c?.nome || "";
  }, [cartoes, cartaoId]);

  const agoraLabel = useMemo(() => {
    const now = new Date();
    // mostra “onde você está” = horário local do aparelho (Brasil -03 normalmente)
    return `${now.toLocaleDateString("pt-BR")} ${now.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }, [dataTransacao, horaTransacao]);

  return (
    <div className="page">
      <h2 className="page-title">Transações</h2>

      <div className="card">
        <p className="muted small" style={{ marginTop: 0 }}>
          Agora (horário local do seu aparelho): <strong>{agoraLabel}</strong>
        </p>

        <div style={{ marginBottom: 16, textAlign: "center" }}>
          {!gravando && !processandoAudio && (
            <button
              type="button"
              className="primary-btn"
              onClick={iniciarGravacao}
              style={{
                background: "#10b981",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                margin: "0 auto",
              }}
            >
              🎤 Falar (para após 3s de silêncio)
            </button>
          )}

          {gravando && (
            <button
              type="button"
              className="primary-btn"
              onClick={pararGravacao}
              style={{
                background: "#ef4444",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                margin: "0 auto",
                animation: "pulse 1.5s infinite",
              }}
            >
              ⏹️ Parar agora
            </button>
          )}

          {processandoAudio && (
            <div style={{ color: "#6b7280" }}>⏳ Iniciando microfone...</div>
          )}

          {!suportaVoz && (
            <p className="muted small" style={{ marginTop: 8 }}>
              ❌ Seu navegador/app não suporta voz. Use o Chrome.
            </p>
          )}

          <p className="muted small" style={{ marginTop: 8 }}>
            Exemplos: <br />
            • "Despesa R$ 50 mercado essencial pix hoje" <br />
            • "120 tênis 3x nubank lazer" <br />
            • "Receita 200 bico pix ontem"
          </p>
        </div>

        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            // mantém como está, sem mudar nada do seu fluxo
            confirmarSalvarAtual();
          }}
        >
          <div className="field">
            <label>Tipo</label>
            <div className="toggle-group">
              <button
                type="button"
                className={"toggle-btn " + (tipo === "despesa" ? "toggle-active" : "")}
                onClick={() => {
                  setTipo("despesa");
                }}
              >
                Despesa
              </button>
              <button
                type="button"
                className={"toggle-btn " + (tipo === "receita" ? "toggle-active" : "")}
                onClick={() => {
                  setTipo("receita");
                  setFixo(false);
                  setParcelado(false);
                }}
              >
                Receita
              </button>
            </div>
          </div>

          <div className="field">
            <label>Data da transação</label>
            <input
              type="date"
              value={dataTransacao}
              onChange={(e) => {
                setDataTransacao(e.target.value);
                setDataFoiEditada(true);
              }}
            />
          </div>

          <div className="field">
            <label>Hora da transação</label>
            <input
              type="time"
              value={horaTransacao}
              onChange={(e) => {
                setHoraTransacao(e.target.value);
                setHoraFoiEditada(true);
              }}
            />
            <p className="muted small">
              Dica: por padrão ele usa a hora atual do seu aparelho (Brasil -03 normalmente).
            </p>
          </div>

          <div className="field">
            <label>Valor (R$)</label>
            <input
              type="number"
              step="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Descrição</label>
            <input
              type="text"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder={tipo === "despesa" ? "Ex.: Aluguel, mercado..." : "Ex.: salário, extra"}
            />
          </div>

          {tipo === "despesa" && (
            <div className="field">
              <label>Categoria</label>
              <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="Essencial">Essencial</option>
                <option value="Lazer">Lazer</option>
                <option value="Burrice">Burrice</option>
                <option value="Investido">Investido</option>
              </select>
            </div>
          )}

          <div className="field">
            <label>Forma de pagamento</label>
            <select
              value={formaPagamento}
              onChange={(e) => {
                const v = e.target.value;
                setFormaPagamento(v);
                if (v !== "credito") {
                  setCartaoId("");
                  setParcelado(false);
                }
              }}
            >
              <option value="dinheiro">Dinheiro</option>
              <option value="debito">Débito</option>
              <option value="credito">Crédito</option>
              <option value="pix">PIX</option>
              <option value="outros">Outros</option>
            </select>
          </div>

          {formaPagamento === "credito" && (
            <div className="field">
              <label>Cartão utilizado</label>
              <select value={cartaoId || ""} onChange={(e) => setCartaoId(e.target.value)}>
                <option value="">Selecione...</option>
                {cartoes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
          )}

          {tipo === "despesa" && formaPagamento === "credito" && (
            <>
              <div className="field checkbox-field">
                <label>
                  <input
                    type="checkbox"
                    checked={parcelado}
                    onChange={(e) => setParcelado(e.target.checked)}
                  />{" "}
                  Esta compra é parcelada?
                </label>
              </div>

              {parcelado && (
                <div className="field">
                  <label>Número de parcelas</label>
                  <input
                    type="number"
                    min="2"
                    max="36"
                    value={numeroParcelas}
                    onChange={(e) => setNumeroParcelas(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          <button className="primary-btn" style={{ marginTop: 10 }}>
            Salvar transação
          </button>

          {mensagem && <p className="feedback">{mensagem}</p>}
        </form>
      </div>

      {/* ✅ MODAL DE REVISÃO (Voz) */}
      {reviewOpen && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Confirmar lançamento?</h3>
            <p className="muted small" style={{ marginTop: 6 }}>
              Eu esperei <strong>3 segundos de silêncio</strong> e preenchi os campos. Confira e
              confirme.
            </p>

            <div className="card" style={{ marginTop: 10 }}>
              <p className="muted small" style={{ marginBottom: 6 }}>
                Você falou:
              </p>
              <p style={{ marginBottom: 10 }}>"{reviewText}"</p>

              <p className="muted small">
                <strong>Tipo:</strong> {tipo}
                <br />
                <strong>Data:</strong> {dataTransacao || "-"}
                <br />
                <strong>Hora:</strong> {horaTransacao || "-"}
                <br />
                <strong>Valor:</strong> {valor ? formatCurrency(valor) : "-"}
                <br />
                <strong>Descrição:</strong> {descricao || "-"}
                <br />
                {tipo === "despesa" ? (
                  <>
                    <strong>Categoria:</strong> {categoria || "-"}
                    <br />
                  </>
                ) : null}
                <strong>Pagamento:</strong> {formaPagamento || "-"}
                <br />
                {formaPagamento === "credito" ? (
                  <>
                    <strong>Cartão:</strong> {cartaoSelecionadoNome || "(não selecionado)"}
                    <br />
                    <strong>Parcelado:</strong> {parcelado ? `Sim (${numeroParcelas}x)` : "Não"}
                    <br />
                  </>
                ) : null}
              </p>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                marginTop: 12,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                className="toggle-btn"
                onClick={() => {
                  setReviewOpen(false);
                  setReviewText("");
                }}
              >
                Ajustar manualmente
              </button>

              <button
                type="button"
                className="primary-btn"
                onClick={() => {
                  setReviewOpen(false);
                  confirmarSalvarAtual();
                }}
              >
                ✅ Confirmar e salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: limite do cartão estourado */}
      {mostrarConfirmCredito && pendenteCredito && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Limite do cartão estourado</h3>
            <p className="muted small">
              Cartão: <strong>{pendenteCredito.cartaoNome}</strong>
              <br />
              Limite: {formatCurrency(pendenteCredito.limite)}
              <br />
              Gasto atual: {formatCurrency(pendenteCredito.gastoAtual)}
              <br />
              Esta compra vai exceder o limite em{" "}
              <strong>{formatCurrency(pendenteCredito.excedente)}</strong>.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              <button
                type="button"
                className="primary-btn"
                onClick={confirmarCompraEstourandoLimite}
              >
                ✅ Sim, lançar mesmo assim
              </button>
              <button
                type="button"
                className="primary-btn"
                style={{ background: "#374151", color: "#e5e7eb" }}
                onClick={cancelarCompraCredito}
              >
                ✖ Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{` 
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
