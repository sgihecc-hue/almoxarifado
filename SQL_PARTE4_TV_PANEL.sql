---
name: analisar-processo
description: Analisa PDFs de processos indenizatorios FESF-SUS verificando conformidade documental (checklist 1a Etapa + DDRO) com base no Parecer Sistemico 001/2024/PROJUR. Gera relatorio de auditoria com 21 itens.
---

# SKILL: Analisar Processo Indenizatorio FESF-SUS (Checklist de Auditoria)

## OBJETIVO
Analisar PDF(s) de processos indenizatorios da FESF-SUS e verificar a conformidade documental
com base no **Parecer Sistemico n. 001/2024/PROJUR/DG/FESF** (Anexo I - Checklist).

Foco desta skill: **1a Etapa (20 itens) + DDRO (2a Etapa)** — os itens sob responsabilidade
da Unidade de Saude/Sede e do Gestor de Contrato/Servico.

Gera um relatorio de auditoria estruturado indicando, para cada item:
- Se o documento foi encontrado no PDF
- Em que pagina(s) foi localizado
- Se o conteudo atende aos requisitos especificos
- Pendencias e irregularidades detectadas

---

## QUANDO USAR
- Usuario fornece PDF(s) de processos indenizatorios para analise
- Usuario pede para "analisar processo", "verificar documentacao", "fazer checklist", "auditar processo"
- Usuario referencia processos SEI da FESF-SUS com pagamento por indenizacao

---

## FUNDAMENTACAO LEGAL
| Dispositivo | Tema |
|---|---|
| Art. 149, Lei 14.133/2021 | Dever de indenizar em contrato nulo; responsabilizacao de quem deu causa |
| Arts. 884-885, Codigo Civil | Vedacao ao enriquecimento ilicito |
| Art. 23, Lei 14.133/2021 | Pesquisa de precos de mercado |
| Art. 17, V e Art. 68, II-V, Lei 14.133/2021 | Regularidade fiscal e trabalhista |
| Art. 72, V, Lei 14.133/2021 | Requisitos para contratacao direta |
| Art. 91, par.4o, Lei 14.133/2021 | Consulta bancos publicos (CEIS/CNEP/Comprasnet) |
| Art. 95, par.2o, Lei 14.133/2021 | Nulidade do contrato verbal acima de R$ 10.000 |
| Art. 121, par.1o-2o, Lei 14.133/2021 | Documentacao trabalhista em cessao de mao de obra |
| Decreto 20.910/1932, arts. 1o e 5o | Prescricao quinquenal contra a Adm. Publica |
| Ato Administrativo n. 598/2024 FESF | Efeito sistemico do Parecer |

---

## INSTRUCOES DE EXECUCAO

### PASSO 1 — Receber e Ler o PDF
1. O usuario fornecera o caminho do PDF do processo
2. Ler o PDF usando a ferramenta Read com parametro `pages`
3. Para PDFs grandes (>10 paginas), dividir a leitura em blocos de 15-20 paginas
4. Para PDFs muito grandes (>50 paginas), usar subagentes paralelos (skill `analisar-pdf`)
5. Se o PDF for baseado em imagens (sem texto extraivel), informar ao usuario e solicitar versao com OCR

### PASSO 2 — Identificar Dados Basicos do Processo
Extrair do PDF os seguintes dados e registrar no cabecalho do relatorio:

| Dado | Onde encontrar | Formato esperado |
|---|---|---|
| Numero do Processo SEI | Rodape das paginas, CI, capa | `XXXX.XXXXXX/XXXX-XX` |
| Nome do Fornecedor/Empresa | CI, NF, Contrato Social, Termo | Razao social completa |
| CNPJ do Fornecedor | Cartao CNPJ, NF, Contrato Social | `XX.XXX.XXX/XXXX-XX` |
| Unidade de Saude | CI, cabecalho | Ex: HECC, Policlinica, UPA |
| Competencia/Periodo | CI, NF | `MM/AAAA` ou periodo descrito |
| Valor | NF, Termo de Reconhecimento | `R$ X.XXX,XX` |
| Tipo de contratacao | Inferir do objeto/fornecedor | Ver tabela de classificacao |

### PASSO 3 — Classificar o Tipo de Contratacao

A classificacao determina quais itens CONDICIONAIS sao aplicaveis:

| Tipo | Criterio de Identificacao | Exemplos de Fornecedores |
|---|---|---|
| `mao_de_obra` | Cessao de funcionarios para prestar servico na unidade (limpeza, seguranca, vigilancia, radiologia, portaria, recepcao, manutencao) | Imperio Security, Del Mar, R8 Servicos, Alfa Servicos, TecImagem |
| `material` | Fornecimento de insumos, medicamentos, materiais hospitalares, descartaveis | Gil Farma, Medisil, Ultra Medical, Hospdrogas, LM Medical, Salvador Distribuidora, Lannamed |
| `gas_medicinal` | Fornecimento de oxigenio, gases medicinais, locacao de cilindros | White Martins, CR Medical |
| `servico` | Prestacao de servicos sem cessao permanente de mao de obra (consultorias, manutencao pontual, exames) | Demais prestadores |

**Regra de aplicabilidade dos itens condicionais:**
- `mao_de_obra`: Itens 13, 15 (OBRIGATORIO c/ 7 subitens), 16, 18, 19 se aplicam
- `servico`: Itens 13 (se saude), 16, 18, 19 se aplicam
- `material`: Apenas itens universais obrigatorios
- `gas_medicinal`: Apenas itens universais obrigatorios + Item 13 se aplicavel

### PASSO 4 — Aplicar o Checklist (1a Etapa + DDRO)

Para CADA item do checklist abaixo:
1. Buscar no texto do PDF pelos padroes indicados
2. Anotar a(s) pagina(s) onde foi encontrado
3. Verificar os requisitos de conteudo especificos (quando houver)
4. Classificar como: `CONFORME`, `CONFORME COM RESSALVA`, `PENDENTE`, `N/A`

### PASSO 5 — Gerar Relatorio de Auditoria
Produzir relatorio no formato padrao (ver secao FORMATO DO RELATORIO ao final).

---

## ================================================================
## CHECKLIST 1a ETAPA — INICIO DO PROCESSO
## Area Responsavel: Unidade de Saude / Sede
## ================================================================

---

### ITEM 1 — Comunicacao Interna (CI)

**Obrigatoriedade:** OBRIGATORIO para todos os tipos de contratacao.

**Descricao:** Documento interno da area solicitante que formaliza o pedido de pagamento
por indenizacao. Funciona como peca inaugural do processo. O modelo consta no Sistema SEI.

**Como identificar no PDF:**
- Titulo: "COMUNICACAO INTERNA" ou "CI"
- Tipo de documento SEI: "Comunicacao Interna"
- Pode conter "PAGAMENTO POR INDENIZACAO" no assunto
- Geralmente e o primeiro ou segundo documento do processo

