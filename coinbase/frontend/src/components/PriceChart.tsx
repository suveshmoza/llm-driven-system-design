import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, type IChartApi } from 'lightweight-charts';
import type { Candle } from '../types';

interface PriceChartProps {
  candles: Candle[];
  symbol: string;
}

/** Renders a TradingView lightweight candlestick chart with responsive resizing. */
export function PriceChart({ candles, symbol: _symbol }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Remove existing chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
      layout: {
        background: { color: '#16171A' },
        textColor: '#8A919E',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: '#2C2D33' },
        horzLines: { color: '#2C2D33' },
      },
      crosshair: {
        mode: 0,
        vertLine: {
          color: '#8A919E',
          width: 1,
          style: 2,
          labelBackgroundColor: '#1E2026',
        },
        horzLine: {
          color: '#8A919E',
          width: 1,
          style: 2,
          labelBackgroundColor: '#1E2026',
        },
      },
      rightPriceScale: {
        borderColor: '#2C2D33',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: '#2C2D33',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00C087',
      downColor: '#FF3B30',
      borderDownColor: '#FF3B30',
      borderUpColor: '#00C087',
      wickDownColor: '#FF3B30',
      wickUpColor: '#00C087',
    });

    if (candles.length > 0) {
      const formattedCandles = candles.map((c) => ({
        time: c.time as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      candlestickSeries.setData(formattedCandles);
      chart.timeScale().fitContent();
    }

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [candles]);

  return (
    <div ref={chartContainerRef} className="w-full">
      {candles.length === 0 && (
        <div className="flex items-center justify-center h-[400px] text-cb-text-secondary">
          <div className="text-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cb-primary mx-auto mb-2" />
            <p className="text-sm">Loading chart data...</p>
          </div>
        </div>
      )}
    </div>
  );
}
