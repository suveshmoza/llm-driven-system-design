import type { ViewType } from '../../stores/calendarStore'

interface ViewSwitcherProps {
  view: ViewType
  onViewChange: (view: ViewType) => void
}

const views: { value: ViewType; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
]

export function ViewSwitcher({ view, onViewChange }: ViewSwitcherProps) {
  return (
    <div className="flex rounded-lg border border-gray-300 overflow-hidden">
      {views.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onViewChange(value)}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            view === value
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50'
          } ${value !== 'month' ? 'border-l border-gray-300' : ''}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
