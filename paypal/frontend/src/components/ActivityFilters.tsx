interface ActivityFiltersProps {
  currentFilter: string;
  onFilterChange: (filter: string) => void;
}

/** Renders filter buttons for transaction activity type (all, transfers, deposits, withdrawals). */
export function ActivityFilters({ currentFilter, onFilterChange }: ActivityFiltersProps) {
  const filters = [
    { label: 'All', value: '' },
    { label: 'Transfers', value: 'transfer' },
    { label: 'Deposits', value: 'deposit' },
    { label: 'Withdrawals', value: 'withdrawal' },
  ];

  return (
    <div className="flex space-x-2 mb-6">
      {filters.map((filter) => (
        <button
          key={filter.value}
          onClick={() => onFilterChange(filter.value)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            currentFilter === filter.value
              ? 'bg-paypal-primary text-white'
              : 'bg-paypal-bg text-paypal-secondary hover:bg-gray-200'
          }`}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}
