import { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart, Area, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';

const SLOT_MS = 15 * 60 * 1000;

function toSlotKey(date) {
  const d = new Date(date);
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
  return d.getTime();
}

function formatTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

export default function ProductionTodayChart({ hass, entities, colors, solarEntity }) {
  const [historyData, setHistoryData] = useState(null);

  useEffect(() => {
    if (!hass?.callWS) return;

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    hass.callWS({
      type: 'history/history_during_period',
      start_time: todayStart.toISOString(),
      end_time: now.toISOString(),
      entity_ids: [entities.producedEnergy15m, entities.exportedEnergy15m],
      minimal_response: true,
      significant_changes_only: false,
    }).then((result) => {
      setHistoryData(result);
    }).catch(() => {});
  }, [hass, entities.producedEnergy15m, entities.exportedEnergy15m]);

  const chartData = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const slots = {};

    // Initialize all slots for today
    for (let t = todayStart.getTime(); t < todayEnd.getTime(); t += SLOT_MS) {
      slots[t] = { timestamp: t, produced: null, exported: null, selfConsumed: null, forecast: null };
    }

    // Fill history data
    if (historyData) {
      const produced = historyData[entities.producedEnergy15m] || [];
      for (const point of produced) {
        const key = toSlotKey(point.lu || point.last_updated);
        if (slots[key] != null) {
          const val = parseFloat(point.s || point.state);
          if (!isNaN(val)) {
            // kWh per 15 min → W average
            slots[key].produced = val * 4 * 1000;
          }
        }
      }

      const exported = historyData[entities.exportedEnergy15m] || [];
      for (const point of exported) {
        const key = toSlotKey(point.lu || point.last_updated);
        if (slots[key] != null) {
          const val = parseFloat(point.s || point.state);
          if (!isNaN(val)) {
            slots[key].exported = val * 4 * 1000;
          }
        }
      }
    }

    // Fill forecast from solar entity watts attribute
    const watts = solarEntity?.attributes?.watts;
    if (watts && typeof watts === 'object') {
      for (const [ts, w] of Object.entries(watts)) {
        try {
          const key = toSlotKey(ts);
          if (slots[key] != null) {
            slots[key].forecast = parseFloat(w);
          }
        } catch {}
      }
    }

    // Calculate self-consumed = produced - exported
    for (const slot of Object.values(slots)) {
      if (slot.produced != null && slot.exported != null) {
        slot.selfConsumed = Math.max(0, slot.produced - slot.exported);
      }
    }

    return Object.values(slots).sort((a, b) => a.timestamp - b.timestamp);
  }, [historyData, solarEntity, entities]);

  // KPI calculations
  const kpis = useMemo(() => {
    let totalProduced = 0;
    let totalExported = 0;
    let totalSelfConsumed = 0;
    let peakW = 0;

    for (const slot of chartData) {
      if (slot.produced != null) {
        totalProduced += slot.produced / 4000; // W → kWh per 15 min
        peakW = Math.max(peakW, slot.produced);
      }
      if (slot.exported != null) totalExported += slot.exported / 4000;
      if (slot.selfConsumed != null) totalSelfConsumed += slot.selfConsumed / 4000;
    }

    const selfSuffPct = totalProduced > 0 ? (totalSelfConsumed / totalProduced) * 100 : 0;

    return {
      totalProduced: totalProduced.toFixed(2),
      totalExported: totalExported.toFixed(2),
      totalSelfConsumed: totalSelfConsumed.toFixed(2),
      peakW: Math.round(peakW),
      selfSuffPct: selfSuffPct.toFixed(0),
    };
  }, [chartData]);

  const nowMs = Date.now();

  return (
    <div>
      <div style={{ display: 'flex', gap: '24px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {[
          { label: 'Productie', value: `${kpis.totalProduced} kWh`, color: colors.solar },
          { label: 'Eigenverbruik', value: `${kpis.totalSelfConsumed} kWh`, color: colors.selfConsumed },
          { label: 'Teruggeleverd', value: `${kpis.totalExported} kWh`, color: colors.exported },
          { label: 'Piek', value: `${kpis.peakW} W`, color: colors.solar },
          { label: 'Eigenverbruik %', value: `${kpis.selfSuffPct}%`, color: colors.selfConsumed },
        ].map((kpi) => (
          <div key={kpi.label} style={{
            padding: '12px 16px', borderRadius: '8px',
            background: '#fff', border: `1px solid ${colors.border}`,
            minWidth: '120px',
          }}>
            <div style={{ fontSize: '11px', color: colors.textLight, marginBottom: '4px' }}>{kpi.label}</div>
            <div style={{ fontSize: '20px', fontWeight: 600, color: kpi.color }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatTime}
            tick={{ fontSize: 11, fill: colors.textLight }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: colors.textLight }}
            label={{ value: 'W', position: 'insideTopLeft', offset: -5, style: { fontSize: 11 } }}
          />
          <Tooltip
            labelFormatter={formatTime}
            formatter={(value, name) => [value != null ? `${Math.round(value)} W` : '—', name]}
          />
          <Legend />

          {/* Forecast as light area */}
          <Area
            dataKey="forecast"
            name="Forecast"
            fill={colors.solarLight}
            fillOpacity={0.2}
            stroke={colors.solarLight}
            strokeDasharray="5 5"
            strokeWidth={1.5}
            connectNulls
          />

          {/* Self-consumed (stacked bottom) */}
          <Bar dataKey="selfConsumed" name="Eigenverbruik" stackId="production" fill={colors.selfConsumed} fillOpacity={0.7} barSize={3} />

          {/* Exported (stacked top) */}
          <Bar dataKey="exported" name="Teruggeleverd" stackId="production" fill={colors.exported} fillOpacity={0.7} barSize={3} />

          {/* Now line */}
          <ReferenceLine x={toSlotKey(nowMs)} stroke="#999" strokeDasharray="3 3" label="" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
