import { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGES = {
  week: { label: 'Week', days: 7 },
  month: { label: 'Maand', days: 30 },
  year: { label: 'Jaar', days: 365 },
};

function formatDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

function formatMonth(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' });
}

export default function HistoricalChart({ hass, entities, colors }) {
  const [range, setRange] = useState('week');
  const [historyData, setHistoryData] = useState(null);

  useEffect(() => {
    if (!hass?.callWS) return;

    const now = new Date();
    const start = new Date(now.getTime() - RANGES[range].days * DAY_MS);
    start.setHours(0, 0, 0, 0);

    hass.callWS({
      type: 'history/history_during_period',
      start_time: start.toISOString(),
      end_time: now.toISOString(),
      entity_ids: [entities.producedEnergy15m, entities.exportedEnergy15m],
      minimal_response: true,
      significant_changes_only: false,
    }).then(setHistoryData).catch(() => {});
  }, [hass, range, entities.producedEnergy15m, entities.exportedEnergy15m]);

  const chartData = useMemo(() => {
    if (!historyData) return [];

    const dayMap = {};

    const processEntity = (entityId, field) => {
      const points = historyData[entityId] || [];
      for (const point of points) {
        const d = new Date(point.lu || point.last_updated);
        const dayKey = new Date(d).setHours(0, 0, 0, 0);
        if (!dayMap[dayKey]) dayMap[dayKey] = { day: dayKey, produced: 0, exported: 0, selfConsumed: 0 };
        const val = parseFloat(point.s || point.state);
        if (!isNaN(val)) {
          dayMap[dayKey][field] += val;
        }
      }
    };

    processEntity(entities.producedEnergy15m, 'produced');
    processEntity(entities.exportedEnergy15m, 'exported');

    // Calculate self-consumed per day
    for (const day of Object.values(dayMap)) {
      day.selfConsumed = Math.max(0, day.produced - day.exported);
    }

    // For year view: aggregate to months
    if (range === 'year') {
      const monthMap = {};
      for (const day of Object.values(dayMap)) {
        const d = new Date(day.day);
        const monthKey = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
        if (!monthMap[monthKey]) monthMap[monthKey] = { day: monthKey, produced: 0, exported: 0, selfConsumed: 0 };
        monthMap[monthKey].produced += day.produced;
        monthMap[monthKey].exported += day.exported;
        monthMap[monthKey].selfConsumed += day.selfConsumed;
      }
      return Object.values(monthMap).sort((a, b) => a.day - b.day);
    }

    return Object.values(dayMap).sort((a, b) => a.day - b.day);
  }, [historyData, range, entities]);

  const formatter = range === 'year' ? formatMonth : formatDate;

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {Object.entries(RANGES).map(([key, { label }]) => (
          <button
            key={key}
            onClick={() => setRange(key)}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: `1px solid ${colors.border}`,
              background: range === key ? colors.solar : '#fff',
              color: range === key ? '#1a1a1a' : colors.textLight,
              fontWeight: range === key ? 600 : 400,
              cursor: 'pointer', fontSize: '13px',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {!chartData.length ? (
        <div style={{ color: '#9ca3af', textAlign: 'center', marginTop: '40px' }}>
          Geen historische data beschikbaar
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis
              dataKey="day"
              tickFormatter={formatter}
              tick={{ fontSize: 11, fill: colors.textLight }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: colors.textLight }}
              label={{ value: 'kWh', position: 'insideTopLeft', offset: -5, style: { fontSize: 11 } }}
            />
            <Tooltip
              labelFormatter={formatter}
              formatter={(value) => [`${value.toFixed(2)} kWh`]}
            />
            <Legend />
            <Bar dataKey="selfConsumed" name="Eigenverbruik" stackId="a" fill={colors.selfConsumed} />
            <Bar dataKey="exported" name="Teruggeleverd" stackId="a" fill={colors.exported} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
