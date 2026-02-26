import { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const DAY_MS = 24 * 60 * 60 * 1000;

function formatMonth(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' });
}

export default function DegradationChart({ hass, entities, colors }) {
  const [historyData, setHistoryData] = useState(null);
  const [degradationRate, setDegradationRate] = useState(0.5);

  useEffect(() => {
    if (!hass?.callWS) return;

    const now = new Date();
    const start = new Date(now);
    start.setFullYear(start.getFullYear() - 2);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    hass.callWS({
      type: 'history/history_during_period',
      start_time: start.toISOString(),
      end_time: now.toISOString(),
      entity_ids: [entities.producedEnergy15m],
      minimal_response: true,
      significant_changes_only: false,
    }).then(setHistoryData).catch(() => {});
  }, [hass, entities.producedEnergy15m]);

  const chartData = useMemo(() => {
    if (!historyData) return [];

    const monthMap = {};

    const points = historyData[entities.producedEnergy15m] || [];
    for (const point of points) {
      const d = new Date(point.lu || point.last_updated);
      const monthKey = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      if (!monthMap[monthKey]) monthMap[monthKey] = { month: monthKey, total: 0, count: 0 };
      const val = parseFloat(point.s || point.state);
      if (!isNaN(val)) {
        monthMap[monthKey].total += val;
        monthMap[monthKey].count++;
      }
    }

    const months = Object.values(monthMap).sort((a, b) => a.month - b.month);
    if (months.length === 0) return [];

    // Calculate expected degradation line
    const firstMonth = months[0];
    const baselineKwh = firstMonth.total;

    return months.map((m) => {
      const monthsElapsed = (m.month - firstMonth.month) / (30 * DAY_MS);
      const yearsFraction = monthsElapsed / 12;
      const expectedFactor = 1 - (degradationRate / 100) * yearsFraction;
      const expected = baselineKwh * expectedFactor;

      // Normalize: ratio vs expected
      const performanceRatio = expected > 0 ? (m.total / expected) * 100 : null;

      return {
        month: m.month,
        production: parseFloat(m.total.toFixed(1)),
        expected: parseFloat(expected.toFixed(1)),
        performanceRatio: performanceRatio != null ? parseFloat(performanceRatio.toFixed(0)) : null,
      };
    });
  }, [historyData, degradationRate, entities.producedEnergy15m]);

  // Summary stats
  const summary = useMemo(() => {
    if (chartData.length < 2) return null;

    const first = chartData[0];
    const last = chartData[chartData.length - 1];
    const monthsSpan = (last.month - first.month) / (30 * DAY_MS);

    const actualChange = last.production > 0 && first.production > 0
      ? ((last.production - first.production) / first.production) * 100
      : null;

    const avgRatio = chartData.reduce((sum, d) => sum + (d.performanceRatio || 0), 0) / chartData.filter((d) => d.performanceRatio != null).length;

    return {
      months: Math.round(monthsSpan),
      actualChange: actualChange != null ? actualChange.toFixed(1) : null,
      avgPerformance: avgRatio.toFixed(0),
    };
  }, [chartData]);

  return (
    <div>
      {/* Degradation rate selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px', color: colors.textLight }}>Verwachte degradatie:</span>
        {[0.3, 0.5, 0.7, 1.0].map((rate) => (
          <button
            key={rate}
            onClick={() => setDegradationRate(rate)}
            style={{
              padding: '4px 10px', borderRadius: '6px', border: `1px solid ${colors.border}`,
              background: degradationRate === rate ? colors.solar : '#fff',
              color: degradationRate === rate ? '#1a1a1a' : colors.textLight,
              fontWeight: degradationRate === rate ? 600 : 400,
              cursor: 'pointer', fontSize: '12px',
            }}
          >
            {rate}%/jaar
          </button>
        ))}
      </div>

      {/* Summary */}
      {summary && (
        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div style={{
            padding: '12px 16px', borderRadius: '8px',
            background: '#fff', border: `1px solid ${colors.border}`, minWidth: '120px',
          }}>
            <div style={{ fontSize: '11px', color: colors.textLight, marginBottom: '4px' }}>Periode</div>
            <div style={{ fontSize: '20px', fontWeight: 600, color: colors.text }}>{summary.months} maanden</div>
          </div>
          <div style={{
            padding: '12px 16px', borderRadius: '8px',
            background: '#fff', border: `1px solid ${colors.border}`, minWidth: '120px',
          }}>
            <div style={{ fontSize: '11px', color: colors.textLight, marginBottom: '4px' }}>Gem. prestatie</div>
            <div style={{
              fontSize: '20px', fontWeight: 600,
              color: parseInt(summary.avgPerformance) >= 90 ? colors.selfConsumed : colors.warning,
            }}>
              {summary.avgPerformance}%
            </div>
          </div>
          {summary.actualChange != null && (
            <div style={{
              padding: '12px 16px', borderRadius: '8px',
              background: '#fff', border: `1px solid ${colors.border}`, minWidth: '120px',
            }}>
              <div style={{ fontSize: '11px', color: colors.textLight, marginBottom: '4px' }}>Werkelijke verandering</div>
              <div style={{
                fontSize: '20px', fontWeight: 600,
                color: parseFloat(summary.actualChange) >= 0 ? colors.selfConsumed : colors.warning,
              }}>
                {parseFloat(summary.actualChange) >= 0 ? '+' : ''}{summary.actualChange}%
              </div>
            </div>
          )}
        </div>
      )}

      {!chartData.length ? (
        <div style={{ color: '#9ca3af', textAlign: 'center', marginTop: '40px' }}>
          Geen historische data beschikbaar (minimaal 2 maanden nodig)
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 40, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis
              dataKey="month"
              tickFormatter={formatMonth}
              tick={{ fontSize: 11, fill: colors.textLight }}
            />
            <YAxis
              yAxisId="kwh"
              tick={{ fontSize: 11, fill: colors.textLight }}
              label={{ value: 'kWh', position: 'insideTopLeft', offset: -5, style: { fontSize: 11 } }}
            />
            <YAxis
              yAxisId="pct"
              orientation="right"
              domain={[60, 140]}
              tick={{ fontSize: 11, fill: colors.textLight }}
              label={{ value: '%', position: 'insideTopRight', offset: -5, style: { fontSize: 11 } }}
            />
            <Tooltip
              labelFormatter={formatMonth}
              formatter={(value, name) => {
                if (name === 'Prestatie %') return [value != null ? `${value}%` : '—', name];
                return [value != null ? `${value} kWh` : '—', name];
              }}
            />
            <Legend />
            <Bar
              yAxisId="kwh"
              dataKey="production"
              name="Productie"
              fill={colors.solar}
              fillOpacity={0.7}
            />
            <Line
              yAxisId="kwh"
              dataKey="expected"
              name="Verwacht"
              stroke={colors.textLight}
              strokeDasharray="5 5"
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
            <Line
              yAxisId="pct"
              dataKey="performanceRatio"
              name="Prestatie %"
              stroke={colors.selfConsumed}
              strokeWidth={2}
              dot={{ r: 3, fill: colors.selfConsumed }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
