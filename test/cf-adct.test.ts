// Seam 1: fidelity of the CF and ADCT built from the recorded compiled Planalto page: a hand-verified golden set,
// structural invariants and a full-text snapshot.
// Every expected value was read from the raw HTML of fixtures/2026-10-20/planalto/constituicaocompilado.htm (labels,
// text, annotations and their links), never produced by the parser. Whitespace is collapsed as a browser shows it.
import { beforeAll, describe, expect, it } from "vitest";
import { adct } from "../src/norms/adct.ts";
import { cf } from "../src/norms/cf.ts";
import { build } from "../src/pipeline/build.ts";
import { datasetFiles } from "../src/pipeline/files.ts";
import type { Dataset, Provision } from "../src/schema/dataset.ts";
import { recordedSource } from "../src/sources/recorded.ts";

const fixtures = new URL("../fixtures/2026-10-20/", import.meta.url);
// The EC 132 page the CF/ADCT manifests read for deferred vigência was captured a day later.
const actFixtures = new URL("../fixtures/2026-10-21/", import.meta.url);
const page = "https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm";
const emc = (file: string) => `https://www.planalto.gov.br/ccivil_03/constituicao/${file}`;
const stf = (incidente: number) => `http://portal.stf.jus.br/processos/detalhe.asp?incidente=${incidente}`;
const stfs = (incidente: number) => `https://portal.stf.jus.br/processos/detalhe.asp?incidente=${incidente}`;

const titulo = (n: string) => ({ kind: "titulo", label: `Título ${n}` });
const capitulo = (n: string) => ({ kind: "capitulo", label: `Capítulo ${n}` });
const secao = (n: string) => ({ kind: "secao", label: `Seção ${n}` });
const subsecao = (n: string) => ({ kind: "subsecao", label: `Subseção ${n}` });
const artigo = (label: string) => ({ kind: "artigo", label });
const caput = { kind: "caput", label: "caput" };
const paragrafo = (label: string) => ({ kind: "paragrafo", label });
const inciso = (label: string) => ({ kind: "inciso", label: `inciso ${label}` });
const alinea = (label: string) => ({ kind: "alinea", label: `alínea ${label}` });

/** An amendment by a constitutional amendment (EC), as the page cites it. */
const ec = (effect: string, number: string, year: number, annotation: string, href?: string) => ({
  effect,
  annotation,
  act: { type: "emenda_constitucional", number, year, ...(href && { href }) },
});
const adi = (number: string, annotation: string, href: string) => ({ kind: "adi", number, annotation, href });

interface Golden {
  norm?: "cf" | "adct";
  id: string;
  /** Why this one is in the set. */
  why: string;
  expected: Record<string, unknown>;
}