**Padroes de busca (regex, case-insensitive):**
```
COMUNICA[CÇ][AÃ]O INTERNA
CI\s*n[.ºo°]?\s*\d
PAGAMENTO POR INDENIZA
pagamento.*indeniza.*[oa]\s
```

**REQUISITOS DE CONTEUDO DA CI (5 condicionantes obrigatorios):**

Cada condicionante deve ser verificado INDIVIDUALMENTE. A CI pode nao usar exatamente
estas palavras, mas o conteudo/sentido deve estar presente:

| Sub-item | Requisito | O que buscar no texto da CI | Padroes de busca |
|---|---|---|---|
| **1.1** | Justificativa detalhada dos motivos que levaram ao fornecimento do bem ou prestacao do servico SEM observancia de procedimento licitatorio ou contratacao direta | Explicacao do por que nao houve licitacao. Ex: "continuidade do servico", "urgencia", "contrato vencido", "demanda emergencial" | `justificativ`, `motivo`, `sem.*licita`, `sem.*contrat`, `sem.*observ[aâ]ncia`, `continuidade`, `emerg[eê]ncia` |
| **1.2** | Atesto/certificacao de que o caso concreto se amolda ao Parecer Sistemico da PROJUR | Referencia expressa ao Parecer Sistemico. Ex: "conforme Parecer Sistemico", "nos termos do Parecer 001/2024" | `amolda.*parecer`, `parecer sist[eê]mico`, `Parecer.*001/2024`, `termos do parecer`, `parecer.*PROJUR` |
| **1.3** | Atesto da NAO ocorrencia de prescricao do debito (prazo < 5 anos, Decreto 20.910/32) | Declaracao de que a divida nao esta prescrita. Ex: "nao ocorreu prescricao", "dentro do prazo prescricional" | `prescri[cç][aã]o`, `n[aã]o.*prescri`, `prazo prescricional`, `20.910`, `quinquenal`, `5.*anos` |
| **1.4** | Atesto de boa-fe do prestador/fornecedor, declarando que agiu de boa-fe e NAO deu causa a nulidade contratual (pode ser documento autonomo) | Declaracao expressa de boa-fe. Ex: "o fornecedor agiu de boa-fe", "atestamos a boa-fe". ATENCAO: pode estar em documento separado da CI | `boa.f[eé]`, `n[aã]o.*deu.*causa`, `nulidade.*contratual`, `ATESTO.*BOA`, `agiu de boa` |
| **1.5** | Informacao se existe processo licitatorio em andamento para o mesmo objeto | Informacao sobre licitacao em curso ou ausencia dela. Ex: "existe processo licitatorio em andamento", "nao ha licitacao em curso" | `processo licitat[oó]rio`, `licita[cç][aã]o.*andamento`, `licita[cç][aã]o em curso`, `em andamento`, `n[aã]o h[aá].*licita` |

**Criterio de conformidade:**
- `CONFORME`: CI presente com TODOS os 5 condicionantes identificados
- `CONFORME COM RESSALVA`: CI presente, mas 1-2 condicionantes nao localizados explicitamente (podem estar implicitos)
- `PENDENTE`: CI ausente OU mais de 2 condicionantes ausentes
- CRITICO: Ausencia da CI torna o processo NAO CONFORME automaticamente

---

### ITEM 2 — Parecer Sistemico PROJUR

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.

**Descricao:** Juntada do Parecer Sistemico n. 001/2024/PROJUR/DG/FESF em cada processo
individual. O parecer original esta no Processo SEI 0022.000145/2024-38, documento SEI
n. 00000289619. Conforme o proprio parecer, deve ser juntado em cada um dos autos
administrativos em que se pretender celebrar Termo de Reconhecimento de Debito.

**Como identificar no PDF:**
- Texto integral do Parecer Sistemico (varias paginas com fundamentacao juridica)
- OU referencia ao numero do documento SEI: 00000289619
- OU referencia ao Parecer n. 001/2024/PROJUR/DG/FESF
- OU referencia ao Processo SEI 0022.000145/2024-38
- Assinatura de Diego Souza Lobao (Assessor Juridico) e/ou Roberta Graziella (Procuradora Juridica)

**Padroes de busca:**
```
Parecer.*001/2024/PROJUR
00000289619
PARECER SIST[EÊ]MICO
parecer referencial
0022\.000145/2024-38
Diego Souza Lob[aã]o
Roberta Graziella
PROJUR.*FESF
```

**Criterio de conformidade:**
- `CONFORME`: Parecer juntado (texto integral ou referencia inequivoca ao documento)
- `PENDENTE`: Nenhuma referencia ao Parecer Sistemico encontrada

---

### ITEM 3 — Nota Fiscal

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.

**Descricao:** Nota fiscal emitida pelo fornecedor referente ao servico prestado ou bem fornecido.
Pode ser NFS-e (nota de servico eletronica), NFe (nota de produto), DANFE, ou nota fiscal avulsa.

**Como identificar no PDF:**
- Documento fiscal com layout padrao (campos de emitente, destinatario, valor, ISSQN/ICMS)
- Pode ser pagina escaneada ou PDF nativo de prefeitura/SEFAZ
- Em PDFs do SEI, geralmente e um documento externo anexado

**Padroes de busca:**
```
NOTA FISCAL
NFS-?e
NFe
DANFE
N[uú]mero da Nota
PRESTADOR DE SERVI[CÇ]OS
TOMADOR DE SERVI[CÇ]OS
VALOR TOTAL
ISSQN
VALOR L[IÍ]QUIDO
Compet[eê]ncia.*\d{2}/\d{4}
```

**Verificacoes de conteudo:**

| Verificacao | O que conferir | Consequencia se irregular |
|---|---|---|
| **3.1 Presenca** | Nota fiscal localizada no processo | CRITICO se ausente |
| **3.2 CNPJ emitente** | CNPJ da nota = CNPJ do fornecedor do processo | Irregularidade grave |
| **3.3 Valor** | Valor da NF coerente com o objeto. Se servico mensal, valor compativel com 1 competencia | Ressalva |
| **3.4 Data emissao** | Data da NF compativel com o periodo/competencia do processo | Ressalva |
| **3.5 Descricao** | Descricao do servico/material na NF condizente com o objeto do processo | Ressalva |
| **3.6 Destinatario** | FESF-SUS (CNPJ 11.020.634/0001-22) ou unidade sob sua gestao como tomador | Ressalva |

**Criterio de conformidade:**
- `CONFORME`: NF presente e verificacoes 3.1 a 3.6 OK
- `CONFORME COM RESSALVA`: NF presente, mas com alguma inconsistencia menor (3.3 a 3.6)
- `PENDENTE`: NF ausente
- CRITICO: Ausencia da NF torna o processo NAO CONFORME automaticamente

