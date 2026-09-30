// Cor de cada estoque da farmácia (30/09/2026): fundo da tela e faixa
// "Você está no estoque" mudam conforme o estoque ativo, para ninguém lançar
// numa farmácia achando que está em outra (caso: empréstimo do Hospital Naval
// da CAF lançado na SAT_1).
export interface CorEstoque {
  nome: string
  destaque: string // ícone/borda da faixa
  texto: string // texto forte da faixa
  faixa: string // fundo da faixa
  fundoClaro: string
  fundoEscuro: string
}

export const CORES_ESTOQUE: Record<string, CorEstoque> = {
  CAF: {
    nome: 'Azul',
    destaque: '#2563eb',
    texto: '#1e3a8a',
    faixa: 'linear-gradient(90deg, rgba(37,99,235,0.14), rgba(37,99,235,0.26), rgba(37,99,235,0.14))',
    fundoClaro: 'linear-gradient(135deg, #f7faff 0%, #eef4fe 25%, #e4eefd 50%, #dae7fc 75%, #d0e0fa 100%)',
    fundoEscuro: 'linear-gradient(135deg, #151d2b 0%, #18212f 25%, #1b2433 50%, #172030 75%, #141c29 100%)',
  },
  SAT_1: {
    nome: 'Verde',
    destaque: '#16a34a',
    texto: '#14532d',
    faixa: 'linear-gradient(90deg, rgba(22,163,74,0.14), rgba(22,163,74,0.26), rgba(22,163,74,0.14))',
    fundoClaro: 'linear-gradient(135deg, #f6fff8 0%, #ecfbef 25%, #e1f6e6 50%, #d6f1dc 75%, #cbecd3 100%)',
    fundoEscuro: 'linear-gradient(135deg, #15241a 0%, #18291d 25%, #1b2d20 50%, #17281c 75%, #142318 100%)',
  },
  SAT_2: {
    nome: 'Roxo',
    destaque: '#7c3aed',
    texto: '#4c1d95',
    faixa: 'linear-gradient(90deg, rgba(124,58,237,0.14), rgba(124,58,237,0.26), rgba(124,58,237,0.14))',
    fundoClaro: 'linear-gradient(135deg, #fbf8ff 0%, #f4eefe 25%, #ece3fd 50%, #e3d8fb 75%, #dacdf9 100%)',
    fundoEscuro: 'linear-gradient(135deg, #1f182b 0%, #231b30 25%, #261e34 50%, #221a30 75%, #1d1629 100%)',
  },
  SAT_T: {
    nome: 'Laranja',
    destaque: '#ea580c',
    texto: '#7c2d12',
    faixa: 'linear-gradient(90deg, rgba(234,88,12,0.14), rgba(234,88,12,0.26), rgba(234,88,12,0.14))',
    fundoClaro: 'linear-gradient(135deg, #fffaf5 0%, #fef2e6 25%, #fde9d6 50%, #fbdfc5 75%, #f9d5b4 100%)',
    fundoEscuro: 'linear-gradient(135deg, #2a1d14 0%, #2e2017 25%, #32231a 50%, #2d2016 75%, #281b12 100%)',
  },
}

export function corDoEstoque(code?: string | null): CorEstoque | null {
  return (code && CORES_ESTOQUE[code]) || null
}
