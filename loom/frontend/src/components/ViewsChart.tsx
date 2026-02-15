interface ViewsChartProps {
  data: { date: string; views: number }[];
}

/** Renders a bar chart of daily video views over the analytics period. */
export function ViewsChart({ data }: ViewsChartProps) {
  if (data.length === 0) return null;

  const maxViews = Math.max(...data.map((d) => d.views), 1);
  const chartHeight = 120;

  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="flex items-end gap-1" style={{ height: chartHeight }}>
        {data.map((day, i) => {
          const height = (day.views / maxViews) * chartHeight;
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center justify-end group relative"
            >
              <div
                className="w-full bg-loom-primary/60 hover:bg-loom-primary rounded-t transition-colors min-h-[2px]"
                style={{ height: Math.max(height, 2) }}
              />
              {/* Tooltip */}
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-loom-sidebar text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10">
                {day.views} view{day.views !== 1 ? 's' : ''}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-xs text-loom-secondary">
        <span>{formatDate(data[0].date)}</span>
        <span>{formatDate(data[data.length - 1].date)}</span>
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