---

### ITEM 4 — Atesto de Documento Externo

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.

**Descricao:** Documento SEI tipo "Atesto de Documento Externo" onde a nota fiscal e atestada
(confirmada) por autoridade competente. Modelo consta no Sistema SEI. A nota devera ser atestada
pelo Fiscal do Contrato E/OU Gestor/Coordenador da Area E/OU Diretor Administrativo E/OU
Diretor da Unidade ou Gestor de Servico e Diretor de Gestao de Servico.

**Como identificar no PDF:**
- Titulo: "ATESTO DE DOCUMENTO EXTERNO" ou "ATESTO"
- Tipo de documento SEI: "Atesto de Documento Externo"
- Texto atestando que o servico foi prestado ou material entregue conforme a nota fiscal
- Referencia ao numero da nota fiscal atestada

**Padroes de busca:**
```
ATESTO DE DOCUMENTO EXTERNO
Atesto.*[Dd]ocumento.*[Ee]xterno
ATESTAMOS
atesto.*que.*servi[cç]o
atesto.*que.*material
atesto.*que.*bem
em conformidade com.*[Nn]ota [Ff]iscal
Fiscal do Contrato
Gestor.*[AÁ]rea
Diretor.*Administrativo
```

**Verificacoes de conteudo:**

| Verificacao | O que conferir |
|---|---|
| **4.1** | Referencia ao numero da NF que esta sendo atestada |
| **4.2** | Assinatura de pelo menos UM dos responsaveis: Fiscal do Contrato, Gestor/Coordenador, Diretor Administrativo, Diretor da Unidade |
| **4.3** | Declaracao de que o servico/bem esta em conformidade com o discriminado na NF |
| **4.4** | Verificar se tambem ha atesto dos documentos externos analisados pelo Fiscal (pode ser no mesmo documento ou separado) |

**Criterio de conformidade:**
- `CONFORME`: Atesto presente, assinado, com referencia a NF
- `CONFORME COM RESSALVA`: Atesto presente mas sem referencia explicita a NF ou sem assinatura identificavel
- `PENDENTE`: Atesto ausente

---

### ITEM 5 — Contrato Social da Empresa

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.

**Descricao:** Copia do contrato social ou ultima alteracao contratual consolidada da empresa
fornecedora. Serve para comprovar a existencia juridica da empresa, seu objeto social, e
identificar os socios/representantes legais com poderes para firmar o Termo de Reconhecimento.

**Como identificar no PDF:**
- Documento extenso com clausulas societarias
- Registrado na Junta Comercial (carimbo/selo)
- Identificacao dos socios, capital social, objeto da empresa
- Pode ser "Contrato Social" original ou "Alteracao Contratual"

**Padroes de busca:**
```
CONTRATO SOCIAL
ALTERA[CÇ][AÃ]O CONTRATUAL
JUNTA COMERCIAL
objeto social
capital social
CL[AÁ]USULA.*PRIMEIRA
s[oó]cios?\s
NIRE
REGISTRO DE EMPRESA
CONSOLIDADO
```

**Verificacoes de conteudo:**

| Verificacao | O que conferir |
|---|---|
| **5.1** | Razao social confere com o fornecedor do processo |
| **5.2** | CNPJ confere com o cartao CNPJ (Item 7) |
| **5.3** | Representante legal identificado (sera cruzado com Item 6) |
| **5.4** | Poderes do representante incluem: assumir obrigacoes, reconhecer dividas e dar quitacao. Se nao incluir, exigir Procuracao (ver Item 6) |

**Criterio de conformidade:**
- `CONFORME`: Contrato social presente com dados coerentes
- `CONFORME COM RESSALVA`: Presente, mas versao desatualizada ou dados parciais
- `PENDENTE`: Ausente
- CRITICO: Ausencia torna o processo NAO CONFORME

---

### ITEM 6 — Documento de Identificacao do Representante Legal

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.

**Descricao:** Copia do documento de identidade (RG, CNH ou equivalente) do representante
legal da empresa, conforme indicado no contrato social. Se o representante nao estiver previsto
no contrato social, deve haver Procuracao com poderes especificos para reconhecer dividas
e dar quitacao em nome da empresa.

**Como identificar no PDF:**
- Imagem/escaneamento de RG, CNH ou outro documento oficial com foto
- Em PDF sem OCR: pagina com layout de documento de identidade (dificil detectar por texto)
- Se houver procuracao: texto com "PROCURACAO", poderes especificos, firma reconhecida

**Padroes de busca:**
```
CARTEIRA NACIONAL DE HABILITA[CÇ]
REGISTRO GERAL
IDENTIDADE
C[EÉ]DULA DE IDENTIDADE
PROCURA[CÇ][AÃ]O
reconhecer d[ií]vidas
dar quita[cç][aã]o
plenos poderes
```

**Verificacoes de conteudo:**

| Verificacao | O que conferir |
|---|---|
| **6.1** | Nome no documento confere com o representante indicado no Contrato Social (Item 5) |
| **6.2** | CPF/RG confere com os dados do contrato social |
| **6.3** | Se for por Procuracao: verificar se ha poderes expressos para "assumir obrigacoes, reconhecer dividas e dar quitacao em nome da empresa" |
| **6.4** | Documento dentro do prazo de validade (CNH) |

**Criterio de conformidade:**
- `CONFORME`: Documento presente e coerente com Contrato Social
- `CONFORME COM RESSALVA`: Documento presente, mas legibilidade comprometida ou dados parciais
- `PENDENTE`: Ausente. Se houver procuracao sem poderes especificos, tambem pendente

---

### ITEM 7 — Comprovante de Inscricao no CNPJ

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.

**Descricao:** Cartao do CNPJ emitido pela Receita Federal, comprovando a inscricao e
situacao cadastral da empresa. A situacao cadastral deve estar ATIVA.

**Como identificar no PDF:**
- Layout padrao do comprovante da Receita Federal
- Titulo: "COMPROVANTE DE INSCRICAO E DE SITUACAO CADASTRAL"
- Contendo: CNPJ, razao social, nome fantasia, atividades economicas (CNAEs), situacao cadastral

**Padroes de busca:**
```
COMPROVANTE DE INSCRI[CÇ][AÃ]O
SITUA[CÇ][AÃ]O CADASTRAL
CADASTRO NACIONAL DA PESSOA JUR[IÍ]DICA
CNPJ.*\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}
Atividade Econ[oô]mica Principal
ATIVA
```

**Verificacoes de conteudo:**

