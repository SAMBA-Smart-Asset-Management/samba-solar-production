import { useMemo } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const SLOT_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const DAY_NAMES = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

function formatDay(ms) {
  const d = new Date(ms);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

function formatTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

export default function ForecastChart({ hass, entities, colors, solarEntity }) {
  const { chartData, dailyTotals } = useMemo(() => {
    const watts = solarEntity?.attributes?.watts;
    if (!watts || typeof watts !== 'object') return { chartData: [], dailyTotals: [] };

    const data = [];
    const dayMap = {};

    // Get selling price forecast
    const priceEntity = hass?.states?.[entities.sellingPrice];
    const priceForecast = {};
    if (priceEntity?.attributes?.selling_prices_today) {
      for (const p of priceEntity.attributes.selling_prices_today) {
        if (p?.from && p?.price != null) priceForecast[new Date(p.from).getTime()] = p.price * 100;
      }
    }
    if (priceEntity?.attributes?.selling_prices_tomorrow) {
      for (const p of priceEntity.attributes.selling_prices_tomorrow) {
        if (p?.from && p?.price != null) priceForecast[new Date(p.from).getTime()] = p.price * 100;
      }
    }

    for (const [ts, w] of Object.entries(watts)) {
      try {
        const d = new Date(ts);
        const ms = d.getTime();
        const val = parseFloat(w);
        if (isNaN(val)) continue;

        // Find nearest price
        let price = null;
        for (const [pMs, pVal] of Object.entries(priceForecast)) {
          if (Math.abs(parseInt(pMs) - ms) < 60 * 60 * 1000) {
            price = pVal;
            break;
          }
        }

        data.push({ timestamp: ms, forecast: val, price });

        // Daily totals
        const dayKey = new Date(d).setHours(0, 0, 0, 0);
        if (!dayMap[dayKey]) dayMap[dayKey] = { day: dayKey, total: 0 };
        dayMap[dayKey].total += val / 1000 * 0.25; // W → kWh per 15 min
      } catch {}
    }

    data.sort((a, b) => a.timestamp - b.timestamp);
    const dailyTotals = Object.values(dayMap)
      .sort((a, b) => a.day - b.day)
      .map((d) => ({ ...d, total: d.total.toFixed(1) }));

    return { chartData: data, dailyTotals };
  }, [solarEntity, hass, entities.sellingPrice]);

  if (!chartData.length) {
    return <div style={{ color: '#9ca3af', textAlign: 'center', marginTop: '40px' }}>Geen forecast data beschikbaar</div>;
  }

  return (
    <div>
      {/* Daily summary chips */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {dailyTotals.map((d) => (
          <div key={d.day} style={{
            padding: '6px 12px', borderRadius: '6px',
            background: '#fff', border: `1px solid ${colors.border}`,
            fontSize: '12px',
          }}>
            <span style={{ color: colors.textLight }}>{formatDay(d.day)}: </span>
            <span style={{ fontWeight: 600, color: colors.solar }}>{d.total} kWh</span>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 40, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatDay}
            tick={{ fontSize: 11, fill: colors.textLight }}
          />
          <YAxis
            yAxisId="watts"
            tick={{ fontSize: 11, fill: colors.textLight }}
            label={{ value: 'W', position: 'insideTopLeft', offset: -5, style: { fontSize: 11 } }}
          />
          <YAxis
            yAxisId="price"
            orientation="right"
            tick={{ fontSize: 11, fill: colors.textLight }}
            label={{ value: '€c/kWh', position: 'insideTopRight', offset: -5, style: { fontSize: 11 } }}
          />
          <Tooltip
            labelFormatter={(ms) => `${formatDay(ms)} ${formatTime(ms)}`}
            formatter={(value, name) => {
              if (name === 'Prijs') return [value != null ? `${value.toFixed(1)} €c/kWh` : '—', name];
              return [value != null ? `${Math.round(value)} W` : '—', name];
            }}
          />
          <Legend />

          <Area
            yAxisId="watts"
            dataKey="forecast"
            name="Solar Forecast"
            fill={colors.solar}
            fillOpacity={0.3}
            stroke={colors.solar}
            strokeWidth={2}
            connectNulls
          />
          <Line
            yAxisId="price"
            dataKey="price"
            name="Prijs"
            stroke={colors.warning}
            strokeWidth={1.5}
            dot={false}
            connectNulls
            type="stepAfter"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
