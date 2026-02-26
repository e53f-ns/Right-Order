import { useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';

// ============================================================================
// Types
// ============================================================================

export interface ChartDataPoint {
  time: string;       // Label for x-axis (e.g. "14:30", "Feb 25")
  timestamp: number;  // Unix ms for sorting
  value: number;      // Primary y value
  value2?: number;    // Optional secondary y value
  label?: string;     // Optional tooltip label
}

export interface MiniChartProps {
  data: ChartDataPoint[];
  title: string;
  loading?: boolean;
  error?: string | null;
  height?: number;
  type?: 'line' | 'area';
  color?: string;
  color2?: string;
  label1?: string;
  label2?: string;
  unit?: string;
  referenceLine?: number;
  referenceLabel?: string;
  formatValue?: (v: number) => string;
  onClose?: () => void;
}

// ============================================================================
// Dark theme tooltip
// ============================================================================

interface DarkTooltipProps {
  active?: boolean;
  payload?: Array<{ value?: number; color?: string; dataKey?: string }>;
  label?: string;
  unit?: string;
  formatValue?: (v: number) => string;
  label1?: string;
  label2?: string;
}

function DarkTooltip({ active, payload, label, unit, formatValue, label1, label2 }: DarkTooltipProps) {
  if (!active || !payload?.length) return null;
  const fmt = formatValue ?? ((v: number) => v.toFixed(4));
  return (
    <div style={{
      backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8,
      padding: '8px 12px', fontSize: 12, color: '#e0e0e0', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    }}>
      <div style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      {payload.map((entry: { value?: number; color?: string }, idx: number) => {
        const name = idx === 0 ? (label1 ?? 'Value') : (label2 ?? 'Value 2');
        const color = entry.color ?? '#60a5fa';
        return (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color }} />
            <span style={{ color: '#94a3b8' }}>{name}:</span>
            <span style={{ fontWeight: 600, fontFamily: 'monospace', color }}>
              {fmt(entry.value ?? 0)}{unit ?? ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Spinner
// ============================================================================

function ChartSpinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10 }}>
      <div style={{
        width: 24, height: 24, border: '2px solid rgba(59,130,246,0.3)',
        borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'chartSpin 1s linear infinite',
      }} />
      <style>{`@keyframes chartSpin { to { transform: rotate(360deg) } }`}</style>
      <span style={{ color: '#64748b', fontSize: 12 }}>Loading chart data...</span>
    </div>
  );
}

// ============================================================================
// MiniChart Component
// ============================================================================

export function MiniChart({
  data,
  title,
  loading = false,
  error = null,
  height = 200,
  type = 'line',
  color = '#60a5fa',
  color2 = '#a78bfa',
  label1 = 'Value',
  label2,
  unit = '',
  referenceLine,
  referenceLabel,
  formatValue,
  onClose,
}: MiniChartProps) {
  const [hovered, setHovered] = useState(false);

  const hasData2 = data.some(d => d.value2 !== undefined);

  return (
    <div
      style={{
        backgroundColor: '#0f172a', borderRadius: 12, border: '1px solid #1e293b',
        padding: '12px 16px', position: 'relative',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>{title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {data.length > 0 && (
            <span style={{ fontSize: 11, color: '#475569' }}>{data.length} points</span>
          )}
          {onClose && hovered && (
            <button
              onClick={onClose}
              style={{
                background: 'none', border: '1px solid #334155', color: '#64748b',
                cursor: 'pointer', padding: '1px 6px', borderRadius: 4, fontSize: 11,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Chart area */}
      <div style={{ height }}>
        {loading ? (
          <ChartSpinner />
        ) : error ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#f87171', fontSize: 12 }}>
            {error}
          </div>
        ) : data.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#475569', fontSize: 12 }}>
            No chart data available
          </div>
        ) : type === 'area' ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
                {hasData2 && (
                  <linearGradient id={`grad-${color2.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color2} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={color2} stopOpacity={0} />
                  </linearGradient>
                )}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<DarkTooltip unit={unit} formatValue={formatValue} label1={label1} label2={label2} />} />
              {referenceLine !== undefined && (
                <ReferenceLine y={referenceLine} stroke="#475569" strokeDasharray="4 4" label={{ value: referenceLabel ?? '', fill: '#64748b', fontSize: 10 }} />
              )}
              <Area type="monotone" dataKey="value" stroke={color} fill={`url(#grad-${color.replace('#', '')})`} strokeWidth={2} dot={false} />
              {hasData2 && (
                <Area type="monotone" dataKey="value2" stroke={color2} fill={`url(#grad-${color2.replace('#', '')})`} strokeWidth={2} dot={false} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<DarkTooltip unit={unit} formatValue={formatValue} label1={label1} label2={label2} />} />
              {referenceLine !== undefined && (
                <ReferenceLine y={referenceLine} stroke="#475569" strokeDasharray="4 4" label={{ value: referenceLabel ?? '', fill: '#64748b', fontSize: 10 }} />
              )}
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 3, fill: color }} />
              {hasData2 && (
                <Line type="monotone" dataKey="value2" stroke={color2} strokeWidth={2} dot={false} activeDot={{ r: 3, fill: color2 }} />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
