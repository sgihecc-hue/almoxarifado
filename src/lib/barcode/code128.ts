// =====================================================================
// Gerador de Code 128 (subset B) — sem dependência externa (CSP-safe).
// Codifica qualquer texto ASCII 32..126 (letras, números, ponto, traço),
// perfeito para os códigos do almoxarifado (ex.: 42.40.00.00150468-1).
// Retorna a lista de larguras de módulos, começando por uma BARRA.
// =====================================================================

// Padrões oficiais do Code 128 (índice = valor do símbolo). Cada string são
// 6 larguras (barra,espaço,barra,espaço,barra,espaço); o STOP (106) tem 7.
const PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
]

const START_B = 104
const STOP = 106

/** Codifica `value` em Code 128-B. Retorna larguras de módulos (começa em barra). */
export function code128(value: string): number[] {
  const clean = (value ?? '').replace(/[^\x20-\x7E]/g, '') // só ASCII imprimível
  const codes: number[] = [START_B]
  let checksum = START_B
  for (let i = 0; i < clean.length; i++) {
    const val = clean.charCodeAt(i) - 32 // subset B: ASCII 32 => valor 0
    codes.push(val)
    checksum += val * (i + 1)
  }
  codes.push(checksum % 103)
  codes.push(STOP)

  const modules: number[] = []
  for (const c of codes) {
    for (const ch of PATTERNS[c]) modules.push(Number(ch))
  }
  return modules
}
