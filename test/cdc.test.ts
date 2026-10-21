// Seam 1: the CDC (Lei 8.078/1990) built from its manifest alone and the recorded compiled Planalto page: a
// hand-verified golden set, structural invariants and a full-text snapshot.
// Every expected value was read from the raw HTML of fixtures/2026-10-20/planalto/l8078compilado.htm (labels, text,
// annotations and their links), never produced by the parser. Whitespace is collapsed as a browser shows it.
import { beforeAll, describe, expect, it } from "vitest";
import { cdc } from "../src/norms/cdc.ts";
import { build } from "../src/pipeline/build.ts";
import { datasetFiles } from "../src/pipeline/files.ts";
import type { Dataset } from "../src/schema/dataset.ts";
import { recordedSource } from "../src/sources/recorded.ts";

const fixtures = new URL("../fixtures/2026-10-20/", import.meta.url);
const page = "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm";

/** An official page linked from an annotation, relative to Planalto's ccivil_03 root. */
const lei = (path: string) => `https://www.planalto.gov.br/ccivil_03/${path}`;

const l14181 = {
  effect: "inserted",
  annotation: "Incluído pela Lei nº 14.181, de 2021",
  act: { type: "lei", number: "14.181", year: 2021, href: lei("_Ato2019-2022/2021/Lei/L14181.htm#art1") },
};

const titulo = (n: string) => ({ kind: "titulo", label: `Título ${n}` });
const capitulo = (n: string) => ({ kind: "capitulo", label: `Capítulo ${n}` });
const secao = (n: string) => ({ kind: "secao", label: `Seção ${n}` });
const paragrafo = (label: string) => ({ kind: "paragrafo", label });
const inciso = (label: string) => ({ kind: "inciso", label: `inciso ${label}` });
const alinea = (label: string) => ({ kind: "alinea", label: `alínea ${label}` });
const artigo = (label: string) => ({ kind: "artigo", label });
const caput = { kind: "caput", label: "caput" };

interface Golden {
  id: string;
  /** Why this one is in the set. */
  why: string;
  expected: Record<string, unknown>;
}

