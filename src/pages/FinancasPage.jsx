// src/pages/FinancasPage.jsx
import React, { useMemo, useState } from "react";
import { useFinance } from "../App.jsx";
import { useNavigate } from "react-router-dom";

function formatCurrency(value) {
  const num = Number(value || 0);
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/* ✅ Próximo pagamento (dia do perfil + hoje) */
function calcularProximoPagamento(diaPagamento) {
  const dia = Number(diaPagamento);
  if (!dia || dia < 1 || dia > 31) return null;

  const hoje = new Date();

  const criarDataCerta = (ano, mes, diaDesejado) => {
    const ultimoDiaDoMes = new Date(ano, mes + 1, 0).getDate();
    const d = Math.min(diaDesejado, ultimoDiaDoMes);
    return new Date(ano, mes, d);
  };

  let proximo = criarDataCerta(hoje.getFullYear(), hoje.getMonth(), dia);

  if (proximo < hoje) {
    const ano2 = hoje.getFullYear();
    const mes2 = hoje.getMonth() + 1;
    proximo = criarDataCerta(ano2, mes2, dia);
  }

  const diffMs = proximo - hoje;
  const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return { data: proximo, diasRestantes: diffDias };
}

function getValorFixo(valoresPorMes = {}, chaveMes) {
  if (valoresPorMes && valoresPorMes[chaveMes] != null) {
    return Number(valoresPorMes[chaveMes]);
  }

  const meses = Object.keys(valoresPorMes || {}).sort();
  let ultimo = null;
  for (const m of meses) {
    if (m <= chaveMes) ultimo = m;
  }
  return ultimo ? Number(valoresPorMes[ultimo]) : 0;
}

function normalizarNome(descricao) {
  return String(descricao || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// ✅ normaliza texto
function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

// ✅ regras automáticas (comida / transporte)
function isFood(desc) {
  const d = normalizeText(desc);
  const keys = [
    "ifood",
    "i food",
    "lanche",
    "comida",
    "cafe",
    "cafe da tarde",
    "almoco",
    "jantar",
    "refri",
    "refrigerante",
    "coca",
    "guarana",
    "miojo",
    "doce",
    "pudim",
    "risoto",
    "salgado",
    "pizza",
    "hamburguer",
    "sorvete",
    "acai",
  ];
  return keys.some((k) => d.includes(normalizeText(k)));
}

function isTransport(desc) {
  const d = normalizeText(desc);
  const keys = ["uber", "99", "taxi", "onibus", "passagem", "transporte", "corrida"];
  return keys.some((k) => d.includes(normalizeText(k)));
}

// helpers de mês
function monthKey(ano, mes0) {
  return `${ano}-${String(mes0 + 1).padStart(2, "0")}`;
}

function prevMonth(ano, mes0) {
  let y = ano;
  let m = mes0 - 1;
  if (m < 0) {
    m = 11;
    y = ano - 1;
  }
  return { ano: y, mes: m };
}

/* --------- helpers data (lembretes) --------- */
function pad2(n) {
  return String(n).padStart(2, "0");
}

function toLocalDateKey(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
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

function fmtDiaMesBR(d) {
  const x = new Date(d);
  return `${pad2(x.getDate())}/${pad2(x.getMonth() + 1)}`;
}

function fmtHoraBR(d) {
  const x = new Date(d);
  return `${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
}

/* --------- Classificador automático (modal) --------- */
// ✅ simples (por palavra-chave) pra encaixar em “mais parecida”
const TAXONOMIA = [
  {
    grupo: "ESSENCIAIS",
    itens: [
      { nome: "Aluguel / Financiamento", keys: ["aluguel", "financi", "prestacao casa", "parcela casa", "imovel"] },
      { nome: "Água", keys: ["agua", "copasa", "saae"] },
      { nome: "Luz", keys: ["luz", "energia", "cemig", "enel"] },
      { nome: "Internet", keys: ["internet", "wifi", "vivo fibra", "claro net", "oi fibra", "tim live"] },
      { nome: "Gás", keys: ["gas", "botijao", "ultragaz"] },
      { nome: "Mercado", keys: ["mercado", "supermerc", "atacadao", "assai", "carrefour", "padaria", "hortifruti"] },
      { nome: "Transporte", keys: ["uber", "99", "taxi", "onibus", "passagem", "combust", "gasolina"] },
      { nome: "Farmácia", keys: ["farmacia", "remedio", "drogaria", "droga"] },
      { nome: "Plano de saúde", keys: ["plano", "unimed", "saude", "consulta", "medico"] },
    ],
  },
  {
    grupo: "FINANCEIRO",
    itens: [
      { nome: "Cartão de crédito", keys: ["cartao", "credito", "fatura"] },
      { nome: "Parcelamentos", keys: ["parcela", "parcelado", "parcelamento"] },
      { nome: "Empréstimos", keys: ["emprest", "consignado"] },
      { nome: "Reserva de emergência", keys: ["reserva", "emergencia"] },
      { nome: "Investimentos", keys: ["invest", "cdb", "tesouro", "acao", "cripto", "bitcoin"] },
      { nome: "Taxas bancárias", keys: ["taxa", "tarifa", "anuidade", "iof"] },
    ],
  },
  {
    grupo: "EDUCAÇÃO & DESENVOLVIMENTO",
    itens: [
      { nome: "Escola / Faculdade", keys: ["escola", "faculdade", "mensalidade"] },
      { nome: "Cursos", keys: ["curso", "udemy", "alura"] },
      { nome: "Livros", keys: ["livro", "apostila"] },
      { nome: "Material escolar", keys: ["material", "caderno", "caneta", "lapis"] },
      { nome: "Concursos / ENEM", keys: ["enem", "concurso", "inscricao"] },
    ],
  },
  {
    grupo: "LAZER & QUALIDADE DE VIDA",
    itens: [
      { nome: "Restaurantes", keys: ["restaurante", "churrascaria"] },
      { nome: "Delivery", keys: ["ifood", "delivery", "lanche", "pizza", "hamburg"] },
      { nome: "Cinema / Streaming", keys: ["cinema", "netflix", "prime", "hbo", "spotify", "stream"] },
      { nome: "Festa", keys: ["festa", "evento", "ingresso"] },
      { nome: "Academia", keys: ["academia", "gym"] },
      { nome: "Passeios", keys: ["passeio", "viagem", "parque"] },
    ],
  },
  {
    grupo: "PESSOAL",
    itens: [
      { nome: "Roupas", keys: ["roupa", "calcado", "tenis", "sapato"] },
      { nome: "Salão", keys: ["salao", "cabelo", "barbearia"] },
      { nome: "Cosméticos", keys: ["cosmetico", "perfume", "maqui"] },
      { nome: "Cuidados pessoais", keys: ["higiene", "desodorante", "sabonete"] },
    ],
  },
  {
    grupo: "CASA",
    itens: [
      { nome: "Manutenção", keys: ["manutenc", "reparo", "conserto casa"] },
      { nome: "Produtos de limpeza", keys: ["limpeza", "detergente", "sabao", "desinfet"] },
      { nome: "Móveis", keys: ["movel", "sofa", "mesa", "cadeira"] },
      { nome: "Utensílios", keys: ["utens", "panela", "prato", "copo"] },
    ],
  },
  {
    grupo: "IMPREVISTOS",
    itens: [
      { nome: "Conserto de carro", keys: ["conserto carro", "mecan", "oficina", "pneu"] },
      { nome: "Emergência médica", keys: ["emergencia", "pronto socorro", "exame"] },
      { nome: "Multas", keys: ["multa"] },
      { nome: "Conserto de celular", keys: ["conserto celular", "tela", "assistencia"] },
    ],
  },
];

function classificarTaxonomia(descricao) {
  const d = normalizeText(descricao || "");
  if (!d) return { grupo: "OUTROS", item: "Outros" };

  let best = { score: 0, grupo: "OUTROS", item: "Outros" };

  for (const g of TAXONOMIA) {
    for (const it of g.itens) {
      const hits = (it.keys || []).reduce((acc, k) => (d.includes(normalizeText(k)) ? acc + 1 : acc), 0);
      if (hits > best.score) best = { score: hits, grupo: g.grupo, item: it.nome };
    }
  }

  if (best.score <= 0) return { grupo: "OUTROS", item: "Outros" };
  return { grupo: best.grupo, item: best.item };
}

export default function FinancasPage() {
  const navigate = useNavigate();

  // ✅ pega também lembretes (do mesmo contexto)
  const {
    transacoes,
    profile,
    mesReferencia,
    mudarMesReferencia,
    irParaMesAtual,
    lembretes,
  } = useFinance();

  const listLembretes = Array.isArray(lembretes) ? lembretes : [];

  // ✅ modal ao clicar em "Gasto por categoria"
  const [modalCategorias, setModalCategorias] = useState(false);

  const salariosPorMes = profile?.salariosPorMes || {};

  function getSalarioMes(ano, mes0) {
    const k = monthKey(ano, mes0);
    return Number(salariosPorMes[k] ?? profile?.rendaMensal ?? 0);
  }

  const resumo = useMemo(() => {
    const montarResumoMes = (mes0, ano) => {
      let receitas = 0;
      let despesasTransacoes = 0;
      let gastosCartao = 0;

      // ✅ categorias
      let categorias = { essencial: 0, lazer: 0, burrice: 0, investido: 0 };
      const semanas = [0, 0, 0, 0];

      const chaveMes = monthKey(ano, mes0);

      const gastosFixosPerfil = (Array.isArray(profile?.gastosFixos) ? profile.gastosFixos : [])
        .filter((g) => g.ativo !== false)
        .filter(
          (g) =>
            (g.nome || "").toLowerCase() !== "educacao" &&
            (g.categoria || "").toLowerCase() !== "educacao"
        )
        .map((g) => ({
          id: g.id,
          descricao: g.nome,
          categoria: (g.categoria || "").toLowerCase(),
          valor: getValorFixo(g.valoresPorMes || {}, chaveMes),
        }))
        .filter((g) => Number(g.valor) > 0);

      transacoes.forEach((t) => {
        const dt = new Date(t.dataHora);

        if (dt.getMonth() === mes0 && dt.getFullYear() === ano) {
          const valor = Number(t.valor || 0);

          if (t.tipo === "receita") {
            receitas += valor;
          } else if (t.tipo === "despesa") {
            despesasTransacoes += valor;

            if (t.formaPagamento === "credito") {
              gastosCartao += valor;
            }

            const cat = (t.categoria || "").toLowerCase();
            if (cat === "essencial") categorias.essencial += valor;
            if (cat === "lazer") categorias.lazer += valor;
            if (cat === "burrice") categorias.burrice += valor;
            if (cat === "investido") categorias.investido += valor;

            const dia = dt.getDate(); // 1..31
            const semanaIndex = Math.min(3, Math.floor((dia - 1) / 7)); // 0..3
            semanas[semanaIndex] += valor;
          }
        }
      });

      const totalGastosFixos = gastosFixosPerfil.reduce((acc, g) => acc + Number(g.valor || 0), 0);

      const despesas = despesasTransacoes + totalGastosFixos;

      gastosFixosPerfil.forEach((g) => {
        const v = Number(g.valor || 0);
        if (!v) return;
        const cat = (g.categoria || "").toLowerCase();
        if (cat === "essencial") categorias.essencial += v;
        if (cat === "lazer") categorias.lazer += v;
        if (cat === "burrice") categorias.burrice += v;
        if (cat === "investido") categorias.investido += v;
      });

      const saldo = receitas - despesas;

      // Top 5
      const mapa = new Map();
      transacoes.forEach((t) => {
        const dt = new Date(t.dataHora);
        if (t.tipo === "despesa" && dt.getMonth() === mes0 && dt.getFullYear() === ano) {
          const v = Number(t.valor || 0);
          if (!v) return;

          const key = normalizarNome(t.descricao || "Sem descrição");
          const atual =
            mapa.get(key) || { descricao: t.descricao || "Sem descrição", valor: 0, count: 0 };
          atual.valor += v;
          atual.count += 1;

          if ((!atual.descricao || atual.descricao === "Sem descrição") && t.descricao) {
            atual.descricao = t.descricao;
          }
          mapa.set(key, atual);
        }
      });

      const topDespesas = Array.from(mapa.values())
        .sort((a, b) => Number(b.valor) - Number(a.valor))
        .slice(0, 5)
        .map((x, idx) => ({
          id: `top-${ano}-${mes0}-${idx}`,
          descricao: x.descricao,
          valor: x.valor,
          count: x.count,
        }));

      const totalCat =
        categorias.essencial + categorias.lazer + categorias.burrice + categorias.investido || 1;

      return {
        receitas,
        despesas,
        saldo,
        gastosCartao,
        categorias,
        pEssencial: (categorias.essencial / totalCat) * 100,
        pLazer: (categorias.lazer / totalCat) * 100,
        pBurrice: (categorias.burrice / totalCat) * 100,
        pInvestido: (categorias.investido / totalCat) * 100,
        semanas,
        maxSemana: Math.max(...semanas, 1),
        topDespesas,
        gastosFixos: gastosFixosPerfil,
        totalGastosFixos,
        despesasTransacoes,
      };
    };

    const { mes, ano } = mesReferencia;
    const resumoAtual = montarResumoMes(mes, ano);

    const { ano: anoPrev, mes: mesPrev } = prevMonth(ano, mes);
    const resumoPrev = montarResumoMes(mesPrev, anoPrev);

    const salarioPrev = getSalarioMes(anoPrev, mesPrev);
    const saldoPrevComSalario =
      salarioPrev > 0 ? salarioPrev + resumoPrev.receitas - resumoPrev.despesas : resumoPrev.saldo;

    const pendenteAnterior = saldoPrevComSalario < 0 ? Math.abs(saldoPrevComSalario) : 0;

    return { resumoAtual, pendenteAnterior };
  }, [
    transacoes,
    mesReferencia,
    profile?.gastosFixos,
    profile?.rendaMensal,
    profile?.salariosPorMes,
  ]);

  const { resumoAtual, pendenteAnterior } = resumo;

  const chaveMesAtual = monthKey(mesReferencia.ano, mesReferencia.mes);
  const salarioFixo = Number(
    (profile?.salariosPorMes || {})[chaveMesAtual] ?? profile?.rendaMensal ?? 0
  );

  const limiteGastoMensal = Number(profile?.limiteGastoMensal || 0);

  const diaPagamento = profile?.diaPagamento || "";
  const proximoPag = diaPagamento ? calcularProximoPagamento(diaPagamento) : null;

  // ✅ (mantém cálculo, mas NÃO mostra aqueles textos que você pediu pra tirar)
  const resultadoSalario =
    salarioFixo > 0 ? salarioFixo - resumoAtual.despesas - pendenteAnterior : null;

  const saldoComSalario =
    salarioFixo > 0
      ? salarioFixo + resumoAtual.receitas - resumoAtual.despesas - pendenteAnterior
      : resumoAtual.saldo - pendenteAnterior;

  const pE = resumoAtual.pEssencial || 0;
  const pL = resumoAtual.pLazer || 0;
  const pB = resumoAtual.pBurrice || 0;

  const cut1 = pE;
  const cut2 = pE + pL;
  const cut3 = pE + pL + pB;

  const pizzaStyle = {
    backgroundImage: `conic-gradient(
      #8FA3FF 0 ${cut1}%,
      #4C5ACF ${cut1}% ${cut2}%,
      #F59E0B ${cut2}% ${cut3}%,
      #10B981 ${cut3}% 100%
    )`,
  };

  const percLimite =
    limiteGastoMensal > 0 ? Math.min(100, (resumoAtual.despesas / limiteGastoMensal) * 100) : 0;

  const nomeMesArr = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];

  const nomeMes = nomeMesArr[mesReferencia.mes];

  // ✅ dados do modal de categorias (organiza sozinho)
  const detalhesCategorias = useMemo(() => {
    const mes0 = mesReferencia.mes;
    const ano = mesReferencia.ano;

    const despesasMes = transacoes
      .filter((t) => {
        const dt = new Date(t.dataHora);
        return t.tipo === "despesa" && dt.getMonth() === mes0 && dt.getFullYear() === ano;
      })
      .map((t) => ({
        id: t.id,
        descricao: t.descricao || "Sem descrição",
        valor: Number(t.valor || 0),
        categoria: String(t.categoria || "").trim() || "Sem categoria",
      }));

    const fixos = (resumoAtual.gastosFixos || []).map((g) => ({
      id: `fixo_${g.id}`,
      descricao: g.descricao || "Gasto fixo",
      valor: Number(g.valor || 0),
      categoria: (g.categoria || "Sem categoria").trim(),
      _fixo: true,
    }));

    const tudo = [...despesasMes, ...fixos].filter((x) => Number(x.valor) > 0);

    const food = [];
    const transport = [];
    const other = [];

    // ✅ NOVO: estatística por “Categorias de Gastos” (taxonomia)
    const taxo = new Map(); // grupo -> Map(item -> total)
    const taxoCounts = new Map();

    tudo.forEach((t) => {
      if (isFood(t.descricao)) food.push(t);
      else if (isTransport(t.descricao)) transport.push(t);
      else other.push(t);

      const cls = classificarTaxonomia(t.descricao);
      const g = cls.grupo;
      const it = cls.item;

      if (!taxo.has(g)) taxo.set(g, new Map());
      const m = taxo.get(g);
      m.set(it, (m.get(it) || 0) + Number(t.valor || 0));

      const kCount = `${g}__${it}`;
      taxoCounts.set(kCount, (taxoCounts.get(kCount) || 0) + 1);
    });

    const sum = (arr) => arr.reduce((s, x) => s + Number(x.valor || 0), 0);

    const groupByDesc = (arr) => {
      const m = new Map();
      arr.forEach((t) => {
        const k = normalizarNome(t.descricao);
        const cur = m.get(k) || { descricao: t.descricao, total: 0, count: 0 };
        cur.total += Number(t.valor || 0);
        cur.count += 1;
        if ((!cur.descricao || cur.descricao === "Sem descrição") && t.descricao) {
          cur.descricao = t.descricao;
        }
        m.set(k, cur);
      });
      return Array.from(m.values()).sort((a, b) => b.total - a.total);
    };

    const foodByDesc = groupByDesc(food);
    const transportByDesc = groupByDesc(transport);

    const foodPorCategoria = { essencial: 0, lazer: 0, burrice: 0, investido: 0, outras: 0 };
    food.forEach((t) => {
      const c = String(t.categoria || "").toLowerCase();
      if (c === "essencial") foodPorCategoria.essencial += t.valor;
      else if (c === "lazer") foodPorCategoria.lazer += t.valor;
      else if (c === "burrice") foodPorCategoria.burrice += t.valor;
      else if (c === "investido") foodPorCategoria.investido += t.valor;
      else foodPorCategoria.outras += t.valor;
    });

    const totalPorCategoria = { essencial: 0, lazer: 0, burrice: 0, investido: 0, outras: 0 };
    tudo.forEach((t) => {
      const c = String(t.categoria || "").toLowerCase();
      if (c === "essencial") totalPorCategoria.essencial += t.valor;
      else if (c === "lazer") totalPorCategoria.lazer += t.valor;
      else if (c === "burrice") totalPorCategoria.burrice += t.valor;
      else if (c === "investido") totalPorCategoria.investido += t.valor;
      else totalPorCategoria.outras += t.valor;
    });

    // ✅ transforma taxonomia em arrays ordenados
    const taxoGroups = Array.from(taxo.entries()).map(([grupo, itemsMap]) => {
      const items = Array.from(itemsMap.entries())
        .map(([item, total]) => {
          const count = taxoCounts.get(`${grupo}__${item}`) || 0;
          return { item, total, count };
        })
        .sort((a, b) => b.total - a.total);

      const totalGrupo = items.reduce((s, x) => s + x.total, 0);
      return { grupo, totalGrupo, items };
    });

    // ordena grupos por total
    taxoGroups.sort((a, b) => b.totalGrupo - a.totalGrupo);

    return {
      totalMes: sum(tudo),
      totalFood: sum(food),
      totalTransport: sum(transport),
      totalOther: sum(other),
      foodByDesc,
      transportByDesc,
      foodPorCategoria,
      totalPorCategoria,
      taxoGroups,
    };
  }, [transacoes, mesReferencia, resumoAtual.gastosFixos]);

  /* --------- Lembretes compact (Hoje + próximos) --------- */
  const lembretesCompact = useMemo(() => {
    const now = new Date();
    const todayKey = toLocalDateKey(now);

    const items = listLembretes
      .map((i) => {
        if (i.tipo === "avulso") {
          if (i.done) return null;
          const dt = parseLocalDateTime(i.quando);
          if (!dt) return null;
          return { id: i.id, titulo: i.titulo, when: dt, tipo: "avulso" };
        }
        if (i.tipo === "recorrente") {
          if (i.enabled === false) return null;
          const dt = new Date(i.nextDueISO || "");
          if (Number.isNaN(dt.getTime())) return null;
          return { id: i.id, titulo: i.titulo, when: dt, tipo: "recorrente" };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => a.when.getTime() - b.when.getTime());

    const today = items.filter((x) => toLocalDateKey(x.when) === todayKey);
    const upcoming = items.filter((x) => x.when.getTime() > now.getTime()).slice(0, 2);

    // mini calendário: próximos 7 dias
    const days = [];
    for (let k = 0; k < 7; k++) {
      const d = new Date(now);
      d.setDate(d.getDate() + k);
      const key = toLocalDateKey(d);
      const count = items.filter((x) => toLocalDateKey(x.when) === key).length;
      days.push({ key, date: d, count });
    }

    return { today, upcoming, days };
  }, [listLembretes]);

  function goToLembretes() {
    // ajuste aqui se sua rota for diferente
    navigate("/lembretes");
  }

  return (
    <div className="page">
      <h2 className="page-title">Visão geral do mês</h2>

      {/* NAVEGAÇÃO DO MÊS */}
      <div className="card" style={{ textAlign: "center", marginBottom: 12 }}>
        <h3>
          {nomeMesArr[mesReferencia.mes]} / {mesReferencia.ano}
        </h3>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
          <button className="toggle-btn" onClick={() => mudarMesReferencia(-1)}>
            ◀ Mês anterior
          </button>

          <button className="toggle-btn toggle-active" onClick={irParaMesAtual}>
            ● Atual
          </button>

          <button className="toggle-btn" onClick={() => mudarMesReferencia(1)}>
            Próximo mês ▶
          </button>
        </div>
      </div>

      {/* ✅ BLOCO PRINCIPAL (SEM os textos que você mandou tirar) */}
      <div className="card resumo-card">
        <div className="resumo-top" style={{ gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="resumo-label">Salário</p>
            <p className="resumo-value">{salarioFixo ? formatCurrency(salarioFixo) : "—"}</p>
          </div>

          {/* ✅ DIA/PRÓXIMO (fica “na frente” do pendente visualmente, porque o pendente vem logo abaixo) */}
          <div className="pill" style={{ flexShrink: 0 }}>
            {diaPagamento ? (
              <>
                <span>Dia {diaPagamento}</span>
                {proximoPag && (
                  <span className="pill-sub">Próx. em {proximoPag.diasRestantes} dia(s)</span>
                )}
              </>
            ) : (
              <span>Sem dia</span>
            )}
          </div>
        </div>

        {/* ✅ mostra só “Sobrou/Faltou” (sem aquele texto grande) */}
        <div className="resumo-footer" style={{ marginTop: 6 }}>
          {resultadoSalario === null ? null : (
            <span
              className={
                "badge badge-pill " + (resultadoSalario >= 0 ? "badge-positive" : "badge-negative")
              }
            >
              {resultadoSalario >= 0 ? "Sobrou" : "Faltou"} {formatCurrency(Math.abs(resultadoSalario))}
            </span>
          )}
        </div>

        {/* ✅ pendente (SEM o texto explicativo que você mandou tirar) */}
        {pendenteAnterior > 0 && (
          <div style={{ marginTop: 10 }}>
            <span className="badge badge-pill badge-negative">
              Pendente do mês anterior: {formatCurrency(pendenteAnterior)}
            </span>
          </div>
        )}
      </div>

      {/* ✅ LEMBRETES COMPACT (clicável → vai pra página Lembretes) */}
      <div
        className="card mt"
        style={{ cursor: "pointer" }}
        onClick={goToLembretes}
        title="Clique para abrir Lembretes"
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
          <h3 style={{ margin: 0 }}>📌 Lembretes</h3>
          <div className="muted small">
            Hoje: <b>{lembretesCompact.today.length}</b>
          </div>
        </div>

        {/* mini calendário 7 dias */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginTop: 10 }}>
          {lembretesCompact.days.map((d) => (
            <div
              key={d.key}
              style={{
                border: "1px solid rgba(255,255,255,.08)",
                borderRadius: 10,
                padding: "8px 6px",
                textAlign: "center",
                lineHeight: 1.1,
              }}
            >
              <div style={{ fontWeight: 800 }}>{fmtDiaMesBR(d.date)}</div>
              <div className="muted small" style={{ marginTop: 4 }}>
                {d.count ? `${d.count}` : " "}
              </div>
            </div>
          ))}
        </div>

        {/* Hoje */}
        <div style={{ marginTop: 10 }}>
          {lembretesCompact.today.length === 0 ? (
            <div className="muted">Nada para hoje 🎉</div>
          ) : (
            <ul className="list" style={{ marginTop: 6 }}>
              {lembretesCompact.today.slice(0, 3).map((t) => (
                <li key={t.id} className="list-item">
                  <span>
                    {fmtDiaMesBR(t.when)} {fmtHoraBR(t.when)} — {t.titulo}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Próximos */}
        <div className="muted small" style={{ marginTop: 8 }}>
          Próximos:{" "}
          {lembretesCompact.upcoming.length === 0
            ? "—"
            : lembretesCompact.upcoming
                .map((x) => `${fmtDiaMesBR(x.when)} ${fmtHoraBR(x.when)} — ${x.titulo}`)
                .join(" • ")}
        </div>
      </div>

      {/* RECEITAS / DESPESAS / SALDO / CRÉDITO */}
      <div className="card mt">
        <div className="resumo-grid">
          <div>
            <p className="resumo-label">Receitas do mês</p>
            <p className="resumo-number positive">{formatCurrency(resumoAtual.receitas)}</p>
          </div>

          <div>
            <p className="resumo-label">Despesas do mês</p>
            <p className="resumo-number negative">{formatCurrency(resumoAtual.despesas)}</p>
          </div>

          <div>
            <p className="resumo-label">Saldo</p>
            <p className={"resumo-number " + (saldoComSalario >= 0 ? "positive" : "negative")}>
              {formatCurrency(saldoComSalario)}
            </p>
          </div>

          <div>
            <p className="resumo-label">Crédito usado</p>
            <p className="resumo-number negative">{formatCurrency(resumoAtual.gastosCartao)}</p>
          </div>
        </div>
      </div>

      {/* LIMITE */}
      <div className="card mt">
        <h3>Limite de gasto mensal</h3>

        {limiteGastoMensal ? (
          <>
            <p className="muted small">Limite: {formatCurrency(limiteGastoMensal)}</p>

            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${percLimite}%` }} />
            </div>

            <span className="progress-label">{percLimite.toFixed(0)}% utilizado</span>
          </>
        ) : (
          <p className="muted small">Defina seu limite na aba Perfil.</p>
        )}
      </div>

      {/* GASTOS FIXOS */}
      <div className="card mt">
        <h3>Gastos fixos</h3>

        {resumoAtual.gastosFixos.length === 0 ? (
          <p className="muted small">Nenhum gasto fixo marcado.</p>
        ) : (
          <ul className="list">
            {resumoAtual.gastosFixos.map((t) => (
              <li key={t.id} className="list-item">
                <span>{t.descricao}</span>
                <span>{formatCurrency(t.valor)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* TOP GASTOS */}
      <div className="card mt">
        <h3>Top 5 gastos</h3>

        {resumoAtual.topDespesas.length === 0 ? (
          <p className="muted">Nenhuma despesa ainda.</p>
        ) : (
          <ul className="list">
            {resumoAtual.topDespesas.map((t) => (
              <li key={t.id} className="list-item">
                <span>
                  {t.descricao}
                  {t.count > 1 ? <span className="muted small"> · {t.count}x</span> : null}
                </span>
                <span>{formatCurrency(t.valor)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* CATEGORIAS / SEMANAS */}
      <div className="grid-2 mt">
        <div
          className="card"
          onClick={() => setModalCategorias(true)}
          style={{ cursor: "pointer" }}
          title="Clique para ver detalhes"
        >
          <h3>Gasto por categoria</h3>

          <div className="pizza-chart-wrapper">
            <div className="pizza-chart" style={pizzaStyle} />
          </div>

          <div className="legend">
            <div className="legend-item">
              <span className="legend-color legend-essential" />
              Essencial ({resumoAtual.pEssencial.toFixed(0)}%)
            </div>
            <div className="legend-item">
              <span className="legend-color legend-leisure" />
              Lazer ({resumoAtual.pLazer.toFixed(0)}%)
            </div>

            <div className="legend-item">
              <span className="legend-color" style={{ background: "#F59E0B" }} />
              Burrice ({(resumoAtual.pBurrice || 0).toFixed(0)}%)
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ background: "#10B981" }} />
              Investido ({(resumoAtual.pInvestido || 0).toFixed(0)}%)
            </div>

            <p className="muted small" style={{ marginTop: 8 }}>
              (Clique para abrir detalhes)
            </p>
          </div>
        </div>

        <div className="card">
          <h3>Gastos por semana</h3>

          {/* ✅ NOVO: tira a “bolota/barra vertical” e usa barra horizontal compacta */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
            {resumoAtual.semanas.map((v, i) => {
              const pct = resumoAtual.maxSemana > 0 ? Math.min(100, (v / resumoAtual.maxSemana) * 100) : 0;

              return (
                <div
                  key={i}
                  style={{
                    border: "1px solid rgba(255,255,255,.08)",
                    borderRadius: 12,
                    padding: 10,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span className="muted small">Sem {i + 1}</span>
                    <span style={{ fontWeight: 800 подчерк: 0 }}>{formatCurrency(v)}</span>
                  </div>

                  <div
                    style={{
                      height: 8,
                      borderRadius: 999,
                      background: "rgba(255,255,255,.10)",
                      overflow: "hidden",
                      marginTop: 8,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.max(2, pct)}%`,
                        background: "rgba(143,163,255,.85)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="muted small" style={{ marginTop: 8 }}>
            (Os valores acima são o total gasto em cada semana do mês.)
          </p>
        </div>
      </div>

      {/* MODAL DETALHADO */}
      {modalCategorias && (
        <div className="modal-overlay" onClick={() => setModalCategorias(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Detalhes do mês</h3>
            <p className="muted small" style={{ marginTop: 4 }}>
              {reflect: ""}{nomeMes} / {mesReferencia.ano}
            </p>

            {/* ✅ NOVO: Estatística por “Categorias de Gastos” (automático) */}
            <div className="card" style={{ marginTop: 10 }}>
              <h4 style={{ marginBottom: 8 }}>CATEGORIAS DE GASTOS</h4>

              {detalhesCategorias.taxoGroups?.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {detalhesCategorias.taxoGroups.map((g) => (
                    <div
                      key={g.grupo}
                      style={{
                        border: "1px solid rgba(255,255,255,.08)",
                        borderRadius: 12,
                        padding: 10,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <b>{g.grupo}</b>
                        <b>{formatCurrency(g.totalGrupo)}</b>
                      </div>

                      <div className="muted small" style={{ marginTop: 6 }}>
                        {g.items.slice(0, 6).map((it, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 10,
                              padding: "4px 0",
                              borderTop: idx === 0 ? "none" : "1px dashed rgba(255,255,255,.10)",
                            }}
                          >
                            <span>
                              {it.item}
                              {it.count > 1 ? <span className="muted small"> · {it.count}x</span> : null}
                            </span>
                            <span>{formatCurrency(it.total)}</span>
                          </div>
                        ))}
                        {g.items.length > 6 ? (
                          <div className="muted small" style={{ marginTop: 6 }}>
                            (+{g.items.length - 6} itens)
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted small">Sem dados para classificar.</p>
              )}

              <p className="muted small" style={{ marginTop: 10 }}>
                (Isso separa automaticamente pelo nome/descrição e encaixa na opção mais parecida.)
              </p>
            </div>

            {/* ✅ MANTÉM as funções antigas do seu modal */}
            <div className="card" style={{ marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>
                  <b>Total de despesas</b>
                </span>
                <span>
                  <b>{formatCurrency(detalhesCategorias.totalMes)}</b>
                </span>
              </div>
              <p className="muted small" style={{ marginTop: 6 }}>
                (Inclui despesas do histórico + gastos fixos ativos)
              </p>
            </div>

            <div className="card" style={{ marginTop: 10 }}>
              <h4 style={{ marginBottom: 8 }}>🍔 Comida</h4>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>Total</span>
                <span>
                  <b>{formatCurrency(detalhesCategorias.totalFood)}</b>
                </span>
              </div>

              <p className="muted small" style={{ marginTop: 8 }}>
                Comida por categoria:
              </p>
              <ul className="list" style={{ marginTop: 6 }}>
                <li className="list-item">
                  <span>Essencial</span>
                  <span>{formatCurrency(detalhesCategorias.foodPorCategoria.essencial)}</span>
                </li>
                <li className="list-item">
                  <span>Lazer</span>
                  <span>{formatCurrency(detalhesCategorias.foodPorCategoria.lazer)}</span>
                </li>
                <li className="list-item">
                  <span>Burrice</span>
                  <span>{formatCurrency(detalhesCategorias.foodPorCategoria.burrice)}</span>
                </li>
                <li className="list-item">
                  <span>Investido</span>
                  <span>{formatCurrency(detalhesCategorias.foodPorCategoria.investido)}</span>
                </li>
                {detalhesCategorias.foodPorCategoria.outras > 0 && (
                  <li className="list-item">
                    <span>Outras</span>
                    <span>{formatCurrency(detalhesCategorias.foodPorCategoria.outras)}</span>
                  </li>
                )}
              </ul>

              <p className="muted small" style={{ marginTop: 10 }}>
                Itens de comida (somados):
              </p>
              {detalhesCategorias.foodByDesc.length === 0 ? (
                <p className="muted small">Nenhum gasto de comida encontrado.</p>
              ) : (
                <ul className="list" style={{ marginTop: 6 }}>
                  {detalhesCategorias.foodByDesc.map((x, idx) => (
                    <li key={idx} className="list-item">
                      <span>
                        {x.descricao}
                        {x.count > 1 ? <span className="muted small"> · {x.count}x</span> : null}
                      </span>
                      <span>{formatCurrency(x.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card" style={{ marginTop: 10 }}>
              <h4 style={{ marginBottom: 8 }}>🚗 Transporte</h4>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>Total</span>
                <span>
                  <b>{formatCurrency(detalhesCategorias.totalTransport)}</b>
                </span>
              </div>

              <p className="muted small" style={{ marginTop: 10 }}>
                Itens de transporte (somados):
              </p>
              {detalhesCategorias.transportByDesc.length === 0 ? (
                <p className="muted small">Nenhum gasto de transporte encontrado.</p>
              ) : (
                <ul className="list" style={{ marginTop: 6 }}>
                  {detalhesCategorias.transportByDesc.map((x, idx) => (
                    <li key={idx} className="list-item">
                      <span>
                        {x.descricao}
                        {x.count > 1 ? <span className="muted small"> · {x.count}x</span> : null}
                      </span>
                      <span>{formatCurrency(x.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card" style={{ marginTop: 10 }}>
              <h4 style={{ marginBottom: 8 }}>📌 Total por categoria</h4>
              <ul className="list">
                <li className="list-item">
                  <span>Essencial</span>
                  <span>{formatCurrency(detalhesCategorias.totalPorCategoria.essencial)}</span>
                </li>
                <li className="list-item">
                  <span>Lazer</span>
                  <span>{formatCurrency(detalhesCategorias.totalPorCategoria.lazer)}</span>
                </li>
                <li className="list-item">
                  <span>Burrice</span>
                  <span>{formatCurrency(detalhesCategorias.totalPorCategoria.burrice)}</span>
                </li>
                <li className="list-item">
                  <span>Investido</span>
                  <span>{formatCurrency(detalhesCategorias.totalPorCategoria.investido)}</span>
                </li>
                {detalhesCategorias.totalPorCategoria.outras > 0 && (
                  <li className="list-item">
                    <span>Outras</span>
                    <span>{formatCurrency(detalhesCategorias.totalPorCategoria.outras)}</span>
                  </li>
                )}
              </ul>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button className="toggle-btn" type="button" onClick={() => setModalCategorias(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