const golden: Golden[] = [
  // --- Title I and art. 5º ------------------------------------------------------------------------------
  {
    id: "art1_cpt",
    why: "first article, ordinal label",
    expected: {
      kind: "caput",
      path: [titulo("I"), artigo("Art. 1º"), caput],
      text: "A República Federativa do Brasil, formada pela união indissolúvel dos Estados e Municípios e do Distrito Federal, constitui-se em Estado Democrático de Direito e tem como fundamentos:",
      status: "in_force",
    },
  },
  {
    id: "art1_par1",
    why: "parágrafo único is par1 (LexML Parte 3)",
    expected: {
      kind: "paragrafo",
      label: "parágrafo único",
      path: [titulo("I"), artigo("Art. 1º"), paragrafo("parágrafo único")],
      text: "Todo o poder emana do povo, que o exerce por meio de representantes eleitos ou diretamente, nos termos desta Constituição.",
    },
  },
  {
    id: "art3_cpt_inc4",
    why: "inciso of the caput",
    expected: {
      path: [titulo("I"), artigo("Art. 3º"), inciso("IV")],
      text: "promover o bem de todos, sem preconceitos de origem, raça, sexo, cor, idade e quaisquer outras formas de discriminação.",
    },
  },
  {
    id: "art5_cpt",
    why: "art. 5º caput",
    expected: {
      path: [titulo("II"), capitulo("I"), artigo("Art. 5º"), caput],
      text: "Todos são iguais perante a lei, sem distinção de qualquer natureza, garantindo-se aos brasileiros e aos estrangeiros residentes no País a inviolabilidade do direito à vida, à liberdade, à igualdade, à segurança e à propriedade, nos termos seguintes:",
      amendments: [],
    },
  },
  {
    id: "art5_cpt_inc10",
    why: "art. 5º X, no annotation",
    expected: {
      text: "são invioláveis a intimidade, a vida privada, a honra e a imagem das pessoas, assegurado o direito a indenização pelo dano material ou moral decorrente de sua violação;",
      amendments: [],
      references: [],
    },
  },
  {
    id: "art5_cpt_inc11",
    why: "two trailing annotations: a Vide act and (Vigência)",
    expected: {
      text: "a casa é asilo inviolável do indivíduo, ninguém nela podendo penetrar sem consentimento do morador, salvo em caso de flagrante delito ou desastre, ou para prestar socorro, ou, durante o dia, por determinação judicial;",
      references: [
        { kind: "act", annotation: "Vide Lei nº 13.105, de 2015", act: { type: "lei", number: "13.105", year: 2015 } },
        { kind: "vigencia", annotation: "Vigência" },
      ],
    },
  },
  {
    id: "art5_cpt_inc34",
    why: "inciso followed by alíneas, which must not leak into it",
    expected: { text: "são a todos assegurados, independentemente do pagamento de taxas:" },
  },
  {
    id: "art5_cpt_inc34_ali1",
    why: "alínea under an inciso of the caput",
    expected: {
      kind: "alinea",
      label: "alínea a",
      path: [titulo("II"), capitulo("I"), artigo("Art. 5º"), inciso("XXXIV"), alinea("a")],
      text: "o direito de petição aos Poderes Públicos em defesa de direitos ou contra ilegalidade ou abuso de poder;",
    },
  },
  {
    id: "art5_cpt_inc78",
    why: "label split across lines; inserted by EC 45; Vide ADIN",
    expected: {
      text: "a todos, no âmbito judicial e administrativo, são assegurados a razoável duração do processo e os meios que garantam a celeridade de sua tramitação.",
      amendments: [ec("inserted", "45", 2004, "Incluído pela Emenda Constitucional nº 45, de 2004", emc("Emendas/Emc/emc45.htm#art1"))],
      references: [adi("3392", "Vide ADIN 3392", stf(2267506))],
    },
  },
  {
    id: "art5_cpt_inc79",
    why: "last inciso of art. 5º, text across two positioned spans",
    expected: {
      text: "é assegurado, nos termos da lei, o direito à proteção dos dados pessoais, inclusive nos meios digitais.",
      amendments: [ec("inserted", "115", 2022, "Incluído pela Emenda Constitucional nº 115, de 2022")],
    },
  },
  {
    id: "art5_par3",
    why: "three trailing annotations, one opening its parenthesis outside the link",
    expected: {
      text: "Os tratados e convenções internacionais sobre direitos humanos que forem aprovados, em cada Casa do Congresso Nacional, em dois turnos, por três quintos dos votos dos respectivos membros, serão equivalentes às emendas constitucionais.",
    },
  },
  {
    id: "art5_par4",
    why: "paragraph of art. 5º",
    expected: { text: "O Brasil se submete à jurisdição de Tribunal Penal Internacional a cuja criação tenha manifestado adesão." },
  },

  // --- Art. 7º and EC 141 ---------------------------------------------------------------------------------
  {
    id: "art7_cpt_inc9",
    why: "separator printed as &#150; (en dash)",
    expected: {
      path: [titulo("II"), capitulo("II"), artigo("Art. 7º"), inciso("IX")],
      text: "remuneração do trabalho noturno superior à do diurno;",
    },
  },
  {
    id: "art7_cpt_inc13",
    why: "reworded by EC 141/2026",
    expected: {
      text: "duração do trabalho normal não superior a 8 (oito) horas diárias e 40 (quarenta) horas semanais, facultada a compensação de horários e a redução da jornada, mediante acordo ou convenção coletiva de trabalho;",
      amendments: [ec("wording", "141", 2026, "Redação dada pela Emenda Constitucional nº 141, de 2026", emc("emendas/emc/emc141.htm#art1"))],
    },
  },
  {
    id: "art7_cpt_inc15",
    why: "EC 141 deferred vigência: the wording in force stays, with the Vide and Vigência pointers",
    expected: {
      text: "repouso semanal remunerado, preferencialmente aos domingos;",
      amendments: [],
      references: [
        {
          kind: "act",
          annotation: "Vide Emenda Constitucional nº 141, de 2026",
          act: { type: "emenda_constitucional", number: "141", year: 2026, href: emc("emendas/emc/emc141.htm#art1") },
        },
        { kind: "vigencia", annotation: "Vigência", href: emc("emendas/emc/emc141.htm#art10") },
      ],
    },
  },
  {
    id: "art7_par1",
    why: "former parágrafo único, numbered § 1º and reworded by EC 141",
    expected: {
      label: "§ 1º",
      text: "São assegurados à categoria dos trabalhadores domésticos os direitos previstos nos incisos IV, VI, VII, VIII, X, XIII, XV, XVI, XVII, XVIII, XIX, XXI, XXII, XXIV, XXVI, XXX, XXXI e XXXIII e, atendidas as condições estabelecidas em lei e observada a simplificação do cumprimento das obrigações tributárias, principais e acessórias, decorrentes da relação de trabalho e suas peculiaridades, os previstos nos incisos I, II, III, IX, XII, XXV e XXVIII, bem como a sua integração à previdência social.",
      amendments: [ec("wording", "141", 2026, "Redação dada pela Emenda Constitucional nº 141, de 2026")],
    },
  },
  {
    id: "art7_par2",
    why: "inserted by EC 141",
    expected: {
      text: "Excepcionalmente, convenção ou acordo coletivo de trabalho poderão, inclusive para os trabalhadores sujeitos a regimes diferenciados de trabalho estabelecidos em lei ou norma regulamentadora, estabelecer regime compensatório que assegure, na média, 2 (dois) dias de repouso semanal remunerado dentro do mês-calendário, garantido o gozo de pelo menos 1 (um) dos dias dentro do período máximo de 1 (uma) semana de trabalho.",
      amendments: [ec("inserted", "141", 2026, "Incluído pela Emenda Constitucional nº 141, de 2026")],
    },
  },
  {
    id: "art7_par3",
    why: "inserted by EC 141; a word split across two spans (\"hip\" + \"óteses\")",
    expected: {
      text: "Lei poderá dispor sobre hipóteses e condições em que a duração do trabalho e os dias de repouso semanal remunerado poderão observar regimes diferenciados, respeitados os limites previstos nos incisos XIII, XIV e XV do caput deste artigo.",
      amendments: [ec("inserted", "141", 2026, "Incluído pela Emenda Constitucional nº 141, de 2026")],
    },
  },

  // --- Titles II–III -------------------------------------------------------------------------------------
  {
    id: "art12_par4_inc2_ali1",
    why: "alínea revoked by rewording it to \"revogada;\" (no parentheses)",
    expected: {
      kind: "alinea",
      path: [titulo("II"), capitulo("III"), artigo("Art. 12"), paragrafo("§ 4º"), inciso("II"), alinea("a")],
      text: "revogada;",
      status: "revoked",
      amendments: [ec("wording", "131", 2023, "Redação dada pela Emenda Constitucional nº 131, de 2023")],
    },
  },
  {
    id: "art18_par4",
    why: "a bare linked \"Vide art. 96 - ADCT\" between two parenthesised annotations",
    expected: {
      path: [titulo("III"), capitulo("I"), artigo("Art. 18"), paragrafo("§ 4º")],
      text: "A criação, a incorporação, a fusão e o desmembramento de Municípios, far-se-ão por lei estadual, dentro do período determinado por Lei Complementar Federal, e dependerão de consulta prévia, mediante plebiscito, às populações dos Municípios envolvidos, após divulgação dos Estudos de Viabilidade Municipal, apresentados e publicados na forma da lei.",
      amendments: [ec("wording", "15", 1996, "Redação dada pela Emenda Constitucional nº 15, de 1996")],
      references: [
        { kind: "other", annotation: "Vide art. 96 - ADCT", href: `${page}#art96adct` },
        {
          kind: "act",
          annotation: "Vide Lei Complementar nº 230, de 2026",
          act: { type: "lei_complementar", number: "230", year: 2026 },
        },
      ],
    },
  },
  {
    id: "art20_cpt_inc4",
    why: "inciso without a separator (\"IV as ilhas…\")",
    expected: {
      label: "inciso IV",
      path: [titulo("III"), capitulo("II"), artigo("Art. 20"), inciso("IV")],
      text: "as ilhas fluviais e lacustres nas zonas limítrofes com outros países; as praias marítimas; as ilhas oceânicas e as costeiras, excluídas, destas, as que contenham a sede de Municípios, exceto aquelas áreas afetadas ao serviço público e a unidade ambiental federal, e as referidas no art. 26, II;",
      amendments: [ec("wording", "46", 2005, "Redação dada pela Emenda Constitucional nº 46, de 2005")],
    },
  },
  {
    id: "art23_cpt_inc2",
    why: "Vide ADPF",
    expected: {
      text: "cuidar da saúde e assistência pública, da proteção e garantia das pessoas portadoras de deficiência;",
      references: [
        {
          kind: "adpf",
          number: "672",
          annotation: "Vide ADPF 672",
          href: "http://www.stf.jus.br/portal/peticaoInicial/verPeticaoInicial.asp?base=ADPF&documento=&s1=672&numProcesso=672",
        },
      ],
    },
  },
  {
    id: "art29_cpt_inc4",
    why: "wording, \"(Produção de efeito)\" and a Vide ADIN on one inciso",
    expected: {
      text: "para a composição das Câmaras Municipais, será observado o limite máximo de:",
      amendments: [ec("wording", "58", 2009, "Redação dada pela Emenda Constitucional nº 58, de 2009")],
      references: [
        { kind: "producao_de_efeito", annotation: "Produção de efeito", href: emc("Emendas/Emc/emc58.htm#art3") },
        adi("4307", "Vide ADIN 4307", "http://www.stf.jus.br/portal/peticaoInicial/verPeticaoInicial.asp?base=ADIN&s1=4307&processo=4307"),
      ],
    },
  },
  {
    id: "art29_cpt_inc10",
    why: "renumbered (\"Renumerado do inciso VIII, pela …\")",
    expected: {
      text: "julgamento do Prefeito perante o Tribunal de Justiça;",
      amendments: [ec("renumbered", "1", 1992, "Renumerado do inciso VIII, pela Emenda Constitucional nº 1, de 1992")],
    },
  },
  {
    id: "art29-1_cpt_inc1",
    why: "-A article; the page's typo \"Emenda Constituição Constitucional\"",
    expected: {
      path: [titulo("III"), capitulo("IV"), artigo("Art. 29-A"), inciso("I")],
      text: "7% (sete por cento) para Municípios com população de até 100.000 (cem mil) habitantes;",
      amendments: [
        {
          effect: "wording",
          annotation: "Redação dada pela Emenda Constituição Constitucional nº 58, de 2009",
          act: { citation: "Emenda Constituição Constitucional nº 58, de 2009", type: "emenda_constitucional", number: "58", year: 2009 },
        },
      ],
      references: [{ kind: "producao_de_efeito" }],
    },
  },
  {
    id: "art29-1_par1",
    why: "ordinal printed as a superscript \"o\" (§&nbsp;1<sup><u>o</u></sup>)",
    expected: {
      label: "§ 1º",
      text: "A Câmara Municipal não gastará mais de setenta por cento de sua receita com folha de pagamento, incluído o gasto com o subsídio de seus Vereadores.",
      amendments: [ec("inserted", "25", 2000, "Incluído pela Emenda Constitucional nº 25, de 2000")],
    },
  },
  {
    id: "art40_par5-1",
    why: "§ 5º-A inserted by EC 140/2026",
    expected: {
      label: "§ 5º-A",
      path: [titulo("III"), capitulo("VII"), secao("II"), artigo("Art. 40"), paragrafo("§ 5º-A")],
      text: "O requisito de idade a que se refere o inciso III do § 1º deste artigo será de 57 (cinquenta e sete) anos de idade, se mulher, e 60 (sessenta) anos de idade, se homem, para o agente comunitário de saúde e o agente de combate às endemias que comprovem o mínimo de 25 (vinte e cinco) anos de tempo de contribuição e de efetivo exercício na respectiva atividade profissional.",
      amendments: [ec("inserted", "140", 2026, "Incluído pela Emenda Constitucional nº 140, de 2026", emc("emendas/emc/emc140.htm#art1"))],
    },
  },
  {
    id: "art42_cpt",
    why: "article label without a period (\"Art. 42 Os membros…\")",
    expected: {
      path: [titulo("III"), capitulo("VII"), secao("III"), artigo("Art. 42"), caput],
      text: "Os membros das Polícias Militares e Corpos de Bombeiros Militares, instituições organizadas com base na hierarquia e disciplina, são militares dos Estados, do Distrito Federal e dos Territórios.",
      amendments: [ec("wording", "18", 1998, "Redação dada pela Emenda Constitucional nº 18, de 1998")],
    },
  },

  // --- Title IV --------------------------------------------------------------------------------------------
  {
    id: "art61_cpt",
    why: "path down to a Subseção",
    expected: {
      path: [titulo("IV"), capitulo("I"), secao("VIII"), subsecao("III"), artigo("Art. 61"), caput],
      text: "A iniciativa das leis complementares e ordinárias cabe a qualquer membro ou Comissão da Câmara dos Deputados, do Senado Federal ou do Congresso Nacional, ao Presidente da República, ao Supremo Tribunal Federal, aos Tribunais Superiores, ao Procurador-Geral da República e aos cidadãos, na forma e nos casos previstos nesta Constituição.",
    },
  },
  {
    id: "art62_par1_inc1_ali1",
    why: "alínea under an inciso under a parágrafo",
    expected: {
      path: [titulo("IV"), capitulo("I"), secao("VIII"), subsecao("III"), artigo("Art. 62"), paragrafo("§ 1º"), inciso("I"), alinea("a")],
      text: "nacionalidade, cidadania, direitos políticos, partidos políticos e direito eleitoral;",
      amendments: [ec("inserted", "32", 2001, "Incluído pela Emenda Constitucional nº 32, de 2001")],
    },
  },
  {
    id: "art73_par3",
    why: "ordinal printed as a degree sign (\"§ 3°\")",
    expected: {
      label: "§ 3º",
      path: [titulo("IV"), capitulo("I"), secao("IX"), artigo("Art. 73"), paragrafo("§ 3º")],
      text: "Os Ministros do Tribunal de Contas da União terão as mesmas garantias, prerrogativas, impedimentos, vencimentos e vantagens dos Ministros do Superior Tribunal de Justiça, aplicando-se-lhes, quanto à aposentadoria e pensão, as normas constantes do art. 40.",
      amendments: [ec("wording", "20", 1998, "Redação dada pela Emenda Constitucional nº 20, de 1998")],
    },
  },
  {
    id: "art92_cpt_inc1-1",
    why: "lettered inciso without a separator (\"I-A o Conselho…\")",
    expected: {
      label: "inciso I-A",
      path: [titulo("IV"), capitulo("III"), secao("I"), artigo("Art. 92"), inciso("I-A")],
      text: "o Conselho Nacional de Justiça;",
      amendments: [ec("inserted", "45", 2004, "Incluído pela Emenda Constitucional nº 45, de 2004")],
    },
  },
  {
    id: "art93_cpt_inc8-1",
    why: "lettered inciso VIII-A; &quot; entities",
    expected: {
      label: "inciso VIII-A",
      text: 'a remoção a pedido de magistrados de comarca de igual entrância atenderá, no que couber, ao disposto nas alíneas "a", "b", "c" e "e" do inciso II do caput deste artigo e no art. 94 desta Constituição;',
      amendments: [ec("wording", "130", 2023, "Redação dada pela Emenda Constitucional nº 130, de 2023")],
    },
  },
  {
    id: "art100_par11",
    why: "words struck mid-sentence by the STF (\"devedor, <strike>…</strike>, a oferta\"); two Vide ADI",
    expected: {
      text: "É facultada ao credor, conforme estabelecido em lei do ente federativo devedor, a oferta de créditos líquidos e certos que originalmente lhe são próprios ou adquiridos de terceiros reconhecidos pelo ente federativo ou por decisão judicial transitada em julgado para:",
      amendments: [ec("wording", "113", 2021, "Redação dada pela Emenda Constitucional nº 113, de 2021")],
      references: [adi("7047", "Vide ADI 7047", stfs(6318731)), adi("7064", "Vide ADI 7064", stfs(6330822))],
    },
  },
  {
    id: "art103_par4",
    why: "revoked by annotation only, ordinal after a period (\"§ 4.º\")",
    expected: {
      label: "§ 4º",
      text: "",
      status: "revoked",
      amendments: [ec("revoked", "45", 2004, "Revogado pela Emenda Constitucional nº 45, de 2004")],
    },
  },
  {
    id: "art103-1_cpt",
    why: "art. 103-A (letter suffix → -1); a Vide Lei whose period sits after the parenthesis",
    expected: {
      path: [titulo("IV"), capitulo("III"), secao("II"), artigo("Art. 103-A"), caput],
      text: "O Supremo Tribunal Federal poderá, de ofício ou por provocação, mediante decisão de dois terços dos seus membros, após reiteradas decisões sobre matéria constitucional, aprovar súmula que, a partir de sua publicação na imprensa oficial, terá efeito vinculante em relação aos demais órgãos do Poder Judiciário e à administração pública direta e indireta, nas esferas federal, estadual e municipal, bem como proceder à sua revisão ou cancelamento, na forma estabelecida em lei.",
      amendments: [ec("inserted", "45", 2004, "Incluído pela Emenda Constitucional nº 45, de 2004")],
      references: [{ kind: "act", annotation: "Vide Lei nº 11.417, de 2006", act: { type: "lei", number: "11.417", year: 2006 } }],
    },
  },
  ...[1, 2, 3].map((n) => ({
    id: `art111_par${n}`,
    why: "\"§§ 1º a 3º. (Revogados pela …)\": one line, three revoked paragraphs",
    expected: {
      label: `§ ${n}º`,
      path: [titulo("IV"), capitulo("III"), secao("V"), artigo("Art. 111"), paragrafo(`§ ${n}º`)],
      text: "",
      status: "revoked",
      amendments: [ec("revoked", "45", 2004, "Revogados pela Emenda Constitucional nº 45, de 2004")],
    },
  })),
  {
    id: "art114_cpt",
    why: "two Vide ADIN on a caput",
    expected: {
      text: "Compete à Justiça do Trabalho processar e julgar:",
      amendments: [ec("wording", "45", 2004, "Redação dada pela Emenda Constitucional nº 45, de 2004")],
      references: [
        adi("3392", "Vide ADIN 3392", "http://www.stf.jus.br/portal/peticaoInicial/verPeticaoInicial.asp?base=ADI&documento=&s1=3392&processo=3392"),
        { kind: "adi", number: "3432", annotation: "Vide ADIN 3432" },
      ],
    },
  },
  ...["art117_cpt", "art117_par1"].map((id) => ({
    id,
    why: "\"Art. 117. e Parágrafo único. (Revogados pela …)\": caput and parágrafo único revoked together",
    expected: {
      text: "",
      status: "revoked",
      amendments: [ec("revoked", "24", 1999, "Revogados pela Emenda Constitucional nº 24, de 1999", emc("Emendas/Emc/emc24.htm#art4"))],
    },
  })),

  // --- Titles VI–IX ----------------------------------------------------------------------------------------
  {
    id: "art149_par1",
    why: "an annotation the page leaves unclosed: \"(Vigência\"",
    expected: {
      text: "A União, os Estados, o Distrito Federal e os Municípios instituirão, por meio de lei, contribuições para custeio de regime próprio de previdência social, cobradas dos servidores ativos, dos aposentados e dos pensionistas, que poderão ter alíquotas progressivas de acordo com o valor da base de contribuição ou dos proventos de aposentadoria e de pensões.",
      amendments: [ec("wording", "103", 2019, "Redação dada pela Emenda Constitucional nº 103, de 2019")],
      references: [{ kind: "vigencia", annotation: "Vigência", href: emc("Emendas/Emc/emc103.htm#art36ii") }],
    },
  },
  {
    id: "art149_par1-1",
    why: "§ 1º-A",
    expected: {
      label: "§ 1º-A",
      text: "Quando houver deficit atuarial, a contribuição ordinária dos aposentados e pensionistas poderá incidir sobre o valor dos proventos de aposentadoria e de pensões que supere o salário-mínimo.",
      amendments: [ec("inserted", "103", 2019, "Incluído pela Emenda Constitucional nº 103, de 2019")],
      references: [{ kind: "vigencia" }],
    },
  },
  {
    id: "art156-1_cpt",
    why: "inside a lettered Seção (V-A, EC 132)",
    expected: {
      path: [titulo("VI"), capitulo("I"), secao("V-A"), artigo("Art. 156-A"), caput],
      text: "Lei complementar instituirá imposto sobre bens e serviços de competência compartilhada entre Estados, Distrito Federal e Municípios.",
      amendments: [ec("inserted", "132", 2023, "Incluído pela Emenda Constitucional nº 132, de 2023")],
    },
  },
  {
    id: "art166_par14_inc1",
    why: "revoked by rewording it to \"(revogado);\"",
    expected: {
      text: "(revogado);",
      status: "revoked",
      amendments: [ec("wording", "100", 2019, "Redação dada pela Emenda Constitucional nº 100, de 2019")],
      references: [{ kind: "producao_de_efeito", annotation: "Produção de efeito" }],
    },
  },
  {
    id: "art167-7_cpt",
    why: "art. 167-G, the last of a lettered run",
    expected: {
      path: [titulo("VI"), capitulo("II"), secao("II"), artigo("Art. 167-G"), caput],
      text: "Na hipótese de que trata o art. 167-B, aplicam-se à União, até o término da calamidade pública, as vedações previstas no art. 167-A desta Constituição.",
      amendments: [ec("inserted", "109", 2021, "Incluído pela Emenda Constitucional nº 109, de 2021")],
    },
  },
  {
    id: "art192_par1",
    why: "\"§ 1°- (Revogado) (Redação dada …)\": degree sign, glued dash, revoked wording",
    expected: {
      label: "§ 1º",
      path: [titulo("VII"), capitulo("IV"), artigo("Art. 192"), paragrafo("§ 1º")],
      text: "(Revogado)",
      status: "revoked",
      amendments: [ec("wording", "40", 2003, "Redação dada pela Emenda Constitucional nº 40, de 2003")],
    },
  },
  {
    id: "art198_par1",
    why: "annotation \"Parágrafo único renumerado para § 1º pela …\"",
    expected: {
      path: [titulo("VIII"), capitulo("II"), secao("II"), artigo("Art. 198"), paragrafo("§ 1º")],
      text: "O sistema único de saúde será financiado, nos termos do art. 195, com recursos do orçamento da seguridade social, da União, dos Estados, do Distrito Federal e dos Municípios, além de outras fontes.",
      amendments: [ec("renumbered", "29", 2000, "Parágrafo único renumerado para § 1º pela Emenda Constitucional nº 29, de 2000")],
    },
  },
  {
    id: "art215_par2",
    why: "parágrafo printed without its \"§\" (\"2º A lei disporá…\")",
    expected: {
      label: "§ 2º",
      path: [titulo("VIII"), capitulo("III"), secao("II"), artigo("Art. 215"), paragrafo("§ 2º")],
      text: "A lei disporá sobre a fixação de datas comemorativas de alta significação para os diferentes segmentos étnicos nacionais.",
    },
  },
  {
    id: "art216-1_par1_inc1",
    why: "unparenthesised \"Incluído pela …\" link",
    expected: {
      path: [titulo("VIII"), capitulo("III"), secao("II"), artigo("Art. 216-A"), paragrafo("§ 1º"), inciso("I")],
      text: "diversidade das expressões culturais;",
      amendments: [ec("inserted", "71", 2012, "Incluído pela Emenda Constitucional nº 71, de 2012", emc("Emendas/Emc/emc71.htm"))],
    },
  },
  {
    id: "art233_cpt",
    why: "whole article revoked; act dated \"de 25/05/2000\"",
    expected: {
      path: [titulo("IX"), artigo("Art. 233"), caput],
      text: "",
      status: "revoked",
      amendments: [ec("revoked", "28", 2000, "Revogado pela Emenda Constitucional nº 28, de 25/05/2000")],
    },
  },

  // --- ADCT ------------------------------------------------------------------------------------------------
  {
    norm: "adct",
    id: "art1_cpt",
    why: "ADCT labels carry ordinal and period (\"Art. 1º.\"); no groupings above",
    expected: {
      path: [artigo("Art. 1º"), caput],
      text: "O Presidente da República, o Presidente do Supremo Tribunal Federal e os membros do Congresso Nacional prestarão o compromisso de manter, defender e cumprir a Constituição, no ato e na data de sua promulgação.",
    },
  },
  {
    norm: "adct",
    id: "art2_cpt",
    why: "legitimate parentheticals in the text survive; a lowercase \"Vide emenda Constitucional\"",
    expected: {
      text: "No dia 7 de setembro de 1993 o eleitorado definirá, através de plebiscito, a forma (república ou monarquia constitucional) e o sistema de governo (parlamentarismo ou presidencialismo) que devem vigorar no País.",
      references: [
        {
          kind: "act",
          annotation: "Vide emenda Constitucional nº 2, de 1992",
          act: { type: "emenda_constitucional", number: "2", year: 1992 },
        },
      ],
    },
  },
  {
    norm: "adct",
    id: "art2_par1",
    why: "\"§ 1º - \" with a dash separator",
    expected: {
      text: "Será assegurada gratuidade na livre divulgação dessas formas e sistemas, através dos meios de comunicação de massa cessionários de serviço público.",
    },
  },
  {
    norm: "adct",
    id: "art67_cpt",
    why: "four STF references, one an ADC",
    expected: {
      text: "A União concluirá a demarcação das terras indígenas no prazo de cinco anos a partir da promulgação da Constituição.",
      references: [
        { kind: "adc", number: "87", annotation: "Vide ADC 87", href: stfs(6824155) },
        adi("7582", "Vide ADI 7582", stfs(6824370)),
        adi("7583", "Vide ADI 7583", stfs(6824472)),
        adi("7586", "Vide ADI 7586", stfs(6825310)),
      ],
    },
  },
  {
    norm: "adct",
    id: "art76_par2",
    why: "degree-sign ordinal; a period after the annotation's parenthesis",
    expected: {
      label: "§ 2º",
      text: "Excetua-se da desvinculação de que trata o caput a arrecadação da contribuição social do salário-educação a que se refere o § 5º do art. 212 da Constituição Federal.",
      amendments: [ec("wording", "68", 2011, "Redação dada pela Emenda Constitucional nº 68, de 2011")],
    },
  },
  {
    norm: "adct",
    id: "art76-1_par1",
    why: "the page's typo \"Incluído dada pela\", then a bare \"Produção de efeitos\" link",
    expected: {
      text: "Excetuam-se da desvinculação de que trata o caput:",
      amendments: [ec("inserted", "93", 2016, "Incluído dada pela Emenda constitucional nº 93, de 2016")],
      references: [{ kind: "producao_de_efeito", annotation: "Produção de efeitos", href: emc("Emendas/Emc/emc93.htm#art3") }],
    },
  },
  {
    norm: "adct",
    id: "art76-2_cpt",
    why: "ADCT art. 76-B",
    expected: {
      path: [artigo("Art. 76-B"), caput],
      text: "São desvinculadas de órgão, fundo ou despesa, até 31 de dezembro de 2032, as receitas dos Municípios relativas a impostos, contribuições, taxas e multas, já instituídos ou que vierem a ser criados até a referida data, seus adicionais e respectivos acréscimos legais, e outras receitas correntes, de acordo com os seguintes percentuais:",
      amendments: [ec("wording", "136", 2025, "Redação dada pela Emenda Constitucional nº 136, de 2025")],
    },
  },
  {
    norm: "adct",
    id: "art91_cpt",
    why: "a revoked ADCT article; the CF's own art. 91 is in force",
    expected: {
      text: "",
      status: "revoked",
      amendments: [ec("revoked", "109", 2021, "Revogado pela Emenda Constitucional nº 109, de 2021")],
    },
  },
  // Found by the cross-source check (#8): text where the page and normas.leg.br disagreed because of our parser.
  {
    id: "art155_par1_inc2",
    why: "pasted DOU HTML spaces a word only with CSS margins (\"o<strong style=\\\"margin-left: 4px…\\\">de cujus</strong>,\")",
    expected: {
      text: "relativamente a bens móveis, títulos e créditos, compete ao Estado onde era domiciliado o de cujus, ou tiver domicílio o doador, ou ao Distrito Federal;",
      amendments: [ec("wording", "132", 2023, "Redação dada pela Emenda Constitucional nº 132, de 2023")],
    },
  },
  {
    norm: "adct",
    id: "art105_par1",
    why: "\"Numerado do parágrafo único pela …\" is a renumbering annotation, not wording",
    expected: {
      label: "§ 1º",
      text: "Não se aplica às compensações referidas no caput deste artigo qualquer tipo de vinculação, como as transferências a outros entes e as destinadas à educação, à saúde e a outras finalidades.",
      amendments: [
        ec("renumbered", "99", 2017, "Numerado do parágrafo único pela Emenda constitucional nº 99, de 2017", emc("Emendas/Emc/emc99.htm#art1")),
      ],
    },
  },
];