const golden: Golden[] = [
  {
    id: "art1_cpt",
    why: "\"Art. 1°\" with a degree sign",
    expected: {
      kind: "caput",
      path: [titulo("I"), capitulo("I"), artigo("Art. 1º"), caput],
      text: "O presente código estabelece normas de proteção e defesa do consumidor, de ordem pública e interesse social, nos termos dos arts. 5°, inciso XXXII, 170, inciso V, da Constituição Federal e art. 48 de suas Disposições Transitórias.",
      status: "in_force",
      amendments: [],
      references: [],
    },
  },
  {
    id: "art63_cpt",
    why: "a \"Pena -\" line is the caput's sanction, not a dispositivo (LexML <Pena>): kept on its own line",
    expected: {
      path: [titulo("II"), artigo("Art. 63"), caput],
      text: "Omitir dizeres ou sinais ostensivos sobre a nocividade ou periculosidade de produtos, nas embalagens, nos invólucros, recipientes ou publicidade:\nPena - Detenção de seis meses a dois anos e multa.",
    },
  },
  {
    id: "art63_par2",
    why: "a \"Pena\" line with no dash belongs to the paragraph above it",
    expected: {
      label: "§ 2º",
      text: "Se o crime é culposo:\nPena Detenção de um a seis meses ou multa.",
    },
  },
  {
    id: "art64_par1",
    why: "the parágrafo único after a caput with its Pena line",
    expected: {
      text: "Incorrerá nas mesmas penas quem deixar de retirar do mercado, imediatamente quando determinado pela autoridade competente, os produtos nocivos ou perigosos, na forma deste artigo.",
    },
  },
  {
    id: "art110_cpt",
    why: "a quoted inciso of another law (Lei 7.347/1985) is part of the commanding caput, not a CDC inciso",
    expected: {
      path: [titulo("VI"), artigo("Art. 110"), caput],
      text: 'Acrescente-se o seguinte inciso IV ao art. 1° da Lei n° 7.347, de 24 de julho de 1985:\n"IV - a qualquer outro interesse difuso ou coletivo".',
      references: [],
    },
  },
  {
    id: "art113_cpt",
    why: "a quote over three blocks; the middle ones (\"§ 5.°\", \"§ 6°\") open with no quote mark",
    expected: {
      text: 'Acrescente-se os seguintes §§ 4°, 5° e 6° ao art. 5º. da Lei n.° 7.347, de 24 de julho de 1985:\n"§ 4.° O requisito da pré-constituição poderá ser dispensado pelo juiz, quando haja manifesto interesse social evidenciado pela dimensão ou característica do dano, ou pela relevância do bem jurídico a ser protegido.\n§ 5.° Admitir-se-á o litisconsórcio facultativo entre os Ministérios Públicos da União, do Distrito Federal e dos Estados na defesa dos interesses e direitos de que cuida esta lei.\n§ 6° Os órgãos públicos legitimados poderão tomar dos interessados compromisso de ajustamento de sua conduta às exigências legais, mediante combinações, que terá eficácia de título executivo extrajudicial".',
    },
  },
  {
    id: "art115_cpt",
    why: "curly quotes around a quoted article",
    expected: {
      text: "Suprima-se o caput do art. 17 da Lei n° 7.347, de 24 de julho de 1985, passando o parágrafo único a constituir o caput, com a seguinte redação:\n“Art. 17. Em caso de litigância de má-fé, a associação autora e os diretores responsáveis pela propositura da ação serão solidariamente condenados em honorários advocatícios e ao décuplo das custas, sem prejuízo da responsabilidade por perdas e danos”.",
    },
  },
  {
    id: "art116_cpt",
    why: "a quoted \"Art. 18.\" must not open a CDC article 18",
    expected: {
      text: 'Dê-se a seguinte redação ao art. 18 da Lei n° 7.347, de 24 de julho de 1985:\n"Art. 18. Nas ações de que trata esta lei, não haverá adiantamento de custas, emolumentos, honorários periciais e quaisquer outras despesas, nem condenação da associação autora, salvo comprovada má-fé, em honorários de advogado, custas e despesas processuais".',
    },
  },
  {
    id: "art118_cpt",
    why: "the article right after the quotes is a CDC article again",
    expected: { text: "Este código entrará em vigor dentro de cento e oitenta dias a contar de sua publicação." },
  },
  {
    id: "art8_par1",
    why: "\"§ 1<s>º</s>\": the ordinal inside <s> is formatting; the label is normalised and the text intact",
    expected: {
      label: "§ 1º",
      text: "Em se tratando de produto industrial, ao fabricante cabe prestar as informações a que se refere este artigo, através de impressos apropriados que devam acompanhar o produto.",
      amendments: [
        {
          effect: "wording",
          annotation: "Redação dada pela Lei nº 13.486, de 2017",
          act: { type: "lei", number: "13.486", year: 2017, href: lei("_Ato2015-2018/2017/Lei/L13486.htm") },
        },
      ],
    },
  },
  {
    id: "art39_cpt_inc11",
    why: "kept only as a note that its content became inciso XIII: no wording, status renumbered, the note as metadata",
    expected: {
      label: "inciso XI",
      text: "",
      status: "renumbered",
      amendments: [
        {
          effect: "renumbered",
          annotation:
            "Dispositivo incluído pela MPV nº 1.890-67, de 22.10.1999, transformado em inciso XIII, quando da conversão na Lei nº 9.870, de 23.11.1999",
          act: { type: "medida_provisoria", number: "1.890-67", year: 1999, href: lei("MPV/Antigas/1890-67.htm#art9") },
        },
      ],
    },
  },
  {
    id: "art52_par1",
    why: "an act dated with an ordinal day (\"de 1º.8.1996\")",
    expected: {
      amendments: [
        {
          effect: "wording",
          annotation: "Redação dada pela Lei nº 9.298, de 1º.8.1996",
          // The page links "L9298.htm#art52§1"; resolved as a browser does, the "§" is percent-encoded.
          act: { type: "lei", number: "9.298", year: 1996, href: lei("leis/L9298.htm#art52%C2%A71") },
        },
      ],
    },
  },
  {
    id: "art54_par3",
    why: "\"§ 3o\" with a letter o; the annotation omits the act type (\"pela nº 11.785\"), its link says it is a Lei",
    expected: {
      label: "§ 3º",
      text: "Os contratos de adesão escritos serão redigidos em termos claros e com caracteres ostensivos e legíveis, cujo tamanho da fonte não será inferior ao corpo doze, de modo a facilitar sua compreensão pelo consumidor.",
      amendments: [
        {
          effect: "wording",
          annotation: "Redação dada pela nº 11.785, de 2008",
          act: { type: "lei", number: "11.785", year: 2008, href: lei("_Ato2007-2010/2008/Lei/L11785.htm#art1") },
        },
      ],
    },
  },
  {
    id: "art57_par1",
    why: "reworded by a Medida Provisória (provisional until converted; no status for that in v1)",
    expected: {
      status: "in_force",
      amendments: [
        {
          effect: "wording",
          annotation: "Redação dada pela Medida Provisória nº 1.393, de 2026",
          act: { type: "medida_provisoria", number: "1.393", year: 2026, href: lei("_ato2023-2026/2026/mpv/mpv1393.htm#art4") },
        },
      ],
    },
  },
  {
    id: "art2_par1",
    why: "parágrafo único is par1",
    expected: {
      kind: "paragrafo",
      label: "parágrafo único",
      path: [titulo("I"), capitulo("I"), artigo("Art. 2º"), paragrafo("parágrafo único")],
      text: "Equipara-se a consumidor a coletividade de pessoas, ainda que indetermináveis, que haja intervindo nas relações de consumo.",
    },
  },
  {
    id: "art3_par2",
    why: "\"§ 2°\" with a degree sign",
    expected: {
      label: "§ 2º",
      text: "Serviço é qualquer atividade fornecida no mercado de consumo, mediante remuneração, inclusive as de natureza bancária, financeira, de crédito e securitária, salvo as decorrentes das relações de caráter trabalhista.",
    },
  },
  {
    id: "art4_cpt",
    why: "\"Art. 4º\" with a true ordinal; reworded by a Lei dated \"21.3.1995\"",
    expected: {
      path: [titulo("I"), capitulo("II"), artigo("Art. 4º"), caput],
      text: "A Política Nacional das Relações de Consumo tem por objetivo o atendimento das necessidades dos consumidores, o respeito à sua dignidade, saúde e segurança, a proteção de seus interesses econômicos, a melhoria da sua qualidade de vida, bem como a transparência e harmonia das relações de consumo, atendidos os seguintes princípios:",
      amendments: [
        {
          effect: "wording",
          annotation: "Redação dada pela Lei nº 9.008, de 21.3.1995",
          act: { type: "lei", number: "9.008", year: 1995, href: lei("leis/L9008.htm#art7") },
        },
      ],
    },
  },
  {
    id: "art4_cpt_inc2_ali4",
    why: "alínea under an inciso of the caput",
    expected: {
      kind: "alinea",
      path: [titulo("I"), capitulo("II"), artigo("Art. 4º"), inciso("II"), alinea("d")],
      text: "pela garantia dos produtos e serviços com padrões adequados de qualidade, segurança, durabilidade e desempenho.",
    },
  },
  {
    id: "art4_cpt_inc8",
    why: "verbatim, including the period the page leaves before the incisos inserted after it",
    expected: { text: "estudo constante das modificações do mercado de consumo." },
  },
  {
    id: "art4_cpt_inc9",
    why: "inserted by Lei 14.181/2021 (superendividamento)",
    expected: {
      text: "fomento de ações direcionadas à educação financeira e ambiental dos consumidores;",
      amendments: [l14181],
    },
  },
  {
    id: "art5_par1",
    why: "vetoed paragraph: the page's own marker, status vetoed",
    expected: { label: "§ 1º", text: "(Vetado).", status: "vetoed", amendments: [] },
  },
  {
    id: "art6_cpt_inc3",
    why: "a wording annotation, then a bare \"Vigência\" link",
    expected: {
      path: [titulo("I"), capitulo("III"), artigo("Art. 6º"), inciso("III")],
      text: "a informação adequada e clara sobre os diferentes produtos e serviços, com especificação correta de quantidade, características, composição, qualidade, tributos incidentes e preço, bem como sobre os riscos que apresentem;",
      amendments: [
        {
          effect: "wording",
          annotation: "Redação dada pela Lei nº 12.741, de 2012",
          act: { type: "lei", number: "12.741", year: 2012, href: lei("_Ato2011-2014/2012/Lei/L12741.htm#art3") },
        },
      ],
      references: [{ kind: "vigencia", annotation: "Vigência", href: lei("_Ato2011-2014/2012/Lei/L12741.htm#art6") }],
    },
  },
  {
    id: "art6_cpt_inc9",
    why: "vetoed inciso ending in a semicolon",
    expected: { label: "inciso IX", text: "(Vetado);", status: "vetoed" },
  },
  {
    id: "art6_par1",
    why: "\"(Vigência)\" after an insertion is a historical pointer, not a pending change",
    expected: {
      text: "A informação de que trata o inciso III do caput deste artigo deve ser acessível à pessoa com deficiência, observado o disposto em regulamento.",
      status: "in_force",
      amendments: [
        {
          effect: "inserted",
          annotation: "Incluído pela Lei nº 13.146, de 2015",
          act: { type: "lei", number: "13.146", year: 2015, href: lei("_Ato2015-2018/2015/Lei/L13146.htm#art100") },
        },
      ],
      references: [{ kind: "vigencia", annotation: "Vigência", href: lei("_Ato2015-2018/2015/Lei/L13146.htm#art127") }],
    },
  },
  {
    id: "art11_cpt",
    why: "a whole article vetoed",
    expected: { path: [titulo("I"), capitulo("IV"), secao("I"), artigo("Art. 11"), caput], text: "(Vetado).", status: "vetoed" },
  },
  {
    id: "art12_cpt",
    why: "\"SEÇÃO II\" in upper case is a Seção",
    expected: {
      path: [titulo("I"), capitulo("IV"), secao("II"), artigo("Art. 12"), caput],
      text: "O fabricante, o produtor, o construtor, nacional ou estrangeiro, e o importador respondem, independentemente da existência de culpa, pela reparação dos danos causados aos consumidores por defeitos decorrentes de projeto, fabricação, construção, montagem, fórmulas, manipulação, apresentação ou acondicionamento de seus produtos, bem como por informações insuficientes ou inadequadas sobre sua utilização e riscos.",
    },
  },
  {
    id: "art14_cpt",
    why: "a much-cited article (service providers' strict liability)",
    expected: {
      text: "O fornecedor de serviços responde, independentemente da existência de culpa, pela reparação dos danos causados aos consumidores por defeitos relativos à prestação dos serviços, bem como por informações insuficientes ou inadequadas sobre sua fruição e riscos.",
    },
  },
  {
    id: "art18_cpt",
    why: "verbatim even where the page reads oddly (\"com a indicações\"; LEGIN has \"as\")",
    expected: {
      path: [titulo("I"), capitulo("IV"), secao("III"), artigo("Art. 18"), caput],
      text: "Os fornecedores de produtos de consumo duráveis ou não duráveis respondem solidariamente pelos vícios de qualidade ou quantidade que os tornem impróprios ou inadequados ao consumo a que se destinam ou lhes diminuam o valor, assim como por aqueles decorrentes da disparidade, com a indicações constantes do recipiente, da embalagem, rotulagem ou mensagem publicitária, respeitadas as variações decorrentes de sua natureza, podendo o consumidor exigir a substituição das partes viciadas.",
    },
  },
  {
    id: "art26_par2_inc2",
    why: "a vetoed inciso of a paragraph (no _cpt)",
    expected: {
      path: [titulo("I"), capitulo("IV"), secao("IV"), artigo("Art. 26"), paragrafo("§ 2º"), inciso("II")],
      text: "(Vetado).",
      status: "vetoed",
    },
  },
  {
    id: "art26_par2_inc3",
    why: "the inciso after a vetoed one",
    expected: { text: "a instauração de inquérito civil, até seu encerramento." },
  },
  {
    id: "art33_par1",
    why: "a period after the annotation's parenthesis (\"…origina. (Incluído pela …).\")",
    expected: {
      text: "É proibida a publicidade de bens e serviços por telefone, quando a chamada for onerosa ao consumidor que a origina.",
      amendments: [{ effect: "inserted", annotation: "Incluído pela Lei nº 11.800, de 2008", act: { type: "lei", number: "11.800", year: 2008 } }],
    },
  },
  {
    id: "art39_cpt",
    why: "reworded by a Lei dated \"11.6.1994\"",
    expected: {
      text: "É vedado ao fornecedor de produtos ou serviços, dentre outras práticas abusivas:",
      amendments: [
        {
          effect: "wording",
          annotation: "Redação dada pela Lei nº 8.884, de 11.6.1994",
          act: { type: "lei", number: "8.884", year: 1994, href: lei("leis/L8884.htm#art39") },
        },
      ],
    },
  },
  {
    id: "art39_cpt_inc13",
    why: "the inciso art. 39 XI's content became",
    expected: {
      text: "aplicar fórmula ou índice de reajuste diverso do legal ou contratualmente estabelecido.",
      amendments: [{ effect: "inserted", annotation: "Incluído pela Lei nº 9.870, de 23.11.1999", act: { type: "lei", number: "9.870", year: 1999 } }],
    },
  },
  {
    id: "art42-1_cpt",
    why: "Art. 42-A is art42-1; an en dash in the text survives",
    expected: {
      path: [titulo("I"), capitulo("V"), secao("V"), artigo("Art. 42-A"), caput],
      text: "Em todos os documentos de cobrança de débitos apresentados ao consumidor, deverão constar o nome, o endereço e o número de inscrição no Cadastro de Pessoas Físicas – CPF ou no Cadastro Nacional de Pessoa Jurídica – CNPJ do fornecedor do produto ou serviço correspondente.",
      amendments: [
        {
          effect: "inserted",
          annotation: "Incluído pela Lei nº 12.039, de 2009",
          act: { type: "lei", number: "12.039", year: 2009, href: lei("_Ato2007-2010/2009/Lei/L12039.htm") },
        },
      ],
    },
  },
  {
    id: "art43_par6",
    why: "\"§ 6o\" with a letter o; the link opens before the annotation's parenthesis",
    expected: {
      label: "§ 6º",
      path: [titulo("I"), capitulo("V"), secao("VI"), artigo("Art. 43"), paragrafo("§ 6º")],
      text: "Todas as informações de que trata o caput deste artigo devem ser disponibilizadas em formatos acessíveis, inclusive para a pessoa com deficiência, mediante solicitação do consumidor.",
      amendments: [{ effect: "inserted", annotation: "Incluído pela Lei nº 13.146, de 2015", act: { type: "lei", number: "13.146", year: 2015 } }],
      references: [{ kind: "vigencia", annotation: "Vigência" }],
    },
  },
  {
    id: "art49_cpt",
    why: "a much-cited article (direito de arrependimento)",
    expected: {
      path: [titulo("I"), capitulo("VI"), secao("I"), artigo("Art. 49"), caput],
      text: "O consumidor pode desistir do contrato, no prazo de 7 dias a contar de sua assinatura ou do ato de recebimento do produto ou serviço, sempre que a contratação de fornecimento de produtos e serviços ocorrer fora do estabelecimento comercial, especialmente por telefone ou a domicílio.",
    },
  },
  {
    id: "art49_par1",
    why: "its parágrafo único",
    expected: {
      text: "Se o consumidor exercitar o direito de arrependimento previsto neste artigo, os valores eventualmente pagos, a qualquer título, durante o prazo de reflexão, serão devolvidos, de imediato, monetariamente atualizados.",
    },
  },
  {
    id: "art51_cpt_inc1",
    why: "an inciso with a sentence break inside it",
    expected: {
      path: [titulo("I"), capitulo("VI"), secao("II"), artigo("Art. 51"), inciso("I")],
      text: "impossibilitem, exonerem ou atenuem a responsabilidade do fornecedor por vícios de qualquer natureza dos produtos e serviços ou impliquem renúncia ou disposição de direitos. Nas relações de consumo entre o fornecedor e o consumidor pessoa jurídica, a indenização poderá ser limitada, em situações justificáveis;",
    },
  },
  {
    id: "art51_cpt_inc19",
    why: "\"(VETADO).\" on an inciso a later law inserted: vetoed, the insertion still recorded",
    expected: { text: "(VETADO).", status: "vetoed", amendments: [l14181] },
  },
  {
    id: "art51_par1_inc1",
    why: "an inciso of a paragraph",
    expected: {
      path: [titulo("I"), capitulo("VI"), secao("II"), artigo("Art. 51"), paragrafo("§ 1º"), inciso("I")],
      text: "ofende os princípios fundamentais do sistema jurídico a que pertence;",
    },
  },
  {
    id: "art54-1_cpt",
    why: "Art. 54-A under \"CAPÍTULO VI-A\" (cap6-1 in LexML terms)",
    expected: {
      path: [titulo("I"), capitulo("VI-A"), artigo("Art. 54-A"), caput],
      text: "Este Capítulo dispõe sobre a prevenção do superendividamento da pessoa natural, sobre o crédito responsável e sobre a educação financeira do consumidor.",
      amendments: [l14181],
    },
  },
  {
    id: "art54-1_par1",
    why: "\"§ 1º\" in the newer text, with a true ordinal",
    expected: {
      label: "§ 1º",
      text: "Entende-se por superendividamento a impossibilidade manifesta de o consumidor pessoa natural, de boa-fé, pagar a totalidade de suas dívidas de consumo, exigíveis e vincendas, sem comprometer seu mínimo existencial, nos termos da regulamentação.",
      amendments: [l14181],
    },
  },
  {
    id: "art54-5_cpt",
    why: "a whole article inserted and vetoed in the same law: \"Art. 54-E. (VETADO). (Incluído pela …)\"",
    expected: { path: [titulo("I"), capitulo("VI-A"), artigo("Art. 54-E"), caput], text: "(VETADO).", status: "vetoed", amendments: [l14181] },
  },
  {
    id: "art54-6_cpt_inc1",
    why: "an inciso of a lettered article",
    expected: {
      label: "inciso I",
      text: "recorrer aos serviços do fornecedor de produto ou serviço para a preparação ou a conclusão do contrato de crédito;",
      amendments: [l14181],
    },
  },
  {
    id: "art57_par2",
    why: "inserted by the same Medida Provisória",
    expected: {
      amendments: [
        {
          effect: "inserted",
          annotation: "Incluído pela Medida Provisória nº 1.393, de 2026",
          act: { type: "medida_provisoria", number: "1.393", year: 2026, href: lei("_ato2023-2026/2026/mpv/mpv1393.htm#art4") },
        },
      ],
    },
  },
  {
    id: "art60_par2",
    why: "\"§ 2° (Vetado)\" with no final period",
    expected: { text: "(Vetado)", status: "vetoed" },
  },
  {
    id: "art65_par1",
    why: "the paragraph after a dashless Pena line is a dispositivo again",
    expected: {
      text: "As penas deste artigo são aplicáveis sem prejuízo das correspondentes à lesão corporal e à morte.",
      amendments: [
        {
          effect: "wording",
          annotation: "Redação dada pela Lei nº 13.425, de 2017",
          act: { type: "lei", number: "13.425", year: 2017, href: lei("_Ato2015-2018/2017/Lei/L13425.htm#art18") },
        },
      ],
    },
  },
  {
    id: "art66_par2",
    why: "the page's semicolon before the Pena line is kept",
    expected: { text: "Se o crime é culposo;\nPena Detenção de um a seis meses ou multa." },
  },
  {
    id: "art68_cpt",
    why: "a Pena line ending in a colon",
    expected: {
      text: "Fazer ou promover publicidade que sabe ou deveria saber ser capaz de induzir o consumidor a se comportar de forma prejudicial ou perigosa a sua saúde ou segurança:\nPena - Detenção de seis meses a dois anos e multa:",
    },
  },
  {
    id: "art74_cpt",
    why: "the last article with a Pena line",
    expected: {
      text: "Deixar de entregar ao consumidor o termo de garantia adequadamente preenchido e com especificação clara de seu conteúdo;\nPena Detenção de um a seis meses ou multa.",
    },
  },
  {
    id: "art76_cpt_inc4_ali1",
    why: "alínea of art. 76 IV",
    expected: {
      path: [titulo("II"), artigo("Art. 76"), inciso("IV"), alinea("a")],
      text: "por servidor público, ou por pessoa cuja condição econômico-social seja manifestamente superior à da vítima;",
    },
  },
  {
    id: "art76_cpt_inc5",
    why: "verbatim, the space before the final period included",
    expected: { text: "serem praticados em operações que envolvam alimentos, medicamentos ou quaisquer outros produtos ou serviços essenciais ." },
  },
  {
    id: "art78_cpt",
    why: "verbatim, the page's \"odisposto\" included",
    expected: {
      text: "Além das penas privativas de liberdade e de multa, podem ser impostas, cumulativa ou alternadamente, observado odisposto nos arts. 44 a 47, do Código Penal:",
    },
  },
  {
    id: "art79_par1_ali1",
    why: "alínea directly under a parágrafo único (no inciso)",
    expected: {
      kind: "alinea",
      path: [titulo("II"), artigo("Art. 79"), paragrafo("parágrafo único"), alinea("a")],
      text: "reduzida até a metade do seu valor mínimo;",
    },
  },
  {
    id: "art81_par1_inc3",
    why: "inciso under a parágrafo único",
    expected: {
      path: [titulo("III"), capitulo("I"), artigo("Art. 81"), paragrafo("parágrafo único"), inciso("III")],
      text: "interesses ou direitos individuais homogêneos, assim entendidos os decorrentes de origem comum.",
    },
  },
  {
    id: "art104-1_par5",
    why: "a paragraph of Art. 104-A under \"CAPÍTULO V\" of Título III",
    expected: {
      path: [titulo("III"), capitulo("V"), artigo("Art. 104-A"), paragrafo("§ 5º")],
      text: "O pedido do consumidor a que se refere o caput deste artigo não importará em declaração de insolvência civil e poderá ser repetido somente após decorrido o prazo de 2 (dois) anos, contado da liquidação das obrigações previstas no plano de pagamento homologado, sem prejuízo de eventual repactuação.",
      amendments: [l14181],
    },
  },
  {
    id: "art104-3_par2",
    why: "the last lettered article's last paragraph",
    expected: {
      path: [titulo("III"), capitulo("V"), artigo("Art. 104-C"), paragrafo("§ 2º")],
      text: "O acordo firmado perante os órgãos públicos de defesa do consumidor, em caso de superendividamento do consumidor pessoa natural, incluirá a data a partir da qual será providenciada a exclusão do consumidor de bancos de dados e de cadastros de inadimplentes, bem como o condicionamento de seus efeitos à abstenção, pelo consumidor, de condutas que importem no agravamento de sua situação de superendividamento, especialmente a de contrair novas dívidas.",
    },
  },
  {
    id: "art106_cpt_inc12",
    why: "\"XII - (Vetado)\" with no punctuation",
    expected: { path: [titulo("IV"), artigo("Art. 106"), inciso("XII")], text: "(Vetado)", status: "vetoed" },
  },
  {
    id: "art107_par1",
    why: "Título V",
    expected: {
      path: [titulo("V"), artigo("Art. 107"), paragrafo("§ 1º")],
      text: "A convenção tornar-se-á obrigatória a partir do registro do instrumento no cartório de títulos e documentos.",
    },
  },
  {
    id: "art119_cpt",
    why: "the last article; the closing formula and signatures after it are not text",
    expected: { path: [titulo("VI"), artigo("Art. 119"), caput], text: "Revogam-se as disposições em contrário." },
  },
];