| Verificacao | O que conferir |
|---|---|
| **7.1** | CNPJ confere com a NF e Contrato Social |
| **7.2** | Situacao cadastral = ATIVA (se INAPTA, SUSPENSA ou BAIXADA = irregularidade grave) |
| **7.3** | Razao social confere com os demais documentos |
| **7.4** | Atividade economica (CNAE) compativel com o objeto do processo |

**Criterio de conformidade:**
- `CONFORME`: Cartao CNPJ presente, situacao ATIVA, dados coerentes
- `CONFORME COM RESSALVA`: Presente, mas com CNAE nao perfeitamente compativel
- `PENDENTE`: Ausente
- CRITICO: Ausencia torna o processo NAO CONFORME. Situacao diferente de ATIVA = irregularidade grave

---

### ITEM 8 — Certidao de Regularidade Fiscal Federal (valida)

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.
**Fundamento:** Art. 17, V e Art. 68, II, c/c Art. 72, V, Lei 14.133/2021.

**Descricao:** Certidao Conjunta de Debitos Relativos a Tributos Federais e a Divida Ativa
da Uniao, emitida pela Receita Federal do Brasil / Procuradoria-Geral da Fazenda Nacional (PGFN).
Pode ser Certidao Negativa ou Certidao Positiva com Efeitos de Negativa.

**Como identificar no PDF:**
- Emissao: Receita Federal do Brasil e/ou PGFN
- Titulo: "Certidao Negativa de Debitos" ou "Certidao Positiva com Efeitos de Negativa"
- Abrange tributos federais E divida ativa da Uniao (certidao CONJUNTA)
- Contem data de emissao e data de validade

**Padroes de busca:**
```
CERTID[AÃ]O.*[Nn]egativa.*[Dd][eé]bitos.*[Ff]ederai
CERTID[AÃ]O.*CONJUNTA
RECEITA FEDERAL
PGFN
Procuradoria.Geral da Fazenda Nacional
[Dd][eé]bitos.*[Tt]ributos [Ff]ederais
D[ií]vida Ativa da Uni[aã]o
V[aá]lid.*at[eé].*\d{2}/\d{2}/\d{4}
```

**Verificacoes de conteudo:**

| Verificacao | O que conferir |
|---|---|
| **8.1** | CNPJ na certidao confere com o fornecedor |
| **8.2** | Data de validade NAO expirada. Extrair data no formato DD/MM/AAAA |
| **8.3** | Se certidao vencida: anotar como PENDENTE com data de vencimento |

**Criterio de conformidade:**
- `CONFORME`: Certidao presente e vigente
- `CONFORME COM RESSALVA`: Certidao presente, validade nao identificavel no texto (PDF imagem)
- `PENDENTE`: Certidao ausente OU vencida (indicar data de vencimento)

---

### ITEM 9 — Certidao de Regularidade Fiscal Estadual (valida)

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.
**Fundamento:** Art. 68, III, c/c Art. 72, V, Lei 14.133/2021.

**Descricao:** Certidao de regularidade emitida pela Secretaria da Fazenda do Estado
onde a empresa esta sediada. Na Bahia: SEFAZ-BA.

**Como identificar no PDF:**
- Emissao: Secretaria da Fazenda Estadual (SEFAZ)
- Titulo contem "Certidao" + referencia a tributos estaduais ou ICMS
- Pode ser "Certidao Negativa" ou "Certidao Positiva com Efeitos de Negativa"

**Padroes de busca:**
```
CERTID[AÃ]O.*[Rr]egularidade.*[Ee]stadual
SECRETARIA DA FAZENDA
SEFAZ
[Tt]ributos [Ee]staduais
ICMS.*certid
[Rr]egularidade.*fiscal.*estad
Estado da Bahia.*certid
```

**Verificacoes:** Mesmas do Item 8 (CNPJ confere, validade vigente).

---

### ITEM 10 — Certidao de Regularidade Fiscal Municipal (valida)

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.
**Fundamento:** Art. 68, IV, c/c Art. 72, V, Lei 14.133/2021.

**Descricao:** Certidao negativa de debitos tributarios do municipio-sede da empresa.
Emitida pela Prefeitura Municipal. Abrange ISS, IPTU e demais tributos municipais.

**Como identificar no PDF:**
- Emissao: Prefeitura Municipal (do municipio da sede da empresa)
- Titulo contem "Certidao Negativa de Debitos" + referencia a tributos municipais
- Pode mencionar ISS, IPTU, taxas municipais

**Padroes de busca:**
```
CERTID[AÃ]O.*[Nn]egativa.*[Dd][eé]bitos.*[Mm]unic
PREFEITURA.*MUNICIPAL
[Tt]ributos [Mm]unicipais
ISS.*certid
ISSQN.*certid
PREFEITURA.*Salvador
PREFEITURA.*certid
[Rr]egularidade.*fiscal.*munic
```

**Verificacoes:** Mesmas do Item 8 (CNPJ confere, validade vigente).

---

### ITEM 11 — CNDT - Certidao Negativa de Debitos Trabalhistas (valida)

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.
**Fundamento:** Art. 68, V, c/c Art. 72, V, Lei 14.133/2021.

**Descricao:** Certidao emitida pelo Tribunal Superior do Trabalho (TST), comprovando
a inexistencia de debitos trabalhistas inadimplidos. Emitida gratuitamente pelo site do TST.

**Como identificar no PDF:**
- Emissao: Tribunal Superior do Trabalho / Justi[cç]a do Trabalho
- Titulo: "CERTIDAO NEGATIVA DE DEBITOS TRABALHISTAS" (CNDT)
- Contem numero de certidao, CNPJ, data de emissao, data de validade (180 dias)

**Padroes de busca:**
```
CERTID[AÃ]O NEGATIVA DE D[EÉ]BITOS TRABALHISTAS
CNDT
TRIBUNAL SUPERIOR DO TRABALHO
JUSTI[CÇ]A DO TRABALHO
d[eé]bitos trabalhistas
certid[aã]o.*trabalhist
```

**Verificacoes:** CNPJ confere, validade vigente (CNDT vale 180 dias da emissao).

---

### ITEM 12 — CRF - Certificado de Regularidade do FGTS (valido)

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.
**Fundamento:** Art. 68, II, c/c Art. 72, V, Lei 14.133/2021.

**Descricao:** Certificado emitido pela Caixa Economica Federal, comprovando regularidade
do empregador perante o Fundo de Garantia do Tempo de Servico.

**Como identificar no PDF:**
- Emissao: Caixa Economica Federal
- Titulo: "CERTIFICADO DE REGULARIDADE DO FGTS" ou "CRF"
- Layout padrao da CEF com brasao, CNPJ do empregador, data de validade

**Padroes de busca:**
```
CERTIFICADO DE REGULARIDADE.*FGTS
CRF
CAIXA ECON[OÔ]MICA FEDERAL
FUNDO DE GARANTIA
[Rr]egularidade.*FGTS
empregador.*regular
```