describe("CF and ADCT golden set", () => {
  let dataset: Dataset;

  beforeAll(async () => {
    dataset = await build({ manifests: [cf, adct], source: await recordedSource(fixtures, actFixtures), datasetVersion: "golden" });
  });

  it("holds about 50 hand-verified dispositivos", () => {
    expect(golden.length).toBeGreaterThanOrEqual(50);
  });

  it.each(golden.map((g) => ({ ...g, norm: g.norm ?? "cf" })))("$norm $id: $why", ({ norm, id, expected }) => {
    const found = dataset.provisions.find((p) => p.norm === norm && p.id === id);
    expect(found, `${norm} ${id} missing`).toBeDefined();
    expect(found).toMatchObject({ ...expected, provenance: { sourceUrl: page } });
  });

  it("keeps the CF's own art. 91 in force next to the revoked ADCT art. 91", () => {
    expect(dataset.provisions.find((p) => p.norm === "cf" && p.id === "art91_cpt")?.status).toBe("in_force");
  });
});

describe("CF and ADCT structural invariants", () => {
  let dataset: Dataset;
  const of = (norm: string) => dataset.provisions.filter((p) => p.norm === norm);
  const count = (norm: string, kind: string) => of(norm).filter((p) => p.kind === kind).length;

  beforeAll(async () => {
    dataset = await build({ manifests: [cf, adct], source: await recordedSource(fixtures, actFixtures), datasetVersion: "invariants" });
  });

  it("never gives two dispositivos of a norm the same id", () => {
    for (const norm of ["cf", "adct"]) {
      const ids = of(norm).map((p) => p.id);
      expect(new Set(ids).size, norm).toBe(ids.length);
    }
  });

  it("numbers siblings monotonically, letter suffixes after their base (29, 29-A, 30; § 1º, § 1º-A, § 2º)", () => {
    for (const norm of ["cf", "adct"]) {
      const last = new Map<string, number[]>();
      for (const { id } of of(norm)) {
        // Every level of the id: "art29-1_par1-1" → parents "", "art29-1"; numbers [29, 1], [1, 1].
        const parts = id.split("_");
        for (let depth = 0; depth < parts.length; depth++) {
          const part = parts[depth]!;
          if (part === "cpt") continue;
          const kind = part.replace(/[\d-]+$/, "");
          const numbers = part.slice(kind.length).split("-").map(Number);
          const key = `${parts.slice(0, depth).join("_")}|${kind}`;
          const previous = last.get(key);
          if (previous && compare(previous, numbers) > 0) {
            throw new Error(`${norm}: ${id} comes after ${kind}${previous.join("-")} under "${key}"`);
          }
          last.set(key, numbers);
        }
      }
    }
  });

  it("counts articles exactly and incisos/parágrafos/alíneas near the normas.leg.br reference", () => {
    // Articles in force on the page: CF 250 + 26 lettered, ADCT 138 + 10 lettered. normas.leg.br says 278 for the CF
    // because it also counts the moved originals of arts. 134/135.
    expect(count("cf", "caput")).toBe(276);
    expect(count("adct", "caput")).toBe(148);
    // normas.leg.br (2026-10-20 fixture): CF 1,298 incisos, 816 parágrafos, 318 alíneas; ADCT 269, 312, 71. It runs
    // higher because it keeps the children of articles Planalto collapses into one revoked line (CF art. 171,
    // §§ of art. 233; ADCT arts. 106–114), so Planalto's counts sit a little below it, never above.
    const near = (actual: number, reference: number, tolerance: number) => {
      expect(actual).toBeLessThanOrEqual(reference);
      expect(actual).toBeGreaterThanOrEqual(Math.floor(reference * (1 - tolerance)));
    };
    near(count("cf", "inciso"), 1298, 0.03);
    near(count("cf", "paragrafo"), 816, 0.03);
    near(count("cf", "alinea"), 318, 0.04);
    near(count("adct", "inciso"), 269, 0.2);
    near(count("adct", "paragrafo"), 312, 0.1);
    near(count("adct", "alinea"), 71, 0.3);
    expect(count("cf", "item") + count("adct", "item")).toBe(0);
  });

  it("keeps every revoked dispositivo the page marks, with its id", () => {
    // Hand count on the page: CF 39 lines carry a revocation marker, one of them "§§ 1º a 3º" (3 dispositivos) and one
    // "Art. 117. e Parágrafo único" (2), so 42; ADCT 18 lines, 18 dispositivos. Neither has a vetoed dispositivo.
    expect(of("cf").filter((p) => p.status === "revoked")).toHaveLength(42);
    expect(of("adct").filter((p) => p.status === "revoked")).toHaveLength(18);
    expect(dataset.provisions.filter((p) => p.status === "vetoed")).toEqual([]);
    for (const p of dataset.provisions.filter((p) => p.status === "revoked")) {
      // The wording a revoked dispositivo keeps is the page's marker or nothing (the revocation is then an annotation).
      expect(p.text, p.id).toMatch(/^(\(?revogad[oa]s?\)?[.;]?)?$/i);
    }
  });

  it("leaves no annotation, entity or struck-text residue in any text", () => {
    const residue =
      /\((?:Redação dada|Incluíd|Revogad[oa]s? pel|Vide|Vigência|Produção de efeito|Renumerad)|\bVide\s|Incluíd[oa] pel[oa]|&#|&nbsp|&quot|\uFFFD|\uE000|, ,|\s{2}|^\s|\s$/i;
    const leaks = dataset.provisions.filter((p) => residue.test(p.text)).map((p) => `${p.norm} ${p.id}: ${p.text}`);
    expect(leaks).toEqual([]);
  });

  it("recognises the amending act of every amendment annotation (the CF and ADCT are amended only by ECs)", () => {
    const unparsed = dataset.provisions.flatMap((p) => p.amendments.filter((a) => !a.act).map((a) => `${p.id}: ${a.annotation}`));
    expect(unparsed).toEqual([]);
    const types = new Set(dataset.provisions.flatMap((p) => p.amendments.map((a) => a.act?.type)));
    expect(types).toEqual(new Set(["emenda_constitucional", "emenda_constitucional_de_revisao"]));
  });

  it("surfaces every \"Vide ADI/ADIN\" on the page as an ADI reference on its dispositivo", () => {
    // Counted on the page text: 40 "(Vide ADI …)" and 17 "(Vide ADIN …)" annotations, all trailing a dispositivo.
    const adis = dataset.provisions.flatMap((p) => p.references.filter((r) => r.kind === "adi"));
    expect(adis.length).toBe(57);
    for (const reference of adis) expect(reference.number).toMatch(/^\d[\d.]*(-\d+)?$/);
  });

  it("carries the STF notice in every dispositivo's provenance", () => {
    const notices = new Set(dataset.provisions.map((p) => p.provenance.notice));
    expect([...notices]).toEqual([expect.stringContaining("não é verificada contra decisões do STF")]);
  });
});

// Any change to the text of the CF or the ADCT shows up as a diff of these committed Markdown mirrors. Regenerate them
// with `pnpm vitest run -u` only when the change is explained (a parser fix, or a new amending act in the fixtures).
describe("CF and ADCT full-text snapshot", () => {
  it.each(["cf", "adct"])("%s matches its committed Markdown mirror", async (norm) => {
    const dataset = await build({ manifests: [cf, adct], source: await recordedSource(fixtures, actFixtures), datasetVersion: "snapshot" });
    const mirror = datasetFiles(dataset).find((f) => f.path === `${norm}.md`)!.content;
    await expect(mirror).toMatchFileSnapshot(`./snapshots/${norm}.md`);
  });
});

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