describe("CDC golden set", () => {
  let dataset: Dataset;

  beforeAll(async () => {
    dataset = await build({ manifests: [cdc], source: await recordedSource(fixtures), datasetVersion: "golden" });
  });

  it("holds about 50 hand-verified dispositivos", () => {
    expect(golden.length).toBeGreaterThanOrEqual(50);
  });

  it.each(golden)("$id: $why", ({ id, expected }) => {
    const found = dataset.provisions.find((p) => p.norm === "cdc" && p.id === id);
    expect(found, `${id} missing`).toBeDefined();
    expect(found).toMatchObject({ ...expected, provenance: { sourceUrl: page, retrievedAt: "2026-10-20" } });
  });
});

describe("CDC structural invariants", () => {
  let dataset: Dataset;
  const count = (kind: string) => dataset.provisions.filter((p) => p.kind === kind).length;
  const withStatus = (status: string) => dataset.provisions.filter((p) => p.status === status).map((p) => p.id);

  beforeAll(async () => {
    dataset = await build({ manifests: [cdc], source: await recordedSource(fixtures), datasetVersion: "invariants" });
  });

  it("numbers siblings monotonically, letter suffixes after their base (54, 54-A … 54-G, 55)", () => {
    const last = new Map<string, number[]>();
    for (const { id } of dataset.provisions) {
      const parts = id.split("_");
      for (let depth = 0; depth < parts.length; depth++) {
        const part = parts[depth]!;
        if (part === "cpt") continue;
        const kind = part.replace(/[\d-]+$/, "");
        const numbers = part.slice(kind.length).split("-").map(Number);
        const key = `${parts.slice(0, depth).join("_")}|${kind}`;
        const previous = last.get(key);
        if (previous && compare(previous, numbers) > 0) throw new Error(`${id} comes after ${kind}${previous.join("-")} under "${key}"`);
        last.set(key, numbers);
      }
    }
  });

  it("counts exactly the dispositivos the page prints", () => {
    // Hand counts on the page's blocks: 130 articles (119 + 11 lettered: 42-A, 54-A…54-G, 104-A…104-C); 157 blocks open
    // with "§" or "Parágrafo único", 2 of them inside art. 113's quote of Lei 7.347; 179 incisos and 8 alíneas, none
    // of them quoted; no itens.
    expect(count("caput")).toBe(130);
    expect(count("paragrafo")).toBe(155);
    expect(count("inciso")).toBe(179);
    expect(count("alinea")).toBe(8);
    expect(count("item")).toBe(0);
  });

  it("keeps every vetoed dispositivo with its id, and the one renumbered note; nothing is revoked", () => {
    // The page has 38 "(Vetado" and 4 "(VETADO" marks, each the whole wording of one dispositivo, and no revocation.
    expect(withStatus("vetoed")).toHaveLength(42);
    expect(withStatus("revoked")).toEqual([]);
    expect(withStatus("renumbered")).toEqual(["art39_cpt_inc11"]);
    for (const p of dataset.provisions.filter((p) => p.status === "vetoed")) expect(p.text, p.id).toMatch(/^\((Vetado|VETADO)\)[.;]?$/);
  });

  it("joins each of the page's 14 Pena lines to the dispositivo above it, never minting one", () => {
    const penas = dataset.provisions.filter((p) => /\nPena\b/.test(p.text)).map((p) => p.id);
    expect(penas).toHaveLength(14);
    expect(penas.every((id) => /^art(6[3-9]|7[0-4])_/.test(id))).toBe(true);
    expect(dataset.provisions.filter((p) => /^Pena\b/.test(p.text))).toEqual([]);
  });

  it("folds the Lei 7.347 dispositivos quoted by arts. 110–117 into their caputs", () => {
    const quoting = dataset.provisions.filter((p) => /^art11[0-7]_/.test(p.id));
    expect(quoting.map((p) => p.id)).toEqual(["art110_cpt", "art111_cpt", "art112_cpt", "art113_cpt", "art114_cpt", "art115_cpt", "art116_cpt", "art117_cpt"]);
    // The 8 quotes open with " or “ and close with ". or ”.
    for (const p of quoting) expect(p.text, p.id).toMatch(/:\n["“][\s\S]*["”]\.$/);
  });

  it("leaves no annotation, entity or struck-text residue in any text", () => {
    const residue =
      /\((?:Redação dada|Incluíd|Revogad[oa]s? pel|Vide|Vigência|Produção de efeito|Renumerad)|\bVide\s|Incluíd[oa] pel[oa]|&#|&nbsp|&quot|�||, ,|[ \t]{2}|\s\n|\n\s|^\s|\s$/i;
    expect(dataset.provisions.filter((p) => residue.test(p.text)).map((p) => `${p.id}: ${p.text}`)).toEqual([]);
  });

  it("recognises the amending act of every amendment annotation: Leis and Medidas Provisórias", () => {
    const unparsed = dataset.provisions.flatMap((p) => p.amendments.filter((a) => !a.act).map((a) => `${p.id}: ${a.annotation}`));
    expect(unparsed).toEqual([]);
    const types = new Set(dataset.provisions.flatMap((p) => p.amendments.map((a) => a.act?.type)));
    expect(types).toEqual(new Set(["lei", "medida_provisoria"]));
  });

  it("carries the STF notice and the Planalto page in every dispositivo's provenance", () => {
    expect(new Set(dataset.provisions.map((p) => p.provenance.notice)).size).toBe(1);
    expect(new Set(dataset.provisions.map((p) => p.provenance.sourceUrl))).toEqual(new Set([page]));
  });
});

// Any change to the text of the CDC shows up as a diff of this committed Markdown mirror. Regenerate it with
// `pnpm vitest run -u` only when the change is explained (a parser fix, or a new amending act in the fixtures).
describe("CDC full-text snapshot", () => {
  it("matches its committed Markdown mirror", async () => {
    const dataset = await build({ manifests: [cdc], source: await recordedSource(fixtures), datasetVersion: "snapshot" });
    const mirror = datasetFiles(dataset).find((f) => f.path === "cdc.md")!.content;
    await expect(mirror).toMatchFileSnapshot("./snapshots/cdc.md");
  });
});

// ADR 0002: Câmara LEGIN's compiled CDC is usable as its secondary source; the capture is committed for review layer 2.
describe("CDC secondary source", () => {
  it("is Câmara LEGIN's compiled text, verified usable, and its recorded capture serves the manifest's URL", async () => {
    expect(cdc.secondarySources).toMatchObject([{ name: "camara-legin", granularity: "article", verified: { usable: true } }]);
    const legin = await recordedSource(new URL("../fixtures/2026-10-21/", import.meta.url));
    const snapshot = await legin.get(cdc.secondarySources[0]!.url);
    expect(snapshot).toMatchObject({ encoding: "utf-8", retrievedAt: "2026-10-21T04:48:50Z" });
    expect(new TextDecoder("utf-8").decode(snapshot!.body)).toContain("Art. 119. Revogam-se as\ndisposições em contrário.");
  });
});

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