**Verificacoes:** CNPJ confere, validade vigente.

---

### ITEM 13 — Alvara da Vigilancia Sanitaria

**Obrigatoriedade:** CONDICIONAL — obrigatorio apenas para servicos especificos de saude.

**Aplica-se a:**
- Servicos de radiologia/diagnostico por imagem (ex: TecImagem)
- Servicos laboratoriais
- Fornecimento de gases medicinais (verificar)
- Servicos de esterilizacao
- Qualquer atividade sujeita a fiscalizacao sanitaria

**NAO se aplica a:** Limpeza, seguranca, portaria, fornecimento de materiais comuns.

**Como identificar no PDF:**
- Titulo: "ALVARA SANITARIO", "LICENCA SANITARIA", "LICENCA DE FUNCIONAMENTO"
- Emissao: Vigilancia Sanitaria (VISA), Secretaria de Saude, ANVISA
- Numero do alvara, data de emissao, atividades autorizadas

**Padroes de busca:**
```
ALVAR[AÁ].*SANIT[AÁ]RIO
LICEN[CÇ]A SANIT[AÁ]RIA
LICEN[CÇ]A DE FUNCIONAMENTO
VIGIL[AÂ]NCIA SANIT[AÁ]RIA
VISA
ANVISA
[Aa]utoriza[cç].*funcion.*sanit
```

**Criterio de conformidade:**
- `CONFORME`: Alvara presente e vigente (para tipos que exigem)
- `N/A`: Tipo de contratacao nao exige alvara sanitario
- `PENDENTE`: Exigivel mas nao encontrado

---

### ITEM 14 — Consultas CEIS, CNEP e Comprasnet.BA

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.
**Fundamento:** Art. 91, par.4o, Lei 14.133/2021.

**Descricao:** Relatorios impressos das consultas realizadas pelo Fiscal do Contrato em 3
bases de dados governamentais, comprovando que a empresa NAO esta impedida/suspensa/
declarada inidonea para licitar e contratar com a Administracao Publica.

**As 3 consultas obrigatorias:**

| Base | Nome Completo | URL de referencia |
|---|---|---|
| **CEIS** | Cadastro Nacional de Empresas Inidoneas e Suspensas | Portal da Transparencia |
| **CNEP** | Cadastro Nacional de Empresas Punidas | Portal da Transparencia |
| **Comprasnet.BA** | Sistema de Compras do Governo da Bahia | comprasnet.ba.gov.br |

**Como identificar no PDF:**
- Tela impressa / screenshot de consulta em sistema governamental
- Resultado: "Nada consta" ou "Nao foram encontrados registros"
- Cabecalho com nome da base consultada e CNPJ pesquisado

**Padroes de busca:**
```
CADASTRO NACIONAL DE EMPRESAS INID[OÔ]NEAS
CADASTRO NACIONAL DE EMPRESAS PUNIDAS
CEIS
CNEP
COMPRASNET
CEPIM
[Nn]ada consta
[Nn][aã]o foram encontrados registros
[Ii]mpedid
[Ss]uspen
[Ii]nid[oô]ne
Portal da Transpar[eê]ncia
```

**Verificacoes de conteudo:**

| Verificacao | O que conferir |
|---|---|
| **14.1** | Consulta CEIS presente (com resultado) |
| **14.2** | Consulta CNEP presente (com resultado) |
| **14.3** | Consulta Comprasnet.BA presente (com resultado) |
| **14.4** | CNPJ consultado confere com o fornecedor |
| **14.5** | Resultado: empresa NAO consta (se constar = irregularidade GRAVE, o pagamento nao pode prosseguir) |

**Criterio de conformidade:**
- `CONFORME`: 3 consultas presentes, empresa nao consta em nenhuma
- `CONFORME COM RESSALVA`: Consultas presentes mas falta 1 das 3 bases
- `PENDENTE`: Nenhuma consulta encontrada
- IRREGULARIDADE GRAVE: Empresa consta em algum cadastro restritivo

---

### ITEM 15 — Documentacao Trabalhista (cessao de mao de obra)

**Obrigatoriedade:** CONDICIONAL — obrigatorio SOMENTE quando a contratacao envolver
cessao de mao de obra (tipo `mao_de_obra`).
**Fundamento:** Art. 121, par.1o e par.2o, Lei 14.133/2021.

**Aplica-se a:** Imperio Security (seguranca), Del Mar, R8 Servicos, Alfa Servicos (limpeza),
TecImagem (radiologia com funcionarios cedidos), e similares.

**NAO se aplica a:** Fornecimento de materiais, medicamentos, gases.

**Os 7 subitens devem ser verificados INDIVIDUALMENTE:**

| Sub-item | Documento | Padroes de busca |
|---|---|---|
| **15.1** | Relacao de funcionarios vinculados ao contrato / Folha de pagamento | `RELA[CÇ][AÃ]O DE FUNCION`, `FOLHA DE PAGAMENTO`, `QUADRO DE FUNCION`, `EMPREGADOS` |
| **15.2** | Comprovante de pagamento de salarios (contracheques ou transferencias) | `SAL[AÁ]RIO`, `CONTRACHEQUE`, `HOLERITE`, `PRO.?LABORE`, `COMPROVANTE.*TRANSFER`, `PAGAMENTO.*FUNCION` |
| **15.3** | Comprovante de pagamento de vale-transporte | `VALE.?TRANSPORTE`, `VT`, `REN[UÚ]NCIA.*VALE`, `TRANSPORTE` |
| **15.4** | Comprovante de pagamento de auxilio alimentacao/refeicao | `ALIMENTA[CÇ][AÃ]O`, `REFEI[CÇ][AÃ]O`, `VALE.?ALIMENTA`, `VALE.?REFEI`, `CESTA B[AÁ]SICA` |
| **15.5** | Comprovante de recolhimento da contribuicao previdenciaria (INSS/DCTF Web) | `INSS`, `DCTF`, `PREVID[EÊ]NCI`, `GPS`, `DARF.*PREVID`, `CONTRIBUI[CÇ].*PREVIDENCI` |
| **15.6** | Guia de recolhimento do FGTS com comprovante de pagamento | `GUIA.*FGTS`, `FGTS.*GUIA`, `GRF`, `RECOLHIMENTO.*FGTS`, `COMPROVANTE.*FGTS` |
| **15.7** | Relatorio Analitico do FGTS / Extrato mensal | `RELAT[OÓ]RIO.*ANAL[IÍ]TICO.*FGTS`, `EXTRATO.*MENSAL.*FGTS`, `FGTS.*RELAT[OÓ]RIO`, `EXTRATO.*FGTS` |

