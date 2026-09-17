// =====================================================================
// Ligar/desligar os Painéis de TV e definir o horário em que rodam.
//
// POR QUE ISTO EXISTE: cada painel aberto faz uma consulta por minuto,
// direto, sem parar. Uma TV ligada 24h gera 1.440 consultas por dia
// SOZINHA, mesmo de madrugada com o hospital sem ninguém pedindo nada.
// Com o banco no plano free, essa carga constante é parte do motivo das
// quedas.
//
// Decisão de 12/09/2026 (Adonias):
//   - Farmácia: DESATIVADO. O setor não usa o painel.
//   - Almoxarifado: só das 7h às 18h, que é quando o setor trabalha.
//
// Para religar a farmácia: PAINEL_FARMACIA_ATIVO = true.
// Para mudar o horário do almoxarifado: ajuste as horas abaixo.
// Fora isso, nada precisa ser tocado — o código dos painéis continua
// inteiro, só não busca dado quando está desligado.
// =====================================================================

// Religado em 17/09/2026 (Adonias): o banco saiu do plano free para a VPS.
export const PAINEL_FARMACIA_ATIVO = true

// Janela do painel do almoxarifado, em hora cheia do relógio local.
// INICIO inclusivo, FIM exclusivo: 7 e 18 significa das 07:00 às 17:59.
export const PAINEL_ALMOX_HORA_INICIO = 7
export const PAINEL_ALMOX_HORA_FIM = 18

/** Se o painel do almoxarifado deve estar buscando dados agora. */
export function painelAlmoxNoHorario(agora: Date = new Date()): boolean {
  const h = agora.getHours()
  return h >= PAINEL_ALMOX_HORA_INICIO && h < PAINEL_ALMOX_HORA_FIM
}

export const JANELA_ALMOX_TEXTO =
  `${String(PAINEL_ALMOX_HORA_INICIO).padStart(2, '0')}h às ` +
  `${String(PAINEL_ALMOX_HORA_FIM).padStart(2, '0')}h`
