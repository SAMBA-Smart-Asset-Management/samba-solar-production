import { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart, Area, Bar, XAxis, YAxis, PieChart, Pie, Cell,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';

const SLOT_MS = 15 * 60 * 1000;

function toSlotKey(date) {
  const d = new Date(date);
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
  return d.getTime();
}

function toHourKey(date) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

// Build price lookup map from price array [{from, till, price}]
function buildPriceLookup(priceArray) {
  const map = {};
  if (!priceArray || !Array.isArray(priceArray)) return map;
  for (const slot of priceArray) {
    try {
      const from = new Date(slot.from).getTime();
      map[from] = slot.price;
    } catch {}
  }
  return map;
}

// Find the price for a given timestamp from a price lookup map
function findPrice(priceLookup, timestampMs, slotDurationMs) {
  // Direct match
  if (priceLookup[timestampMs] != null) return priceLookup[timestampMs];
  // Find the hourly slot that contains this timestamp
  const hourKey = toHourKey(timestampMs);
  if (priceLookup[hourKey] != null) return priceLookup[hourKey];
  // Search for the slot that this timestamp falls within
  for (const [fromMs, price] of Object.entries(priceLookup)) {
    const from = Number(fromMs);
    if (timestampMs >= from && timestampMs < from + slotDurationMs) return price;
  }
  return 0;
}

// Detect price granularity from price array (15 min or 1 hour)
function detectPriceGranularity(priceArray) {
  if (!priceArray || !Array.isArray(priceArray) || priceArray.length < 2) return 'hour';
  try {
    const from0 = new Date(priceArray[0].from).getTime();
    const till0 = new Date(priceArray[0].till).getTime();
    const diffMin = (till0 - from0) / (60 * 1000);
    return diffMin <= 15 ? 'kwartier' : 'hour';
  } catch {
    return 'hour';
  }
}

// Read a numeric entity state
function readEntityFloat(hass, entityId) {
  const state = hass?.states?.[entityId];
  if (!state || state.state === 'unavailable' || state.state === 'unknown') return null;
  const val = parseFloat(state.state);
  return isNaN(val) ? null : val;
}

const toggleGroupStyle = {
  display: 'inline-flex', borderRadius: '6px', overflow: 'hidden',
  border: '1px solid #e5e7eb',
};

const toggleBtnStyle = (active, disabled) => ({
  padding: '5px 14px', border: 'none',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: '12px', fontWeight: active ? 600 : 400,
  background: disabled ? '#fecaca' : active ? '#FDD835' : '#fff',
  color: disabled ? '#991b1b' : active ? '#1a1a1a' : '#6b7280',
  opacity: disabled ? 0.7 : 1,
  transition: 'all 0.15s',
  position: 'relative',
});

const STATUS_DOT = { ok: '#22c55e', warning: '#f59e0b', error: '#ef4444' };

export default function ProductionTodayChart({ hass, entities, colors, solarEntity }) {
  const [historyData, setHistoryData] = useState(null);
  const [resolution, setResolution] = useState('kwartier');
  const [unit, setUnit] = useState('wh');

  // Fetch history for today (all relevant entities)
  useEffect(() => {
    if (!hass?.callWS) return;
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const entityIds = [
      entities.producedEnergy15m,
      entities.exportedEnergy15m,
    ];
    if (entities.selfConsumedEnergy15m) entityIds.push(entities.selfConsumedEnergy15m);
    if (entities.selfStoredEnergy15m) entityIds.push(entities.selfStoredEnergy15m);
    if (entities.selfConsumedBatteryEnergy15m) entityIds.push(entities.selfConsumedBatteryEnergy15m);
    if (entities.exportedBatteryEnergy15m) entityIds.push(entities.exportedBatteryEnergy15m);

    hass.callWS({
      type: 'history/history_during_period',
      start_time: todayStart.toISOString(),
      end_time: now.toISOString(),
      entity_ids: entityIds,
      minimal_response: true,
      significant_changes_only: false,
    }).then(setHistoryData).catch(() => {});
  }, [hass, entities.producedEnergy15m, entities.exportedEnergy15m,
      entities.selfConsumedEnergy15m, entities.selfStoredEnergy15m,
      entities.selfConsumedBatteryEnergy15m, entities.exportedBatteryEnergy15m]);

  // Price arrays and granularity detection
  const purchasePrices = hass?.states?.[entities.purchasePrice]?.attributes?.purchase_prices_today;
  const sellingPrices = hass?.states?.[entities.sellingPrice]?.attributes?.selling_prices_today;
  const priceGranularity = useMemo(() => detectPriceGranularity(purchasePrices), [purchasePrices]);
  const purchaseLookup = useMemo(() => buildPriceLookup(purchasePrices), [purchasePrices]);
  const sellingLookup = useMemo(() => buildPriceLookup(sellingPrices), [sellingPrices]);

  // Kwartier disabled when: euro mode AND price granularity is hourly
  const kwartierDisabled = unit === 'euro' && priceGranularity === 'hour';

  // Auto-switch to uur when switching to euro with hourly prices
  useEffect(() => {
    if (unit === 'euro' && priceGranularity === 'hour' && resolution === 'kwartier') {
      setResolution('uur');
    }
  }, [unit, priceGranularity, resolution]);

  // Base 15-min chart data
  const rawChartData = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const slots = {};
    for (let t = todayStart.getTime(); t < todayEnd.getTime(); t += SLOT_MS) {
      slots[t] = { timestamp: t, produced: null, exported: null, selfConsumed: null,
                    selfStored: null, battSelfConsumed: null, battExported: null, forecast: null };
    }

    if (historyData) {
      const processEntity = (entityId, field) => {
        if (!entityId) return;
        const points = historyData[entityId] || [];
        for (const point of points) {
          const key = toSlotKey(point.lu || point.last_updated);
          if (slots[key] != null) {
            const val = parseFloat(point.s || point.state);
            if (!isNaN(val)) slots[key][field] = val * 4 * 1000; // kWh/15min → W
          }
        }
      };

      processEntity(entities.producedEnergy15m, 'produced');
      processEntity(entities.exportedEnergy15m, 'exported');
      processEntity(entities.selfConsumedEnergy15m, 'selfConsumed');
      processEntity(entities.selfStoredEnergy15m, 'selfStored');
      processEntity(entities.selfConsumedBatteryEnergy15m, 'battSelfConsumed');
      processEntity(entities.exportedBatteryEnergy15m, 'battExported');
    }

    // Forecast from solar entity watts attribute
    const watts = solarEntity?.attributes?.watts;
    if (watts && typeof watts === 'object') {
      for (const [ts, w] of Object.entries(watts)) {
        try {
          const key = toSlotKey(ts);
          if (slots[key] != null) slots[key].forecast = parseFloat(w);
        } catch {}
      }
    }

    // Fallback: calculate selfConsumed if entity not available
    for (const slot of Object.values(slots)) {
      if (slot.selfConsumed == null && slot.produced != null && slot.exported != null) {
        slot.selfConsumed = Math.max(0, slot.produced - slot.exported - (slot.selfStored || 0));
      }
    }

    return Object.values(slots).sort((a, b) => a.timestamp - b.timestamp);
  }, [historyData, solarEntity, entities]);

  // Aggregated chart data based on resolution
  const chartData = useMemo(() => {
    if (resolution === 'kwartier') return rawChartData;

    const hourly = {};
    for (const slot of rawChartData) {
      const key = toHourKey(slot.timestamp);
      if (!hourly[key]) {
        hourly[key] = { timestamp: key, fields: {} };
        for (const f of ['produced', 'exported', 'selfConsumed', 'selfStored', 'battSelfConsumed', 'battExported', 'forecast']) {
          hourly[key].fields[f] = { sum: 0, n: 0 };
        }
      }
      for (const f of ['produced', 'exported', 'selfConsumed', 'selfStored', 'battSelfConsumed', 'battExported', 'forecast']) {
        if (slot[f] != null) {
          hourly[key].fields[f].sum += slot[f];
          hourly[key].fields[f].n++;
        }
      }
    }

    return Object.values(hourly).map((h) => {
      const result = { timestamp: h.timestamp };
      for (const f of ['produced', 'exported', 'selfConsumed', 'selfStored', 'battSelfConsumed', 'battExported', 'forecast']) {
        result[f] = h.fields[f].n > 0 ? h.fields[f].sum / h.fields[f].n : null;
      }
      return result;
    }).sort((a, b) => a.timestamp - b.timestamp);
  }, [rawChartData, resolution]);

  // Convert to display unit (Wh or €)
  const displayData = useMemo(() => {
    if (unit === 'wh') return chartData;

    const hoursPerSlot = resolution === 'kwartier' ? 0.25 : 1;
    const priceDurationMs = priceGranularity === 'kwartier' ? SLOT_MS : 60 * 60 * 1000;

    return chartData.map((slot) => {
      const purchasePrice = findPrice(purchaseLookup, slot.timestamp, priceDurationMs);
      const sellingPrice = findPrice(sellingLookup, slot.timestamp, priceDurationMs);

      const toEuro = (watts, price) => {
        if (watts == null) return null;
        // W → kWh for this slot, then × price
        return (watts * hoursPerSlot / 1000) * price;
      };

      return {
        ...slot,
        // Self-consumed solar saves purchase price (didn't buy from grid)
        selfConsumed: toEuro(slot.selfConsumed, purchasePrice),
        // Exported earns selling price
        exported: toEuro(slot.exported, sellingPrice),
        // Self-stored: energy going into battery (valued at purchase price as potential savings)
        selfStored: toEuro(slot.selfStored, purchasePrice),
        // Battery self-consumed saves purchase price
        battSelfConsumed: toEuro(slot.battSelfConsumed, purchasePrice),
        // Battery exported earns selling price
        battExported: toEuro(slot.battExported, sellingPrice),
        // Forecast in selling price (potential revenue)
        forecast: toEuro(slot.forecast, sellingPrice),
      };
    });
  }, [chartData, unit, resolution, purchaseLookup, sellingLookup, priceGranularity]);

  // KPI calculations (always in kWh from raw data)
  const kpis = useMemo(() => {
    let totalProduced = 0, totalExported = 0, totalSelfConsumed = 0, peakW = 0;
    let totalSelfStored = 0, totalBattSelf = 0, totalBattExported = 0;

    for (const slot of rawChartData) {
      if (slot.produced != null) {
        totalProduced += slot.produced / 4000;
        peakW = Math.max(peakW, slot.produced);
      }
      if (slot.exported != null) totalExported += slot.exported / 4000;
      if (slot.selfConsumed != null) totalSelfConsumed += slot.selfConsumed / 4000;
      if (slot.selfStored != null) totalSelfStored += slot.selfStored / 4000;
      if (slot.battSelfConsumed != null) totalBattSelf += slot.battSelfConsumed / 4000;
      if (slot.battExported != null) totalBattExported += slot.battExported / 4000;
    }

    const selfSuffPct = totalProduced > 0 ? (totalSelfConsumed / totalProduced) * 100 : 0;

    return {
      totalProduced: totalProduced.toFixed(2),
      totalExported: totalExported.toFixed(2),
      totalSelfConsumed: totalSelfConsumed.toFixed(2),
      totalSelfStored: totalSelfStored.toFixed(2),
      totalBattSelf: totalBattSelf.toFixed(2),
      totalBattExported: totalBattExported.toFixed(2),
      peakW: Math.round(peakW),
      selfSuffPct: selfSuffPct.toFixed(0),
    };
  }, [rawChartData]);

  // System status items for status report
  const systemStatus = useMemo(() => {
    const items = [];

    items.push({
      status: solarEntity && solarEntity.state !== 'unavailable' ? 'ok' : 'error',
      onderdeel: 'Zonne-energie forecast',
      bijzonderheden: solarEntity
        ? `${solarEntity.attributes?.total_today_kwh ?? '—'} kWh verwacht vandaag`
        : 'Forecast niet beschikbaar',
    });

    const priceState = hass?.states?.[entities.sellingPrice];
    const price = priceState ? parseFloat(priceState.state) : NaN;
    items.push({
      status: !isNaN(price) ? (price >= 0 ? 'ok' : 'warning') : 'error',
      onderdeel: 'Verkoopprijs',
      bijzonderheden: !isNaN(price) ? `€${(price * 100).toFixed(1)} c/kWh` : 'Niet beschikbaar',
    });

    const prodState = hass?.states?.[entities.productionPower];
    items.push({
      status: prodState && prodState.state !== 'unavailable' && prodState.state !== 'unknown' ? 'ok' : 'error',
      onderdeel: 'Productie sensor',
      bijzonderheden: prodState && prodState.state !== 'unavailable' ? `${prodState.state} W actueel` : 'Niet beschikbaar',
    });

    if (hass?.states) {
      Object.keys(hass.states)
        .filter((id) => id.startsWith('sensor.sp_inverter_') && id.endsWith('_status'))
        .forEach((id) => {
          const state = hass.states[id];
          const name = state?.attributes?.friendly_name || id.replace('sensor.sp_inverter_', '').replace('_status', '');
          const statusText = state?.state === 'on' ? 'Actief' : state?.state === 'limited' ? 'Beperkt' : 'Uit';
          const powerText = state?.attributes?.power_w != null ? `${Math.round(state.attributes.power_w)} W` : '';
          items.push({
            status: state?.state === 'on' ? 'ok' : state?.state === 'limited' ? 'warning' : 'error',
            onderdeel: name,
            bijzonderheden: [statusText, powerText].filter(Boolean).join(' — '),
          });
        });
    }

    const scheduleEntity = hass?.states?.['sensor.sp_inverter_schedule'];
    const scheduleSlots = scheduleEntity?.attributes?.schedule;
    items.push({
      status: scheduleSlots && scheduleSlots.length > 0 ? 'ok' : 'warning',
      onderdeel: 'Inverter schema',
      bijzonderheden: scheduleSlots?.length > 0
        ? `${scheduleSlots.length} slots gepland`
        : 'Geen schema beschikbaar',
    });

    return items;
  }, [hass, entities, solarEntity]);

  // Pie chart data: energy distribution for this year
  const pieData = useMemo(() => {
    const slices = [
      { key: 'selfConsumed', label: 'Direct verbruik', entity: 'sensor.ec_self_consumed_energy_year', color: colors.selfConsumed },
      { key: 'exported', label: 'Teruggeleverd', entity: 'sensor.ec_exported_energy_year', color: colors.exported },
      { key: 'selfStored', label: 'Opgeslagen in batterij', entity: 'sensor.ec_self_stored_energy_year', color: colors.battery },
      { key: 'battSelfConsumed', label: 'Batterij → huis', entity: 'sensor.ec_self_consumed_battery_energy_year', color: '#29B6F6' },
      { key: 'battExported', label: 'Batterij → net', entity: 'sensor.ec_exported_battery_energy_year', color: colors.batteryExported },
    ];

    const data = [];
    let total = 0;

    for (const s of slices) {
      const val = readEntityFloat(hass, s.entity);
      if (val != null && val > 0) {
        data.push({ name: s.label, value: val, color: s.color, key: s.key });
        total += val;
      }
    }

    // For € mode: multiply by average price (simplified)
    if (unit === 'euro' && data.length > 0) {
      const avgPurchase = hass?.states?.[entities.purchasePrice]
        ? parseFloat(hass.states[entities.purchasePrice].state) || 0 : 0;
      const avgSelling = hass?.states?.[entities.sellingPrice]
        ? parseFloat(hass.states[entities.sellingPrice].state) || 0 : 0;

      let euroTotal = 0;
      for (const d of data) {
        // Self-consumed / battery→home → saves purchase price
        if (d.key === 'selfConsumed' || d.key === 'battSelfConsumed' || d.key === 'selfStored') {
          d.value = d.value * avgPurchase;
        } else {
          // Exported / battery→net → earns selling price
          d.value = d.value * avgSelling;
        }
        euroTotal += d.value;
      }
      return { data, total: euroTotal };
    }

    return { data, total };
  }, [hass, entities, colors, unit]);

  // Contract comparison data
  const contractData = useMemo(() => {
    const contractType = hass?.states?.['select.ep_electricity_contract_type']?.state;
    const netCostsYear = readEntityFloat(hass, 'sensor.ep_net_energy_costs_year');
    // For now we only show current costs — shadow costs need EP module update
    return { contractType, netCostsYear, shadowAvailable: false };
  }, [hass]);

  const nowMs = Date.now();
  const yLabel = unit === 'euro' ? '€' : 'W';
  const tooltipFormatter = (value, name) => {
    if (value == null) return ['—', name];
    if (unit === 'euro') return [`€${value.toFixed(4)}`, name];
    return [`${Math.round(value)} W`, name];
  };

  const barSize = resolution === 'uur' ? 20 : 3;
  const hasBattery = rawChartData.some((s) => s.selfStored != null || s.battSelfConsumed != null || s.battExported != null);

  return (
    <div>
      {/* Section title */}
      <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#1a1a1a', margin: '0 0 12px' }}>
        Productie vandaag
      </h2>

      {/* Toggle row */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
        <div style={toggleGroupStyle}>
          <button
            style={toggleBtnStyle(resolution === 'kwartier', kwartierDisabled)}
            onClick={() => !kwartierDisabled && setResolution('kwartier')}
            title={kwartierDisabled ? 'Prijsdata is alleen per uur beschikbaar' : 'Toon per kwartier'}
          >
            Kwartier
          </button>
          <button
            style={toggleBtnStyle(resolution === 'uur', false)}
            onClick={() => setResolution('uur')}
          >
            Uur
          </button>
        </div>
        <div style={toggleGroupStyle}>
          <button style={toggleBtnStyle(unit === 'wh', false)} onClick={() => setUnit('wh')}>Wh</button>
          <button style={toggleBtnStyle(unit === 'euro', false)} onClick={() => setUnit('euro')}>€</button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {[
          { label: 'Productie', value: `${kpis.totalProduced} kWh`, color: colors.solar },
          { label: 'Eigenverbruik', value: `${kpis.totalSelfConsumed} kWh`, color: colors.selfConsumed },
          { label: 'Teruggeleverd', value: `${kpis.totalExported} kWh`, color: colors.exported },
          { label: 'Piek', value: `${kpis.peakW} W`, color: colors.solar },
          { label: 'Eigenverbruik %', value: `${kpis.selfSuffPct}%`, color: colors.selfConsumed },
          ...(hasBattery ? [
            { label: 'Opgeslagen', value: `${kpis.totalSelfStored} kWh`, color: colors.battery },
            { label: 'Batterij → huis', value: `${kpis.totalBattSelf} kWh`, color: '#29B6F6' },
            { label: 'Batterij → net', value: `${kpis.totalBattExported} kWh`, color: colors.batteryExported },
          ] : []),
        ].map((kpi) => (
          <div key={kpi.label} style={{
            padding: '10px 14px', borderRadius: '8px',
            background: '#fff', border: `1px solid ${colors.border}`,
            minWidth: '100px',
          }}>
            <div style={{ fontSize: '11px', color: colors.textLight, marginBottom: '4px' }}>{kpi.label}</div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: kpi.color }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Main chart */}
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={displayData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
            label={{ value: yLabel, position: 'insideTopLeft', offset: -5, style: { fontSize: 11 } }}
          />
          <Tooltip labelFormatter={formatTime} formatter={tooltipFormatter} />
          <Legend />

          {/* Forecast area */}
          <Area
            dataKey="forecast" name="Forecast"
            fill={colors.solarLight} fillOpacity={0.2}
            stroke={colors.solarLight} strokeDasharray="5 5" strokeWidth={1.5}
            connectNulls
          />

          {/* Stacked bars: solar production breakdown */}
          <Bar dataKey="selfConsumed" name="Eigenverbruik" stackId="prod" fill={colors.selfConsumed} fillOpacity={0.7} barSize={barSize} />
          <Bar dataKey="exported" name="Teruggeleverd" stackId="prod" fill={colors.exported} fillOpacity={0.7} barSize={barSize} />
          {hasBattery && (
            <Bar dataKey="selfStored" name="Opgeslagen in batterij" stackId="prod" fill={colors.battery} fillOpacity={0.7} barSize={barSize} />
          )}
          {/* Stacked bars: battery discharge */}
          {hasBattery && (
            <Bar dataKey="battSelfConsumed" name="Batterij → huis" stackId="batt" fill="#29B6F6" fillOpacity={0.7} barSize={barSize} />
          )}
          {hasBattery && (
            <Bar dataKey="battExported" name="Batterij → net" stackId="batt" fill={colors.batteryExported} fillOpacity={0.7} barSize={barSize} />
          )}

          <ReferenceLine
            x={resolution === 'uur' ? toHourKey(nowMs) : toSlotKey(nowMs)}
            stroke="#999" strokeDasharray="3 3"
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Pie chart: Energy distribution year */}
      {pieData.data.length > 0 && (
        <div style={{ marginTop: '32px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#1a1a1a', margin: '0 0 12px' }}>
            Energieverdeling zonnesysteem
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
            <ResponsiveContainer width={280} height={280}>
              <PieChart>
                <Pie
                  data={pieData.data}
                  cx="50%" cy="50%"
                  innerRadius={70} outerRadius={110}
                  dataKey="value"
                  paddingAngle={2}
                >
                  {pieData.data.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => unit === 'euro'
                    ? `€${value.toFixed(2)}`
                    : `${value.toFixed(1)} kWh`
                  }
                />
                {/* Center label */}
                <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle"
                  style={{ fontSize: '20px', fontWeight: 600, fill: '#1a1a1a' }}>
                  {unit === 'euro'
                    ? `€${pieData.total.toFixed(0)}`
                    : `${pieData.total.toFixed(0)} kWh`
                  }
                </text>
                <text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle"
                  style={{ fontSize: '11px', fill: '#6b7280' }}>
                  dit jaar
                </text>
              </PieChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {pieData.data.map((entry) => (
                <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: entry.color, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '12px', color: colors.text, fontWeight: 500 }}>{entry.name}</div>
                    <div style={{ fontSize: '11px', color: colors.textLight }}>
                      {unit === 'euro'
                        ? `€${entry.value.toFixed(2)}`
                        : `${entry.value.toFixed(1)} kWh`
                      }
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Contract comparison */}
      <div style={{ marginTop: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#1a1a1a', margin: '0 0 12px' }}>
          Vergelijking contracttype
        </h2>
        {contractData.netCostsYear != null ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <div style={{ fontSize: '13px', color: colors.text, width: '140px' }}>
                {contractData.contractType === 'Dynamic' ? 'Dynamisch' : 'Vast'} (huidig)
              </div>
              <div style={{ flex: 1, position: 'relative', height: '28px', background: '#f3f4f6', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{
                  width: '100%', height: '100%',
                  background: contractData.netCostsYear >= 0 ? colors.warning : colors.selfConsumed,
                  opacity: 0.7, borderRadius: '4px',
                }} />
                <span style={{
                  position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
                  fontSize: '12px', fontWeight: 600, color: '#1a1a1a',
                }}>
                  €{contractData.netCostsYear.toFixed(2)}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '13px', color: colors.textLight, width: '140px' }}>
                {contractData.contractType === 'Dynamic' ? 'Vast' : 'Dynamisch'} (alternatief)
              </div>
              <div style={{
                flex: 1, height: '28px', background: '#f3f4f6', borderRadius: '4px',
                display: 'flex', alignItems: 'center', paddingLeft: '8px',
              }}>
                <span style={{ fontSize: '11px', color: colors.textLight, fontStyle: 'italic' }}>
                  Beschikbaar na update energy-pricing module
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ color: '#9ca3af', fontSize: '13px' }}>
            Geen kostendata beschikbaar (sensor ep_net_energy_costs_year)
          </div>
        )}
      </div>

      {/* Status rapport */}
      <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#1a1a1a', margin: '32px 0 12px' }}>
        Status rapport
      </h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${colors.border}` }}>
            <th style={{ width: '12px', padding: '8px 6px 8px 0', textAlign: 'left' }}></th>
            <th style={{ padding: '8px 12px', textAlign: 'left', color: colors.textLight, fontWeight: 600, fontSize: '12px' }}>Status</th>
            <th style={{ padding: '8px 12px', textAlign: 'left', color: colors.textLight, fontWeight: 600, fontSize: '12px' }}>Onderdeel</th>
            <th style={{ padding: '8px 12px', textAlign: 'left', color: colors.textLight, fontWeight: 600, fontSize: '12px' }}>Bijzonderheden</th>
          </tr>
        </thead>
        <tbody>
          {systemStatus.map((item, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${colors.border}` }}>
              <td style={{ width: '12px', padding: '8px 6px 8px 0' }}>
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  backgroundColor: STATUS_DOT[item.status] || '#9ca3af',
                }} />
              </td>
              <td style={{ padding: '8px 12px', color: colors.text, fontWeight: 500 }}>
                {item.status === 'ok' ? 'OK' : item.status === 'warning' ? 'Waarschuwing' : 'Fout'}
              </td>
              <td style={{ padding: '8px 12px', color: colors.text }}>{item.onderdeel}</td>
              <td style={{ padding: '8px 12px', color: colors.textLight }}>{item.bijzonderheden}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