**Criterio de conformidade:**
- `CONFORME`: Todos os 7 subitens presentes
- `CONFORME COM RESSALVA`: 5-6 subitens presentes (indicar quais faltam)
- `PENDENTE`: 4 ou menos subitens presentes
- `N/A`: Tipo de contratacao nao envolve cessao de mao de obra

---

### ITEM 16 — Relatorio de Evidencia do Fornecedor

**Obrigatoriedade:** CONDICIONAL — exigido para prestacao de servicos.
**NAO se aplica a:** Fornecimento de materiais/produtos.

**Descricao:** Relatorio elaborado pelo fornecedor comprovando a efetiva execucao do servico.
Pode incluir fotos, registros de presenca, registros de atividades realizadas, planilhas de
produtividade, escalas de trabalho executadas.

**Padroes de busca:**
```
RELAT[OÓ]RIO DE EVID[EÊ]NCIA
EVID[EÊ]NCIA.*FORNECEDOR
COMPROVA[CÇ].*EXECU[CÇ]
REGISTRO DE ATIVIDADE
ESCALA.*TRABALHO
PRODUTIVIDADE
```

---

### ITEM 17 — Comprovacao dos Precos Praticados (compatibilidade com mercado)

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.
**Fundamento:** Art. 23, Lei 14.133/2021.

**Descricao:** Comprovacao de que os precos cobrados pela empresa estao de acordo com
os praticados no mercado. Pode ser feita por: pesquisa de precos com outras empresas,
consulta a banco de precos, comparativo com ata de registro de precos, cotacoes,
proposta de preco da empresa contratada com comparativo.

**Como identificar no PDF:**
- "PROPOSTA DE PRECO", "PESQUISA DE PRECOS", "COTACAO"
- Tabela comparativa de precos
- Consulta a banco/painel de precos
- Proposta comercial do fornecedor

**Padroes de busca:**
```
PROPOSTA DE PRE[CÇ]O
PESQUISA DE PRE[CÇ]O
COTA[CÇ][AÃ]O
PRE[CÇ]O.*MERCADO
COMPARATIVO.*PRE[CÇ]O
BANCO DE PRE[CÇ]OS
PAINEL DE PRE[CÇ]OS
ATA DE REGISTRO
OR[CÇ]AMENTO
```

**Criterio de conformidade:**
- `CONFORME`: Pesquisa de precos ou comparativo presente
- `PENDENTE`: Nenhuma comprovacao de compatibilidade com precos de mercado

---

### ITEM 18 — Relatorio de Acompanhamento do Fiscal

**Obrigatoriedade:** CONDICIONAL — exigido para prestacao de servicos.

**Descricao:** Relatorio elaborado pelo fiscal do contrato/servico atestando o acompanhamento
da execucao. Pode ser relatorio mensal de acompanhamento com observacoes sobre
qualidade, pontualidade, ocorrencias, etc.

**Padroes de busca:**
```
RELAT[OÓ]RIO.*ACOMPANHAMENTO
RELAT[OÓ]RIO.*FISCAL
RELAT[OÓ]RIO MENSAL
FISCAL DO CONTRATO
ACOMPANHAMENTO.*CONTRATO
RELAT[OÓ]RIO.*MENSAL.*ACOMPANHAMENTO
```

---

### ITEM 19 — Checklist Mensal do Fiscal

**Obrigatoriedade:** CONDICIONAL — exigido para prestacao de servicos.

**Descricao:** Checklist preenchido mensalmente pelo fiscal do contrato/servico.
Nos casos de itens marcados como nao atendidos (negativas), devem constar
documentos que justifiquem o nao atendimento do servico.
ATENCAO: O Parecer Sistemico destaca "Atencao na construcao do documento".

**Padroes de busca:**
```
CHECK.?LIST.*FISCAL
CHECK.?LIST.*MENSAL
CHECK.?LIST.*PRESTA[CÇ]
LISTA DE VERIFICA[CÇ]
FISCAL.*PRESTA[CÇ][AÃ]O.*SERVI[CÇ]O
```

---

### ITEM 20 — Declaracao de NAO Duplicidade de Pagamento

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.

**Descricao:** Declaracao do orgao ou entidade atestando que NAO houve pagamento
anterior pelo mesmo objeto que constitui o pedido de pagamento por indenizacao.
Fundamental para evitar pagamentos em duplicidade. Ref. item 2.34 do Parecer:
"garantindo, ainda, que nao haja duplicidade de pagamentos".

**Como identificar no PDF:**
- Titulo: "DECLARACAO DE NEGATIVA DE DUPLICIDADE DE PAGAMENTO"
- Tipo de documento SEI: "Declaracao de Negativa de Duplicidade de Pagamento"
- Texto declarando que o objeto nao foi pago anteriormente

**Padroes de busca:**
```
DECLARA[CÇ][AÃ]O DE NEGATIVA DE DUPLICIDADE
DECLARA[CÇ][AÃ]O.*N[AÃ]O.*DUPLICIDADE
DUPLICIDADE DE PAGAMENTO
n[aã]o.*houve pagamento
n[aã]o.*duplicidade
NEGATIVA DE DUPLICIDADE
inexist[eê]ncia de pagamento anterior
```

**Verificacoes de conteudo:**

| Verificacao | O que conferir |
|---|---|
| **20.1** | Referencia ao objeto especifico (NF, competencia, fornecedor) |
| **20.2** | Assinatura de autoridade competente |
| **20.3** | Declaracao explicita de que nao ha pagamento anterior pelo mesmo objeto |

**Criterio de conformidade:**
- `CONFORME`: Declaracao presente com referencia ao objeto
- `PENDENTE`: Ausente
- CRITICO: Ausencia torna o processo NAO CONFORME

---

## ================================================================
## CHECKLIST 2a ETAPA — GESTOR DE CONTRATO / GESTOR DE SERVICO
## Area Responsavel: DCTI, DGH, DGS ou NUFIC (Sede)
## ================================================================

---

### ITEM 21 — DDRO (Declaracao de Disponibilidade de Recursos Orcamentarios)

**Obrigatoriedade:** OBRIGATORIO para todos os tipos.
**Fundamento:** Art. 72, IV, Lei 14.133/2021 c/c Art. 20, IX do Estatuto da FESF.

**Descricao:** Declaracao formal de que ha disponibilidade orcamentaria para arcar com
a despesa do pagamento indenizatorio. Conforme o Parecer Sistemico (item 2.28):
"devera a Administracao demonstrar no referido processo a disponibilidade orcamentaria
para arcar com a despesa, com o autorizo da Diretora Geral da FESF".

**REGRA CRITICA DE ASSINATURAS:** A DDRO devera ser assinada por:
1. Gestores que emitiram o documento
2. Diretor Imediato
3. Diretoria Geral

