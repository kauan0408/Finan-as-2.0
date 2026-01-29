// src/pages/TransacoesPage.jsx
// Página de lançamento de transações (manual + por voz com revisão)
// - Voz: escuta continuamente e só “finaliza” quando ficar 3s em silêncio
// - Inteligência: tenta entender tipo, valor, descrição, categoria, forma, cartão, parcelamento e data
// - Revisão: ao terminar a fala, abre um modal para você conferir antes de salvar

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFinance } from "../App.jsx";

// helper pra montar yyyy-mm-dd
// Recebe ano/mes/dia e transforma numa string "YYYY-MM-DD" (pra <input type="date">)
function toInputDate(ano, mes, dia) {
  const d = new Date(ano, mes, dia);
  return d.toISOString().slice(0, 10);
}

// Formata número como moeda BRL (R$)
// Ex: 50 -> "R$ 50,00"
function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// Normaliza texto para facilitar comparação:
// - minúsculo
// - remove acentos
// - remove espaços extras
// Ex: "Crédito" -> "credito"
function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Limita um valor entre min e max
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export default function TransacoesPage() {
  // Funções e dados globais vindos do contexto do App (FinanceContext)
  const { adicionarTransacao, cartoes, mesReferencia, transacoes } = useFinance();

  // =========================
  // ✅ Estado do formulário (manual)
  // =========================

  // Tipo de lançamento: "despesa" ou "receita"
  const [tipo, setTipo] = useState("despesa");

  // Valor digitado (string, porque vem do input)
  const [valor, setValor] = useState("");

  // Descrição digitada
  const [descricao, setDescricao] = useState("");

  // Categoria (apenas para despesas)
  const [categoria, setCategoria] = useState("Essencial");

  // Forma de pagamento
  const [formaPagamento, setFormaPagamento] = useState("dinheiro");

  // Cartão escolhido (se forma = "credito")
  const [cartaoId, setCartaoId] = useState("");

  // Mantido por compatibilidade (não usado aqui para salvar)
  const [fixo, setFixo] = useState(false);

  // Mensagem rápida na tela (feedback)
  const [mensagem, setMensagem] = useState("");

  // Parcelamento (somente crédito)
  const [parcelado, setParcelado] = useState(false);

  // Número de parcelas (2..36)
  const [numeroParcelas, setNumeroParcelas] = useState(2);

  // Data da transação (input date)
  // Por padrão, usa o mês/ano atual do mesReferencia e o dia de hoje
  const [dataTransacao, setDataTransacao] = useState(() => {
    const hoje = new Date();
    const ano = mesReferencia?.ano ?? hoje.getFullYear();
    const mes = mesReferencia?.mes ?? hoje.getMonth();
    const dia = hoje.getDate();
    return toInputDate(ano, mes, dia);
  });

  // Helper para saber se é despesa (para esconder/mostrar campos)
  const isDespesa = tipo === "despesa";

  // =========================
  // ✅ Confirmação de limite do cartão (crédito)
  // =========================

  // Abre modal quando compra estoura limite
  const [mostrarConfirmCredito, setMostrarConfirmCredito] = useState(false);

  // Guarda dados “pendentes” para confirmar e salvar mesmo estourando o limite
  const [pendenteCredito, setPendenteCredito] = useState(null);

  // =========================
  // ✅ Revisão do lançamento por voz (voz preenche -> você confirma)
  // =========================

  // Controla modal de revisão (aberto/fechado)
  const [reviewOpen, setReviewOpen] = useState(false);

  // Texto original falado, para mostrar no modal
  const [reviewText, setReviewText] = useState("");

  // =========================
  // 🎤 SpeechRecognition (voz)
  // =========================

  // Estado: está gravando?
  const [gravando, setGravando] = useState(false);

  // Estado: está iniciando ou “processando” microfone?
  const [processandoAudio, setProcessandoAudio] = useState(false);

  // Referência para o objeto SpeechRecognition (não recriar toda hora)
  const recognitionRef = useRef(null);

  // Se o navegador suporta voz
  const [suportaVoz, setSuportaVoz] = useState(true);

  // ✅ buffer do texto falado + timer de silêncio (3s)
  // Buffer com texto parcial (final + interim)
  const speechBufferRef = useRef("");

  // Guarda apenas o texto “final” (speech reconhecido como final)
  const lastFinalRef = useRef("");

  // Timer para detectar silêncio
  const silenceTimerRef = useRef(null);

  // Tempo de silêncio para parar de escutar (3 segundos)
  const SILENCE_MS = 3000;

  // Mostra uma mensagem curta na tela, e apaga depois
  function mostrarMensagem(texto) {
    setMensagem(texto);
    setTimeout(() => setMensagem(""), 2600);
  }

  // =========================
  // ✅ Função principal: SALVAR transação (com parcelamento)
  // =========================
  const processarTransacao = (dados) => {
    // Desestrutura o “pacote” de dados para salvar
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

    // Converte valor para número (aceita vírgula)
    const v = parseFloat(String(valorForm).replace(",", "."));
    if (isNaN(v) || v <= 0) {
      mostrarMensagem("Informe um valor válido.");
      return;
    }

    // Data base: se veio pronto, usa; senão, usa agora
    const baseDate = dataBaseISO ? new Date(dataBaseISO) : new Date();

    // Regras locais
    const isDespesaLocal = tipoForm === "despesa";
    const ehDespesaCreditoLocal =
      isDespesaLocal && formaForm === "credito" && cartaoIdForm;

    // Lista de lançamentos que realmente serão criados no sistema
    const listaParaSalvar = [];

    // Caso especial: despesa no crédito parcelada -> cria 1 transação por parcela (meses diferentes)
    if (ehDespesaCreditoLocal && parceladoForm && Number(numeroParcelasForm) > 1) {
      // Garante número de parcelas válido
      const n = clamp(parseInt(numeroParcelasForm, 10) || 2, 2, 36);

      // Valor por parcela
      const valorParcela = v / n;

      // groupId para amarrar as parcelas como “mesma compra”
      const groupId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Date.now().toString(36) + Math.random().toString(36).slice(2);

      // Cria parcelas i=1..n
      for (let i = 1; i <= n; i++) {
        // Data da parcela: base + (i-1) meses
        const dataParcela = new Date(baseDate);
        dataParcela.setMonth(dataParcela.getMonth() + (i - 1));

        // Empilha a transação da parcela
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
          dataHora: dataParcela.toISOString(),
          parcelaAtual: i,
          parcelaTotal: n,
          groupId,
          totalCompra: v,
        });
      }

      // Feedback para o usuário
      mostrarMensagem(`Compra parcelada em ${n}x lançada.`);
    } else {
      // Caso “normal”: 1 transação só
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

      // Feedback
      mostrarMensagem("Transação salva!");
    }

    // Salva todas as transações geradas
    listaParaSalvar.forEach((t) => adicionarTransacao(t));

    // Limpa formulário para o próximo lançamento
    setValor("");
    setDescricao("");
    setCategoria("Essencial");
    setFormaPagamento("dinheiro");
    setCartaoId("");
    setFixo(false);
    setTipo("despesa");
    setParcelado(false);
    setNumeroParcelas(2);

    // Fecha revisão (se estava aberta)
    setReviewText("");
    setReviewOpen(false);
  };

  // Monta uma data ISO usando o yyyy-mm-dd escolhido no input, mas com a hora real “agora”
  const montarBaseDateISO = (yyyyMmDd) => {
    if (yyyyMmDd) {
      const agora = new Date();
      const [y, m, d] = String(yyyyMmDd).split("-").map(Number);
      const dt = new Date(
        y,
        (m || 1) - 1,
        d || 1,
        agora.getHours(),
        agora.getMinutes(),
        agora.getSeconds(),
        agora.getMilliseconds()
      );
      return dt.toISOString();
    }
    return new Date().toISOString();
  };

  // Confirma e salva a transação atual do formulário
  // (inclui a checagem de limite do cartão)
  const confirmarSalvarAtual = () => {
    // Valida valor
    const v = parseFloat(String(valor).replace(",", "."));
    if (isNaN(v) || v <= 0) {
      mostrarMensagem("Informe um valor válido.");
      return;
    }

    // Data base (ISO)
    const baseISO = montarBaseDateISO(dataTransacao);

    // Verifica se é despesa no crédito e se tem cartão selecionado
    const ehDespesaCredito =
      tipo === "despesa" && formaPagamento === "credito" && cartaoId;

    // Se for crédito, checa limite para não estourar “sem querer”
    if (ehDespesaCredito) {
      const cartao = cartoes.find((c) => c.id === cartaoId);
      const limite = cartao?.limite || 0;

      // Só checa se o cartão tem limite definido
      if (limite > 0) {
        let totalCompras = 0;
        let totalPagamentos = 0;

        // Soma compras e pagamentos para descobrir o “gasto atual”
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

        // Se o valor é maior que o limite restante -> abre modal de confirmação
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

    // Se não estourou limite (ou não é crédito), salva direto
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

  // Submit do formulário manual (apenas chama confirmarSalvarAtual)
  const handleSubmit = (e) => {
    e.preventDefault();
    confirmarSalvarAtual();
  };

  // Troca tipo (despesa/receita) e ajusta flags
  const onChangeTipo = (novoTipo) => {
    setTipo(novoTipo);
    // Se virar receita, não faz sentido parcelado
    if (novoTipo === "receita") {
      setFixo(false);
      setParcelado(false);
    }
  };

  // Troca forma de pagamento e ajusta campos dependentes (cartão/parcelado)
  const onChangeForma = (e) => {
    const v = e.target.value;
    setFormaPagamento(v);
    if (v !== "credito") {
      setCartaoId("");
      setParcelado(false);
    }
  };

  // Confirma compra que estourou limite (salva mesmo assim)
  const confirmarCompraEstourandoLimite = () => {
    if (!pendenteCredito) return;
    processarTransacao(pendenteCredito.dados);
    setPendenteCredito(null);
    setMostrarConfirmCredito(false);
  };

  // Cancela compra que estourou limite
  const cancelarCompraCredito = () => {
    setPendenteCredito(null);
    setMostrarConfirmCredito(false);
  };

  // =========================
  // ✅ INTELIGÊNCIA (extrair do texto falado)
  // =========================

  // Pré-processa a lista de cartões com nome normalizado (pra comparar sem acento)
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

  // Tenta extrair data a partir do texto:
  // - "hoje", "ontem", "amanhã"
  // - "dia 15" (usa o mês/ano do mesReferencia)
  const extrairDataYYYYMMDD = (tNorm) => {
    const hoje = new Date();
    let dt = new Date(hoje);

    if (tNorm.includes("hoje")) {
      // mantém hoje
    } else if (tNorm.includes("ontem")) {
      dt.setDate(dt.getDate() - 1);
    } else if (tNorm.includes("amanha") || tNorm.includes("amanhã")) {
      dt.setDate(dt.getDate() + 1);
    } else {
      const mDia = tNorm.match(/\bdia\s+(\d{1,2})\b/);
      if (mDia && mDia[1]) {
        const dia = clamp(parseInt(mDia[1], 10) || hoje.getDate(), 1, 31);
        const ano = mesReferencia?.ano ?? hoje.getFullYear();
        const mes = (mesReferencia?.mes ?? hoje.getMonth()) + 1;
        const y = ano;
        const mm = String(mes).padStart(2, "0");
        const dd = String(dia).padStart(2, "0");
        return `${y}-${mm}-${dd}`;
      }
      return null;
    }

    // transforma dt em string yyyy-mm-dd
    const y = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  };

  // Extrai dados “inteligentes” do texto falado:
  // - tipo, valor, descrição, categoria, forma, cartão, parcelamento, data
  const extrairDadosDoTexto = (texto) => {
    const tOriginal = String(texto || "").trim();
    const tNorm = normalizeText(tOriginal);

    // 1) tipo
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

    // 2) valor
    // tenta achar R$ 50 / 50 reais / (fallback) maior número do texto
    let valorAuto = "";
    let m = tNorm.match(/r\$\s*(\d+(?:[.,]\d{1,2})?)/i);
    if (!m) m = tNorm.match(/(\d+(?:[.,]\d{1,2})?)\s*(reais?|real)\b/i);

    if (!m) {
      // fallback: pega números do texto
      const allNums = tNorm.match(/\b\d+(?:[.,]\d{1,2})?\b/g);
      if (allNums?.length) {
        const candidates = allNums
          .map((x) => String(x).replace(",", "."))
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n) && n > 0);

        if (candidates.length) {
          const sorted = [...candidates].sort((a, b) => b - a);
          const max = sorted[0];

          // se tiver "x/vezes/parcelas" e o maior número for <=36
          // pode ser que o maior seja parcelas, então pega o segundo maior como valor
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

    // 3) forma
    let formaAuto = "dinheiro";
    if (tNorm.includes("pix") || tNorm.includes("pics")) formaAuto = "pix";
    else if (tNorm.includes("debito") || tNorm.includes("débito")) formaAuto = "debito";
    else if (tNorm.includes("credito") || tNorm.includes("crédito")) formaAuto = "credito";
    else if (tNorm.includes("dinheiro")) formaAuto = "dinheiro";
    else if (tNorm.includes("cartao") || tNorm.includes("cartão")) formaAuto = "credito";

    // 4) categoria (simples)
    let categoriaAuto = "Essencial";
    if (tNorm.includes("lazer")) categoriaAuto = "Lazer";
    if (tNorm.includes("essencial")) categoriaAuto = "Essencial";

    // 5) parcelas (melhorado)
    // pega: "3x" / "3 x" / "3 vezes" / "3 parcelas" / "parcelado"
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

    // 6) cartão (tenta achar pelo nome do cartão no texto)
    let cartaoIdAuto = "";
    if (cartoesNorm.length) {
      const hit = cartoesNorm.find((c) => c._normNome && tNorm.includes(c._normNome));
      if (hit) cartaoIdAuto = hit.id;
    }

    // 7) data
    const dataAuto = extrairDataYYYYMMDD(tNorm);

    // 8) stop dinâmico: remove palavras que não devem virar “descrição”
    // inclui palavras dos nomes dos cartões, para não escrever “nubank” na descrição
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

    // Pega palavras “limpas” para formar a descrição
    const palavras = tNorm
      .replace(/[^\p{L}\p{N}\s$.,]/gu, " ")
      .split(/\s+/)
      .filter(Boolean);

    const desc = palavras
      .map((p) => p.replace(/[.,]/g, ""))
      .filter((p) => {
        if (!p) return false;
        if (stop.has(p)) return false;
        if (/^\d+(?:[.,]\d{1,2})?$/.test(p)) return false; // remove números
        return true;
      })
      .join(" ")
      .trim();

    // Se a descrição ficar vazia, usa o original como fallback
    const descricaoAuto = desc || tOriginal;

    // Retorna tudo que foi entendido
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

  // Aplica os dados extraídos ao formulário e abre o modal de revisão
  const aplicarDadosNoFormulario = (dados) => {
    // Preenche tipo
    setTipo(dados.tipoAuto);

    // Preenche valor
    if (dados.valorAuto) setValor(String(dados.valorAuto));

    // Preenche descrição e categoria
    setDescricao(dados.descricaoAuto || "");
    setCategoria(dados.categoriaAuto || "Essencial");

    // ✅ Se falou parcelado, assume crédito
    const formaFinal = dados.parceladoAuto ? "credito" : (dados.formaAuto || "dinheiro");
    setFormaPagamento(formaFinal);

    // Se for crédito, tenta selecionar o cartão detectado
    if (formaFinal === "credito") {
      if (dados.cartaoIdAuto) setCartaoId(dados.cartaoIdAuto);
      // se não achou, mantém o que já estava selecionado
    } else {
      // Se não for crédito, limpa cartão
      setCartaoId("");
    }

    // Parcelamento: só faz sentido se forma final for crédito
    if (formaFinal === "credito" && dados.parceladoAuto) {
      setParcelado(true);
      setNumeroParcelas(dados.numeroParcelasAuto || 2);
    } else {
      setParcelado(false);
      setNumeroParcelas(2);
    }

    // Data detectada
    if (dados.dataAuto) setDataTransacao(dados.dataAuto);

    // Salva o texto original para mostrar no modal de revisão
    setReviewText(dados.textoOriginal || "");

    // Abre modal de revisão (não salva automaticamente)
    setReviewOpen(true);
  };

  // ✅ Chamada quando o sistema decide que você parou de falar (3s de silêncio)
  const finalizarPorSilencio = () => {
    // Texto final capturado (buffer final + interim)
    const finalText = String(speechBufferRef.current || "").trim();

    if (!finalText) {
      mostrarMensagem("❌ Não entendi. Tente falar de novo.");
      return;
    }

    // Extrai dados
    const dados = extrairDadosDoTexto(finalText);

    // Valida valor extraído
    if (!dados.valorAuto || Number(String(dados.valorAuto).replace(",", ".")) <= 0) {
      mostrarMensagem("❌ Não achei o valor. Fale: 'R$ 50 ...' ou '50 reais ...'");
      return;
    }

    // Preenche formulário e abre revisão
    aplicarDadosNoFormulario(dados);

    // Feedback
    mostrarMensagem("✅ Pronto! Confira e confirme.");
  };

  // =========================
  // ✅ SpeechRecognition com 3s de silêncio
  // =========================
  useEffect(() => {
    // Compatibilidade (Chrome usa webkitSpeechRecognition)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    // Se não existir, navegador não suporta
    if (!SpeechRecognition) {
      setSuportaVoz(false);
      return;
    }

    // Cria o recognizer
    const rec = new SpeechRecognition();
    rec.lang = "pt-BR";

    // continuous: mantém ouvindo sem parar a cada frase
    rec.continuous = true;

    // interimResults: manda resultados parciais enquanto fala
    rec.interimResults = true;

    rec.maxAlternatives = 1;

    // Quando começa a ouvir
    rec.onstart = () => {
      setProcessandoAudio(false);
      setGravando(true);

      // zera buffers
      speechBufferRef.current = "";
      lastFinalRef.current = "";

      // limpa timer anterior
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      mostrarMensagem("🎤 Ouvindo... (paro após 3s de silêncio)");
    };

    // Quando chega texto (parcial ou final)
    rec.onresult = (event) => {
      let interim = "";
      let finalChunk = "";

      // Varre todos os resultados novos desde resultIndex
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const txt = r[0]?.transcript || "";

        // Se o resultado é final, joga no finalChunk
        if (r.isFinal) finalChunk += txt + " ";
        else interim += txt + " ";
      }

      // Se chegou parte final, acumula no “final total”
      if (finalChunk.trim()) {
        lastFinalRef.current += finalChunk;
      }

      // Buffer atual = final total + interim
      speechBufferRef.current = (lastFinalRef.current + " " + interim).trim();

      // Reinicia o timer: se ficar 3 segundos sem novos resultados -> para e finaliza
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        try {
          rec.stop(); // para o reconhecimento (vai disparar onend)
        } catch {}

        setGravando(false);
        setProcessandoAudio(false);

        // Finaliza (extrai dados + abre revisão)
        finalizarPorSilencio();
      }, SILENCE_MS);
    };

    // Se der erro no reconhecimento
    rec.onerror = (e) => {
      console.error("SpeechRecognition erro:", e);
      setGravando(false);
      setProcessandoAudio(false);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        mostrarMensagem("❌ Microfone bloqueado. Libere a permissão do navegador.");
      } else if (e?.error === "no-speech") {
        mostrarMensagem("❌ Não ouvi nada. Fale mais perto do microfone.");
      } else {
        mostrarMensagem("❌ Erro ao usar voz neste navegador.");
      }
    };

    // Quando encerra (parou)
    rec.onend = () => {
      setGravando(false);
      setProcessandoAudio(false);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };

    // Guarda na ref para poder start/stop nos botões
    recognitionRef.current = rec;

    // Cleanup quando desmontar a página
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
    // Dependências:
    // - cartoesNorm: para remover nomes de cartões e detectar cartão
    // - mesReferencia: para interpretar "dia 15" no mês atual
  }, []);

  // Inicia gravação
  const iniciarGravacao = () => {
    if (!suportaVoz || !recognitionRef.current) {
      mostrarMensagem("❌ Seu navegador não suporta voz. Use o Chrome.");
      return;
    }
    try {
      setProcessandoAudio(true);

      // zera buffers antes de começar
      speechBufferRef.current = "";
      lastFinalRef.current = "";
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      // start do recognizer
      recognitionRef.current.start();
    } catch (e) {
      console.error(e);
      setProcessandoAudio(false);
      mostrarMensagem("❌ Não consegui iniciar o áudio. Clique de novo.");
    }
  };

  // Para gravação manualmente (botão “Parar agora”)
  const pararGravacao = () => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch (e) {
      console.error(e);
    } finally {
      setGravando(false);
      setProcessandoAudio(false);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      // Se já tem algo no buffer, finaliza imediatamente
      if (String(speechBufferRef.current || "").trim()) {
        finalizarPorSilencio();
      }
    }
  };

  // Nome do cartão selecionado (para mostrar na revisão)
  const cartaoSelecionadoNome = useMemo(() => {
    const c = cartoes.find((x) => x.id === cartaoId);
    return c?.nome || "";
  }, [cartoes, cartaoId]);

  return (
    <div className="page">
      <h2 className="page-title">Transações</h2>

      {/* Card principal do formulário */}
      <div className="card">
        {/* 🎤 BOTÕES DE ÁUDIO */}
        <div style={{ marginBottom: 16, textAlign: "center" }}>
          {/* Se não está gravando e não está “processando” */}
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

          {/* Se está gravando */}
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

          {/* Se está iniciando microfone */}
          {processandoAudio && <div style={{ color: "#6b7280" }}>⏳ Iniciando microfone...</div>}

          {/* Se não suporta voz */}
          {!suportaVoz && (
            <p className="muted small" style={{ marginTop: 8 }}>
              ❌ Seu navegador não suporta voz. Use o Chrome.
            </p>
          )}

          {/* Dicas de fala */}
          <p className="muted small" style={{ marginTop: 8 }}>
            Exemplos: <br />
            • "Despesa R$ 50 mercado essencial pix hoje" <br />
            • "120 tênis 3x nubank lazer" <br />
            • "Receita 200 bico pix ontem"
          </p>
        </div>

        {/* Formulário manual (continua funcionando normal) */}
        <form className="form" onSubmit={handleSubmit}>
          {/* Tipo */}
          <div className="field">
            <label>Tipo</label>
            <div className="toggle-group">
              <button
                type="button"
                className={"toggle-btn " + (tipo === "despesa" ? "toggle-active" : "")}
                onClick={() => onChangeTipo("despesa")}
              >
                Despesa
              </button>
              <button
                type="button"
                className={"toggle-btn " + (tipo === "receita" ? "toggle-active" : "")}
                onClick={() => onChangeTipo("receita")}
              >
                Receita
              </button>
            </div>
          </div>

          {/* Data */}
          <div className="field">
            <label>Data da transação</label>
            <input
              type="date"
              value={dataTransacao}
              onChange={(e) => setDataTransacao(e.target.value)}
            />
            <p className="muted small">
              Você pode falar: <strong>hoje</strong>, <strong>ontem</strong>,{" "}
              <strong>amanhã</strong> ou <strong>dia 15</strong>.
            </p>
          </div>

          {/* Valor */}
          <div className="field">
            <label>Valor (R$)</label>
            <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>

          {/* Descrição */}
          <div className="field">
            <label>Descrição</label>
            <input
              type="text"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder={isDespesa ? "Ex.: Aluguel, mercado..." : "Ex.: salário, extra"}
            />
          </div>

          {/* Categoria (só se despesa) */}
          {isDespesa && (
            <div className="field">
              <label>Categoria</label>
              <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="Essencial">Essencial</option>
                <option value="Lazer">Lazer</option>
              </select>
            </div>
          )}

          {/* Forma de pagamento */}
          <div className="field">
            <label>Forma de pagamento</label>
            <select value={formaPagamento} onChange={onChangeForma}>
              <option value="dinheiro">Dinheiro</option>
              <option value="debito">Débito</option>
              <option value="credito">Crédito</option>
              <option value="pix">PIX</option>
              <option value="outros">Outros</option>
            </select>
          </div>

          {/* Cartão (só se crédito) */}
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
              <p className="muted small">
                Se você falar o nome do cartão (ex.: “Nubank”), ele seleciona e NÃO coloca na descrição.
              </p>
            </div>
          )}

          {/* Parcelado (só despesa no crédito) */}
          {isDespesa && formaPagamento === "credito" && (
            <>
              <div className="field checkbox-field">
                <label>
                  <input type="checkbox" checked={parcelado} onChange={(e) => setParcelado(e.target.checked)} />{" "}
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

          {/* Botão salvar manual */}
          <button className="primary-btn" style={{ marginTop: 10 }}>
            Salvar transação
          </button>

          {/* Mensagem rápida */}
          {mensagem && <p className="feedback">{mensagem}</p>}
        </form>
      </div>

      {/* ✅ MODAL DE REVISÃO (Voz) */}
      {reviewOpen && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Confirmar lançamento?</h3>
            <p className="muted small" style={{ marginTop: 6 }}>
              Eu esperei <strong>3 segundos de silêncio</strong> e preenchi os campos. Confira e confirme.
            </p>

            {/* Resumo do que vai ser salvo */}
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

            {/* Ações no modal */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
              {/* Fecha modal sem salvar (você ajusta e salva manualmente depois) */}
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

              {/* Confirma e salva */}
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
              <button type="button" className="primary-btn" onClick={confirmarCompraEstourandoLimite}>
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

      {/* CSS local para animação do botão “Parar” */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

