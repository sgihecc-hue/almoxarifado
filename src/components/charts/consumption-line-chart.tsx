import { useEffect, useRef } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

interface ConsumptionData {
  date: string;
  quantity: number;
  value: number;
}

interface ConsumptionLineChartProps {
  data: ConsumptionData[];
  showValue?: boolean;
  period: 'daily' | 'weekly' | 'monthly';
}

export function ConsumptionLineChart({ 
  data, 
  showValue = true,
  period
}: ConsumptionLineChartProps) {
  const chartRef = useRef<ChartJS<'line', number[], string>>(null)

  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
      }
    }
  }, [])

  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">Não há dados de consumo para o período selecionado</p>
      </div>
    )
  }

  // Format dates for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    
    switch (period) {
      case 'daily':
        return format(date, 'dd/MM', { locale: ptBR })
      case 'weekly':
        return format(date, "dd/MM", { locale: ptBR })
      case 'monthly':
        return format(date, "MMM/yy", { locale: ptBR })
      default:
        return format(date, 'dd/MM', { locale: ptBR })
    }
  }

  // Sort data by date
  const sortedData = [...data].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  )

  // Prepare chart data
  const chartData = {
    labels: sortedData.map(item => formatDate(item.date)),
    datasets: [
      {
        label: 'Quantidade Consumida',
        data: sortedData.map(item => item.quantity),
        borderColor: 'rgba(46, 139, 255, 1)',
        backgroundColor: 'rgba(46, 139, 255, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: 'rgba(46, 139, 255, 1)',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
      },
      ...(showValue ? [{
        label: 'Valor (R$)',
        data: sortedData.map(item => item.value),
        borderColor: 'rgba(0, 204, 187, 1)',
        backgroundColor: 'rgba(0, 204, 187, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: 'rgba(0, 204, 187, 1)',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        yAxisID: 'y1',
      }] : [])
    ]
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: function(context: any) {
            let label = context.dataset.label || '';
            if (label) {
              label += ': ';
            }
            if (context.parsed.y !== null) {
              if (context.dataset.label === 'Valor (R$)') {
                label += new Intl.NumberFormat('pt-BR', { 
                  style: 'currency', 
                  currency: 'BRL' 
                }).format(context.parsed.y);
              } else {
                label += Math.round(context.parsed.y * 100) / 100;
              }
            }
            return label;
          }
        }
      }
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Período',
        },
        grid: {
          display: false,
        },
      },
      y: {
        type: 'linear' as const,
        display: true,
        position: 'left' as const,
        title: {
          display: true,
          text: 'Quantidade',
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.05)',
        },
        beginAtZero: true,
      },
      ...(showValue ? {
        y1: {
          type: 'linear' as const,
          display: true,
          position: 'right' as const,
          title: {
            display: true,
            text: 'Valor (R$)',
          },
          grid: {
            drawOnChartArea: false,
          },
          beginAtZero: true,
          ticks: {
            callback: function(value: any) {
              return new Intl.NumberFormat('pt-BR', { 
                style: 'currency', 
                currency: 'BRL',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
              }).format(value);
            }
          }
        }
      } : {})
    }
  }

  return (
    <Line 
      ref={chartRef}
      data={chartData} 
      options={options} 
      className="h-full w-full"
    />
  )
}