**Como identificar no PDF:**
- Titulo: "DECLARACAO DE DISPONIBILIDADE DE RECURSOS ORCAMENTARIOS" ou "DDRO"
- Tipo de documento SEI: "DDRO" ou similar
- Contem informacao sobre dotacao orcamentaria, fonte de recurso, elemento de despesa
- Deve ter 3 niveis de assinatura

**Padroes de busca:**
```
DDRO
DECLARA[CÇ][AÃ]O DE DISPONIBILIDADE
DISPONIBILIDADE.*RECURSO.*OR[CÇ]AMENT
RECURSO.*OR[CÇ]AMENT[AÁ]RIO
DOTA[CÇ][AÃ]O OR[CÇ]AMENT
FONTE.*RECURSO
ELEMENTO DE DESPESA
DISPONIBILIDADE OR[CÇ]AMENT
```

**Verificacoes de conteudo:**

| Verificacao | O que conferir |
|---|---|
| **21.1** | Valor declarado compativel com o valor da NF/Termo |
| **21.2** | Indicacao de dotacao orcamentaria / fonte de recurso / elemento de despesa |
| **21.3** | Assinatura dos Gestores emitentes |
| **21.4** | Assinatura do Diretor Imediato |
| **21.5** | Assinatura/autorizo da Diretoria Geral |
| **21.6** | Referencia ao processo/fornecedor/competencia |

**Criterio de conformidade:**
- `CONFORME`: DDRO presente com valor, dotacao e 3 niveis de assinatura
- `CONFORME COM RESSALVA`: DDRO presente, mas falta 1 nivel de assinatura ou dotacao nao detalhada
- `PENDENTE`: DDRO ausente

---

## CRITERIOS DE CLASSIFICACAO DO STATUS GERAL

| Status | Criterio |
|---|---|
| **CONFORME** | Todos os itens obrigatorios aplicaveis estao presentes e atendem os requisitos |
| **PARCIALMENTE CONFORME** | Itens obrigatorios presentes, mas com ressalvas ou pendencias em condicionais |
| **NAO CONFORME** | Um ou mais itens CRITICOS ausentes ou irregularidade grave |

### Itens CRITICOS (ausencia = NAO CONFORME automaticamente):
- **Item 1** — CI (Comunicacao Interna)
- **Item 3** — Nota Fiscal
- **Item 5** — Contrato Social
- **Item 7** — Comprovante CNPJ
- **Item 20** — Declaracao Nao Duplicidade

### Demais itens obrigatorios (ausencia = PARCIALMENTE CONFORME):
- Item 2 (Parecer Sistemico), Item 4 (Atesto), Item 6 (Doc Representante)
- Itens 8-12 (5 certidoes), Item 14 (CEIS/CNEP), Item 17 (Precos), Item 21 (DDRO)

---

## VERIFICACOES TRANSVERSAIS DE QUALIDADE

Alem da presenca de cada item, aplicar estas verificacoes cruzadas:

### Validade de Certidoes
Para cada certidao (Itens 8 a 12), extrair a data de validade e comparar com a data atual:
- Se validade >= hoje: `[OK] Vigente (validade: DD/MM/AAAA)`
- Se validade < hoje: `[!!] VENCIDA (validade: DD/MM/AAAA)` — anotar como pendencia

### Prescricao Quinquenal (Decreto 20.910/1932)
- Extrair a data do servico/fornecimento (competencia na NF ou CI)
- Calcular: data_atual - data_servico > 5 anos?
- Se SIM: `[!!] RISCO DE PRESCRICAO` — pendencia grave

### Coerencia de Dados entre Documentos
| Cruzamento | Documentos |
|---|---|
| CNPJ | NF (Item 3) = Cartao CNPJ (Item 7) = Contrato Social (Item 5) = Certidoes (8-12) |
| Razao Social | NF = CNPJ = Contrato Social = Termo |
| Representante Legal | Contrato Social (Item 5) = Doc Identidade (Item 6) = Assinatura no Termo |
| Valor | NF (Item 3) = DDRO (Item 21) |

### Assinaturas Obrigatorias
| Documento | Quem deve assinar |
|---|---|
| CI (Item 1) | Area solicitante (Gestor/Coordenador/Diretor da Unidade) |
| Atesto (Item 4) | Fiscal do Contrato e/ou Gestor/Coordenador e/ou Diretor |
| DDRO (Item 21) | Gestores emitentes + Diretor Imediato + Diretoria Geral |

---

## FORMATO DO RELATORIO DE AUDITORIA

