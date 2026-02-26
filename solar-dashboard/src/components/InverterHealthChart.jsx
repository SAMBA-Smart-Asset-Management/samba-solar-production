import { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';

const SLOT_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

export default function InverterHealthChart({ hass, entities, colors, solarEntity }) {
  const [historyData, setHistoryData] = useState(null);
  const [range, setRange] = useState('today');

  // Find all inverter status sensors
  const inverterEntities = useMemo(() => {
    if (!hass?.states) return [];
    return Object.keys(hass.states)
      .filter((id) => id.startsWith('sensor.sp_inverter_') && id.endsWith('_status'))
      .map((id) => ({
        entityId: id,
        name: hass.states[id]?.attributes?.friendly_name || id.replace('sensor.sp_inverter_', '').replace('_status', ''),
        ratedPower: hass.states[id]?.attributes?.rated_power_w || 0,
      }));
  }, [hass]);

  useEffect(() => {
    if (!hass?.callWS || !inverterEntities.length) return;

    const now = new Date();
    const start = new Date(now);
    if (range === 'today') {
      start.setHours(0, 0, 0, 0);
    } else {
      start.setTime(now.getTime() - 7 * DAY_MS);
      start.setHours(0, 0, 0, 0);
    }

    const powerSensors = inverterEntities.map((inv) => {
      const id = inv.entityId.replace('_status', '');
      // Try to find actual power sensor from attributes
      const powerSensor = hass.states[inv.entityId]?.attributes?.power_sensor;
      return powerSensor || `${id}_power`;
    }).filter((id) => hass.states[id]);

    if (!powerSensors.length) return;

    const entityIds = [...powerSensors];
    if (entities.productionPower) entityIds.push(entities.productionPower);

    hass.callWS({
      type: 'history/history_during_period',
      start_time: start.toISOString(),
      end_time: now.toISOString(),
      entity_ids: entityIds,
      minimal_response: true,
      significant_changes_only: false,
    }).then(setHistoryData).catch(() => {});
  }, [hass, range, inverterEntities, entities.productionPower]);

  // Build chart data: actual production vs forecast ratio
  const { chartData, healthMetrics } = useMemo(() => {
    const watts = solarEntity?.attributes?.watts;
    const forecastMap = {};

    if (watts && typeof watts === 'object') {
      for (const [ts, w] of Object.entries(watts)) {
        try {
          const d = new Date(ts);
          const key = d.getTime();
          forecastMap[key] = parseFloat(w);
        } catch {}
      }
    }

    // Build slots from production power history
    const slots = {};
    if (historyData && entities.productionPower) {
      const points = historyData[entities.productionPower] || [];
      for (const point of points) {
        const d = new Date(point.lu || point.last_updated);
        const slotMs = Math.floor(d.getTime() / SLOT_MS) * SLOT_MS;
        const val = parseFloat(point.s || point.state);
        if (!isNaN(val)) {
          slots[slotMs] = { timestamp: slotMs, actual: val };
        }
      }
    }

    // Match forecast to actual
    let totalActual = 0;
    let totalForecast = 0;
    let deviationSlots = 0;
    let totalSlots = 0;

    for (const slot of Object.values(slots)) {
      // Find closest forecast
      let bestForecast = null;
      let bestDist = Infinity;
      for (const [fMs, fW] of Object.entries(forecastMap)) {
        const dist = Math.abs(parseInt(fMs) - slot.timestamp);
        if (dist < bestDist && dist < SLOT_MS) {
          bestDist = dist;
          bestForecast = fW;
        }
      }

      slot.forecast = bestForecast;
      if (bestForecast != null && bestForecast > 50 && slot.actual != null) {
        slot.ratio = (slot.actual / bestForecast) * 100;
        totalActual += slot.actual;
        totalForecast += bestForecast;
        totalSlots++;
        if (Math.abs(slot.ratio - 100) > 15) deviationSlots++;
      }
    }

    const data = Object.values(slots).sort((a, b) => a.timestamp - b.timestamp);
    const overallRatio = totalForecast > 0 ? (totalActual / totalForecast) * 100 : null;
    const deviationPct = totalSlots > 0 ? (deviationSlots / totalSlots) * 100 : 0;

    return {
      chartData: data,
      healthMetrics: { overallRatio, deviationPct, totalSlots },
    };
  }, [historyData, solarEntity, entities.productionPower]);

  const getRatioColor = (ratio) => {
    if (ratio == null) return colors.textLight;
    if (ratio >= 85 && ratio <= 115) return colors.selfConsumed;
    if (ratio >= 70 && ratio <= 130) return colors.exported;
    return colors.warning;
  };

  return (
    <div>
      {/* Range selector */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {[
          { key: 'today', label: 'Vandaag' },
          { key: 'week', label: 'Week' },
        ].map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: `1px solid ${colors.border}`,
              background: range === r.key ? colors.solar : '#fff',
              color: range === r.key ? '#1a1a1a' : colors.textLight,
              fontWeight: range === r.key ? 600 : 400,
              cursor: 'pointer', fontSize: '13px',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Health KPIs */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{
          padding: '12px 16px', borderRadius: '8px',
          background: '#fff', border: `1px solid ${colors.border}`, minWidth: '140px',
        }}>
          <div style={{ fontSize: '11px', color: colors.textLight, marginBottom: '4px' }}>Productie / Forecast</div>
          <div style={{
            fontSize: '20px', fontWeight: 600,
            color: getRatioColor(healthMetrics.overallRatio),
          }}>
            {healthMetrics.overallRatio != null ? `${healthMetrics.overallRatio.toFixed(0)}%` : '—'}
          </div>
        </div>
        <div style={{
          padding: '12px 16px', borderRadius: '8px',
          background: '#fff', border: `1px solid ${colors.border}`, minWidth: '140px',
        }}>
          <div style={{ fontSize: '11px', color: colors.textLight, marginBottom: '4px' }}>Afwijkingen (&gt;15%)</div>
          <div style={{
            fontSize: '20px', fontWeight: 600,
            color: healthMetrics.deviationPct > 30 ? colors.warning : colors.selfConsumed,
          }}>
            {healthMetrics.totalSlots > 0 ? `${healthMetrics.deviationPct.toFixed(0)}%` : '—'}
          </div>
        </div>
        {inverterEntities.map((inv) => {
          const state = hass?.states?.[inv.entityId];
          return (
            <div key={inv.entityId} style={{
              padding: '12px 16px', borderRadius: '8px',
              background: '#fff', border: `1px solid ${colors.border}`, minWidth: '140px',
            }}>
              <div style={{ fontSize: '11px', color: colors.textLight, marginBottom: '4px' }}>{inv.name}</div>
              <div style={{ fontSize: '20px', fontWeight: 600, color: colors.solar }}>
                {state?.attributes?.power_w != null ? `${Math.round(state.attributes.power_w)} W` : state?.state || '—'}
              </div>
              <div style={{ fontSize: '11px', color: colors.textLight }}>
                {state?.attributes?.mode || ''} · {inv.ratedPower ? `${inv.ratedPower} W nom.` : ''}
              </div>
            </div>
          );
        })}
      </div>

      {/* Chart: actual vs forecast */}
      {!chartData.length ? (
        <div style={{ color: '#9ca3af', textAlign: 'center', marginTop: '40px' }}>
          Geen gezondheidsdata beschikbaar
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={range === 'today' ? formatTime : formatDay}
              tick={{ fontSize: 11, fill: colors.textLight }}
            />
            <YAxis
              yAxisId="watts"
              tick={{ fontSize: 11, fill: colors.textLight }}
              label={{ value: 'W', position: 'insideTopLeft', offset: -5, style: { fontSize: 11 } }}
            />
            <YAxis
              yAxisId="ratio"
              orientation="right"
              domain={[0, 150]}
              tick={{ fontSize: 11, fill: colors.textLight }}
              label={{ value: '%', position: 'insideTopRight', offset: -5, style: { fontSize: 11 } }}
            />
            <Tooltip
              labelFormatter={range === 'today' ? formatTime : formatDay}
              formatter={(value, name) => {
                if (name === 'Ratio') return [value != null ? `${value.toFixed(0)}%` : '—', name];
                return [value != null ? `${Math.round(value)} W` : '—', name];
              }}
            />
            <Legend />
            <ReferenceLine yAxisId="ratio" y={100} stroke="#9ca3af" strokeDasharray="3 3" label="" />
            <ReferenceLine yAxisId="ratio" y={85} stroke={colors.exported} strokeDasharray="2 4" />
            <ReferenceLine yAxisId="ratio" y={115} stroke={colors.exported} strokeDasharray="2 4" />
            <Bar
              yAxisId="watts"
              dataKey="actual"
              name="Actueel"
              fill={colors.solar}
              fillOpacity={0.7}
              barSize={3}
            />
            <Line
              yAxisId="watts"
              dataKey="forecast"
              name="Forecast"
              stroke={colors.solarLight}
              strokeDasharray="5 5"
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
            <Line
              yAxisId="ratio"
              dataKey="ratio"
              name="Ratio"
              stroke={colors.selfConsumed}
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
