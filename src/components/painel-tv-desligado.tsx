import { MonitorOff, Clock } from 'lucide-react'

// Tela que o Painel de TV mostra quando esta desligado (setor nao usa) ou
// fora do horario de funcionamento. Enquanto ela esta no ar o painel NAO
// consulta o banco — e esse o ponto: TV ligada 24h fazia 1.440 consultas
// por dia sem ninguem olhando.
//
// Fica escura de proposito: e uma TV na parede, ligada a noite inteira.
export function PainelDesligado({
  titulo,
  detalhe,
  tipo = 'desligado',
}: {
  titulo: string
  detalhe: string
  tipo?: 'desligado' | 'fora-de-horario'
}) {
  const Icone = tipo === 'fora-de-horario' ? Clock : MonitorOff
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b1220] text-center px-8">
      <div className="max-w-xl">
        <Icone className="w-20 h-20 mx-auto text-slate-500 mb-6" strokeWidth={1.5} />
        <h1 className="text-3xl font-semibold text-slate-200 mb-3">{titulo}</h1>
        <p className="text-slate-400 text-lg leading-relaxed">{detalhe}</p>
        <p className="text-slate-600 text-sm mt-10">
          Sistema de Gestão Integrada — HECC
        </p>
      </div>
    </div>
  )
}