```
================================================================================
  RELATORIO DE AUDITORIA — PROCESSO INDENIZATORIO
  Checklist 1a Etapa + DDRO
  Parecer Sistemico n. 001/2024/PROJUR/DG/FESF (Anexo I)
================================================================================
  Processo SEI:     XXXX.XXXXXX/XXXX-XX
  Fornecedor:       [razao social]
  CNPJ:             XX.XXX.XXX/XXXX-XX
  Unidade:          [HECC / Policlinica / etc.]
  Competencia:      [MM/AAAA]
  Valor (NF):       R$ X.XXX,XX
  Tipo:             [mao_de_obra | servico | material | gas_medicinal]
  Data da Analise:  DD/MM/AAAA

  STATUS GERAL:     [CONFORME | PARCIALMENTE CONFORME | NAO CONFORME]
  Conformidade:     XX% (XX/XX itens aplicaveis)
  Pendencias:       X itens

================================================================================
  1a ETAPA — INICIO DO PROCESSO (Unidade de Saude/Sede)
================================================================================

  [OK] Item  1: Comunicacao Interna (CI)
           -> Localizado: pag. X-Y (tipo SEI: Comunicacao Interna)
           -> 1.1 Justificativa:     [OK] "continuidade do servico..."
           -> 1.2 Parecer Sistemico: [OK] "conforme Parecer Sistemico..."
           -> 1.3 Prescricao:        [OK] "nao ocorreu prescricao..."
           -> 1.4 Boa-fe:            [!!] NAO IDENTIFICADO no texto
           -> 1.5 Proc. licitatorio: [OK] "existe licitacao em andamento..."

  [OK] Item  2: Parecer Sistemico PROJUR
           -> Localizado: pag. X-Y (doc SEI 00000289619)

  [OK] Item  3: Nota Fiscal
           -> Localizado: pag. X (NFS-e n. XXXXX)
           -> CNPJ: XX.XXX.XXX/XXXX-XX [OK confere]
           -> Valor: R$ X.XXX,XX
           -> Competencia: MM/AAAA

  [OK] Item  4: Atesto de Documento Externo
           -> Localizado: pag. X
           -> Assinado por: [nome do fiscal/gestor]
           -> Referencia NF: [OK]

  [OK] Item  5: Contrato Social
           -> Localizado: pag. X-Y

  [!!] Item  6: Documento do Representante Legal
           -> NAO ENCONTRADO

  [OK] Item  7: Comprovante CNPJ
           -> Localizado: pag. X
           -> Situacao Cadastral: ATIVA [OK]

  [OK] Item  8: Certidao Federal
           -> Localizado: pag. X | Validade: DD/MM/AAAA [OK vigente]

  [OK] Item  9: Certidao Estadual
           -> Localizado: pag. X | Validade: DD/MM/AAAA [OK vigente]

  [!!] Item 10: Certidao Municipal
           -> Localizado: pag. X | Validade: DD/MM/AAAA [!! VENCIDA]

  [OK] Item 11: CNDT
           -> Localizado: pag. X | Validade: DD/MM/AAAA [OK vigente]

  [OK] Item 12: CRF/FGTS
           -> Localizado: pag. X | Validade: DD/MM/AAAA [OK vigente]

  [--] Item 13: Alvara Vigilancia Sanitaria
           -> N/A (tipo: material)

  [OK] Item 14: Consultas CEIS/CNEP/Comprasnet
           -> CEIS: [OK] Nada consta (pag. X)
           -> CNEP: [OK] Nada consta (pag. X)
           -> Comprasnet.BA: [!!] NAO ENCONTRADO

  [OK] Item 15: Documentacao Trabalhista (mao de obra)
           -> 15.1 Relacao funcionarios: [OK] pag. X
           -> 15.2 Salarios:             [OK] pag. X
           -> 15.3 Vale-transporte:      [!!] NAO ENCONTRADO
           -> 15.4 Alimentacao:          [OK] pag. X
           -> 15.5 INSS/DCTF:           [OK] pag. X
           -> 15.6 Guia FGTS:           [OK] pag. X
           -> 15.7 Relatorio FGTS:      [OK] pag. X

  [--] Item 16: Relatorio Evidencia Fornecedor
           -> N/A (tipo: material)

  [!!] Item 17: Comprovacao Precos Mercado
           -> NAO ENCONTRADO

  [--] Item 18: Relatorio Acompanhamento Fiscal
           -> N/A (tipo: material)

  [--] Item 19: Checklist Mensal Fiscal
           -> N/A (tipo: material)

  [OK] Item 20: Declaracao Nao Duplicidade
           -> Localizado: pag. X

================================================================================
  2a ETAPA — GESTOR DE CONTRATO
================================================================================

  [OK] Item 21: DDRO
           -> Localizado: pag. X
           -> Valor: R$ X.XXX,XX [OK confere com NF]
           -> Assinatura Gestores: [OK]
           -> Assinatura Dir. Imediato: [OK]
           -> Assinatura DG: [!!] NAO IDENTIFICADA

================================================================================
  CERTIDOES — QUADRO DE VALIDADE
================================================================================
  Federal  (Item  8): DD/MM/AAAA  [OK vigente]
  Estadual (Item  9): DD/MM/AAAA  [OK vigente]
  Municipal(Item 10): DD/MM/AAAA  [!! VENCIDA em DD/MM/AAAA]
  CNDT     (Item 11): DD/MM/AAAA  [OK vigente]
  FGTS/CRF (Item 12): DD/MM/AAAA  [OK vigente]

================================================================================
  PENDENCIAS IDENTIFICADAS
================================================================================
  *** CRITICAS (impedem prosseguimento do pagamento) ***
  (nenhuma)

  *** OBRIGATORIAS ***
  1. [Item  6]    Doc. Representante Legal — NAO ENCONTRADO
  2. [Item 10]    Certidao Municipal — VENCIDA (DD/MM/AAAA)
  3. [Item 14.3]  Consulta Comprasnet.BA — NAO ENCONTRADA
  4. [Item 17]    Comprovacao Precos Mercado — NAO ENCONTRADA

  *** CONDICIONAIS / RESSALVAS ***
  5. [Item  1.4]  CI: Atesto de boa-fe nao identificado explicitamente
  6. [Item 15.3]  Doc. Trabalhista: Vale-transporte nao encontrado
  7. [Item 21.5]  DDRO: Assinatura da DG nao identificada

================================================================================
  OBSERVACOES E RECOMENDACOES
================================================================================
  1. Recomenda-se a juntada do documento de identidade do representante
     legal (Item 6) antes do encaminhamento a PROJUR.
  2. A Certidao Municipal deve ser atualizada (Item 10).
  3. Solicitar ao Fiscal a impressao da consulta ao Comprasnet.BA.
  4. Incluir pesquisa de precos de mercado (Art. 23, Lei 14.133/21).

================================================================================
  FUNDAMENTACAO LEGAL
================================================================================
  Art. 149, Lei 14.133/21 | Arts. 884-885 CC | Art. 23, Lei 14.133/21
  Arts. 17, V e 68, II-V | Art. 72, IV-V | Art. 91, par.4o
  Art. 95, par.2o | Art. 121, par.1o-2o | Dec. 20.910/1932
  Parecer Sistemico n. 001/2024/PROJUR/DG/FESF (Ato Adm. 598/24)
================================================================================
```

---

## NOTAS IMPORTANTES

1. **PDF com imagens (escaneado):** Se o PDF nao tiver texto extraivel, informar ao usuario
   e solicitar versao com OCR. Neste caso, indicar no relatorio: "Analise limitada — PDF
   baseado em imagens sem camada de texto".

2. **Processo incompleto:** Processos em andamento podem nao ter todos os itens.
   Analisar apenas o que esta presente e indicar no relatorio o estagio do processo.

3. **Rol nao exaustivo (item 2.37 do Parecer):** Dependendo do tipo de aquisicao, podem
   haver documentos adicionais exigidos. Registrar no relatorio se identificar documentos
   relevantes nao previstos no checklist.

4. **Atesto de boa-fe em documento autonomo:** O item 1.4 (boa-fe) pode estar na CI
   OU em documento separado. Buscar em todo o processo, nao apenas na CI.

5. **Apuracao de Responsabilidade:** Todo processo indenizatorio DEVE gerar abertura
   de processo administrativo de apuracao de responsabilidade (Art. 149, Lei 14.133/21).
   Esta e uma obrigacao legal, nao uma faculdade (item 2.40 do Parecer).

6. **Prescricao quinquenal:** Prazo de 5 anos contados da data do ato/fato
   (Decreto 20.910/1932, arts. 1o e 5o). Dividas prescritas NAO devem ser pagas.

7. **Procuracao (Item 6):** So e necessaria quando o representante que assinara o Termo
   NAO esta previsto no contrato social como administrador/gerente da empresa.
   A procuracao deve ter poderes ESPECIFICOS: "reconhecer dividas e dar quitacao".

8. **Certidoes vencidas:** Certidoes com validade expirada devem ser renovadas ANTES
   do pagamento. Anotar a data de vencimento como pendencia.