import { useEffect, useRef } from 'react'
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js'
import { Pie } from 'react-chartjs-2'

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend
)

interface DepartmentConsumption {
  department: string;
  quantity: number;
  value: number;
  percentage: number;
}

interface DepartmentPieChartProps {
  data: DepartmentConsumption[];
  showValue?: boolean;
}

export function DepartmentPieChart({ 
  data, 
  showValue = true 
}: DepartmentPieChartProps) {
  const chartRef = useRef<ChartJS<'pie', number[], string>>(null)

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
        <p className="text-gray-500">Não há dados de consumo por setor para o período selecionado</p>
      </div>
    )
  }

  // Generate colors for departments
  const generateColors = (count: number) => {
    const baseColors = [
      'rgba(46, 139, 255, 0.8)',  // Blue
      'rgba(0, 204, 187, 0.8)',   // Teal
      'rgba(147, 51, 234, 0.8)',  // Purple
      'rgba(34, 197, 94, 0.8)',   // Green
      'rgba(245, 158, 11, 0.8)',  // Amber
      'rgba(239, 68, 68, 0.8)',   // Red
      'rgba(59, 130, 246, 0.8)',  // Light Blue
      'rgba(16, 185, 129, 0.8)',  // Emerald
    ]
    
    // If we need more colors than in our base set, generate them
    if (count <= baseColors.length) {
      return baseColors.slice(0, count)
    }
    
    // Generate additional colors
    const colors = [...baseColors]
    for (let i = baseColors.length; i < count; i++) {
      const r = Math.floor(Math.random() * 200 + 55)
      const g = Math.floor(Math.random() * 200 + 55)
      const b = Math.floor(Math.random() * 200 + 55)
      colors.push(`rgba(${r}, ${g}, ${b}, 0.8)`)
    }
    
    return colors
  }

  const backgroundColor = generateColors(data.length)
  const borderColor = backgroundColor.map(color => color.replace('0.8', '1'))

  // Prepare chart data
  const chartData = {
    labels: data.map(item => item.department),
    datasets: [
      {
        data: showValue ? data.map(item => item.value) : data.map(item => item.quantity),
        backgroundColor,
        borderColor,
        borderWidth: 1,
      }
    ]
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right' as const,
        labels: {
          boxWidth: 15,
          padding: 15,
          font: {
            size: 12
          }
        }
      },
      tooltip: {
        callbacks: {
          label: function(context: any) {
            const label = context.label || '';
            const value = context.raw;
            const percentage = data[context.dataIndex].percentage;
            
            if (showValue) {
              return `${label}: R$ ${value.toLocaleString('pt-BR', { 
                minimumFractionDigits: 2, 
                maximumFractionDigits: 2 
              })} (${percentage.toFixed(1)}%)`;
            } else {
              return `${label}: ${value} itens (${percentage.toFixed(1)}%)`;
            }
          }
        }
      }
    }
  }

  return (
    <Pie 
      ref={chartRef} 
      data={chartData} 
      options={options} 
      className="h-full w-full"
    />
  )
}