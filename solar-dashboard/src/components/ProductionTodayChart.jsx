import { useState, useEffect, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { GRID_DUAL, formatTime } from '../chartHelpers';

const HOUR_MS = 60 * 60 * 1000;
const Q_MS = 15 * 60 * 1000;

function tsToMs(raw) {
  if (typeof raw === 'string') return new Date(raw).getTime();
  if (typeof raw === 'number') return raw < 1e12 ? raw * 1000 : raw;
  return 0;
}

function toHourKey(date) {
  const ms = typeof date === 'number' ? (date < 1e12 ? date * 1000 : date) : new Date(date).getTime();
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function toQuarterKey(date) {
  const ms = typeof date === 'number' ? (date < 1e12 ? date * 1000 : date) : new Date(date).getTime();
  const d = new Date(ms);
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
  return d.getTime();
}

function lastPerSlot(points, keyFn) {
  const bySlot = {};
  for (const point of points) {
    const raw = point.lu ?? point.last_updated;
    if (raw == null) continue;
    const key = keyFn(tsToMs(raw));
    const val = parseFloat(point.s ?? point.state);
    if (!isNaN(val) && val >= 0) bySlot[key] = val;
  }
  return bySlot;
}

function buildPriceLookup(priceArray) {
  const map = {};
  if (!priceArray || !Array.isArray(priceArray)) return map;
  for (const slot of priceArray) {
    try { map[new Date(slot.from).getTime()] = slot.price; } catch {}
  }
  return map;
}

function findPrice(lookup, timestampMs) {
  if (lookup[timestampMs] != null) return lookup[timestampMs];
  const hourKey = toHourKey(timestampMs);
  if (lookup[hourKey] != null) return lookup[hourKey];
  return 0;
}

function detectPriceGranularity(priceArray) {
  if (!priceArray || priceArray.length < 2) return 'hour';
  try {
    const diff = new Date(priceArray[1].from).getTime() - new Date(priceArray[0].from).getTime();
    return diff <= Q_MS ? 'kwartier' : 'hour';
  } catch { return 'hour'; }
}

function readEntityFloat(hass, entityId) {
  const state = hass?.states?.[entityId];
  if (!state || state.state === 'unavailable' || state.state === 'unknown') return null;
  const val = parseFloat(state.state);
  return isNaN(val) ? null : val;
}

const matIcon = {
  fontFamily: 'Material Symbols Outlined',
  fontWeight: 'normal',
  fontStyle: 'normal',
  fontSize: '18px',
  lineHeight: 1,
  WebkitFontSmoothing: 'antialiased',
};

const KPI_ENTITIES = {
  producedDay: 'sensor.ec_produced_energy_day',
  selfConsumedDay: 'sensor.ec_self_consumed_energy_day',
  sellRevenueDay: 'sensor.ep_sell_revenue_day',
  emissionsAvoidedDay: 'sensor.ec_emissions_avoided_day',
};

export default function ProductionTodayChart({ hass, entities, colors, fonts, solarEntity }) {
  const [historyData, setHistoryData] = useState(null);
  const [viewMode, setViewMode] = useState('kWh');
  const [resolution, setResolution] = useState('uur');
  const [showConfig, setShowConfig] = useState(false);
  const configRef = useRef(null);

  useEffect(() => {
    if (!showConfig) return;
    const handler = (e) => {
      if (configRef.current && !configRef.current.contains(e.target)) setShowConfig(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showConfig]);

  // Price arrays and granularity
  const purchasePricesArr = hass?.states?.[entities.purchasePrice]?.attributes?.purchase_prices_today;
  const sellingPricesArr = hass?.states?.[entities.sellingPrice]?.attributes?.selling_prices_today;
  const priceGranularity = useMemo(() => detectPriceGranularity(purchasePricesArr), [purchasePricesArr]);
  const purchaseLookup = useMemo(() => buildPriceLookup(purchasePricesArr), [purchasePricesArr]);
  const sellingLookup = useMemo(() => buildPriceLookup(sellingPricesArr), [sellingPricesArr]);

  const hasQuarterPrices = priceGranularity === 'kwartier';

  // Auto-switch to uur when € mode and no quarter prices
  useEffect(() => {
    if (viewMode === '€' && !hasQuarterPrices && resolution === 'kwartier') {
      setResolution('uur');
    }
  }, [viewMode, hasQuarterPrices, resolution]);

  // Fetch history
  useEffect(() => {
    if (!hass?.callWS) return;
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const entityIds = resolution === 'kwartier'
      ? [entities.producedEnergy15m, entities.exportedEnergy15m, entities.selfConsumedEnergy15m, entities.selfStoredEnergy15m, entities.selfConsumedBatteryEnergy15m, entities.exportedBatteryEnergy15m].filter(Boolean)
      : [entities.selfConsumedHour, entities.exportedResidualHour, entities.selfStoredHour, entities.producedEnergyHour].filter(Boolean);

    hass.callWS({
      type: 'history/history_during_period',
      start_time: todayStart.toISOString(),
      end_time: now.toISOString(),
      entity_ids: entityIds,
      minimal_response: true,
      significant_changes_only: false,
    }).then(setHistoryData).catch(() => {});
  }, [hass, entities, resolution]);

  const sellingPrices = useMemo(() => {
    const prices = {};
    if (sellingPricesArr) {
      for (const p of sellingPricesArr) {
        if (p?.from && p?.price != null) prices[new Date(p.from).getTime()] = p.price * 100;
      }
    }
    return prices;
  }, [sellingPricesArr]);

  const chartData = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const interval = resolution === 'kwartier' ? Q_MS : HOUR_MS;
    const keyFn = resolution === 'kwartier' ? toQuarterKey : toHourKey;

    const slots = [];
    for (let t = todayStart.getTime(); t < todayEnd.getTime(); t += interval) {
      slots.push({ timestamp: t, directUse: 0, returned: 0, battery: 0, battHome: 0, battGrid: 0, forecast: null, sellingPrice: null });
    }
    const slotIndex = {};
    slots.forEach((s, i) => { slotIndex[s.timestamp] = i; });

    if (historyData && resolution === 'uur') {
      const fill = (entityId, field) => {
        if (!entityId) return;
        const bySlot = lastPerSlot(historyData[entityId] || [], keyFn);
        for (const [key, val] of Object.entries(bySlot)) {
          const idx = slotIndex[parseInt(key)];
          if (idx != null) slots[idx][field] = val;
        }
      };
      fill(entities.selfConsumedHour, 'directUse');
      fill(entities.exportedResidualHour, 'returned');
      fill(entities.selfStoredHour, 'battery');
    } else if (historyData && resolution === 'kwartier') {
      const produced = lastPerSlot(historyData[entities.producedEnergy15m] || [], keyFn);
      const exported = lastPerSlot(historyData[entities.exportedEnergy15m] || [], keyFn);
      const selfConsumed = entities.selfConsumedEnergy15m ? lastPerSlot(historyData[entities.selfConsumedEnergy15m] || [], keyFn) : {};
      const selfStored = entities.selfStoredEnergy15m ? lastPerSlot(historyData[entities.selfStoredEnergy15m] || [], keyFn) : {};
      const battHome = entities.selfConsumedBatteryEnergy15m ? lastPerSlot(historyData[entities.selfConsumedBatteryEnergy15m] || [], keyFn) : {};
      const battGrid = entities.exportedBatteryEnergy15m ? lastPerSlot(historyData[entities.exportedBatteryEnergy15m] || [], keyFn) : {};

      for (const [key, val] of Object.entries(produced)) {
        const idx = slotIndex[parseInt(key)];
        if (idx == null) continue;
        const exp = exported[parseInt(key)] || 0;
        const sc = selfConsumed[parseInt(key)];
        const ss = selfStored[parseInt(key)] || 0;

        slots[idx].directUse = sc != null ? sc : Math.max(0, val - exp - ss);
        slots[idx].returned = exp;
        slots[idx].battery = ss;
        slots[idx].battHome = battHome[parseInt(key)] || 0;
        slots[idx].battGrid = battGrid[parseInt(key)] || 0;
      }
    }

    // Forecast
    const watts = solarEntity?.attributes?.watts;
    if (watts && typeof watts === 'object') {
      const forecastSlots = {};
      for (const [ts, w] of Object.entries(watts)) {
        try {
          const key = keyFn(ts);
          if (!forecastSlots[key]) forecastSlots[key] = { sum: 0, count: 0 };
          forecastSlots[key].sum += parseFloat(w);
          forecastSlots[key].count++;
        } catch {}
      }
      for (const [key, { sum, count }] of Object.entries(forecastSlots)) {
        const idx = slotIndex[parseInt(key)];
        if (idx != null) {
          const avgW = sum / count;
          const hoursPerSlot = interval / HOUR_MS;
          slots[idx].forecast = (avgW * hoursPerSlot) / 1000;
        }
      }
    }

    // Selling prices
    for (const [ms, price] of Object.entries(sellingPrices)) {
      const idx = slotIndex[parseInt(ms)];
      if (idx != null) slots[idx].sellingPrice = price;
    }
    if (resolution === 'kwartier') {
      for (const slot of slots) {
        if (slot.sellingPrice == null) {
          const hourKey = toHourKey(slot.timestamp);
          if (sellingPrices[hourKey] != null) slot.sellingPrice = sellingPrices[hourKey];
        }
      }
    }

    return slots;
  }, [historyData, solarEntity, entities, sellingPrices, resolution]);

  // Apply view mode: multiply energy by price
  const displayData = useMemo(() => {
    if (viewMode === 'kWh') return chartData;
    return chartData.map((d) => {
      const buyPrice = findPrice(purchaseLookup, d.timestamp);
      const sellPrice = findPrice(sellingLookup, d.timestamp);
      return {
        ...d,
        directUse: d.directUse * buyPrice,
        returned: d.returned * sellPrice,
        battery: d.battery * buyPrice,
        battHome: d.battHome * buyPrice,
        battGrid: d.battGrid * sellPrice,
        forecast: d.forecast != null ? d.forecast * buyPrice : null,
      };
    });
  }, [chartData, viewMode, purchaseLookup, sellingLookup]);

  // KPIs from day sensors
  const kpis = useMemo(() => {
    const getState = (entityId) => readEntityFloat(hass, entityId);
    const totalProduced = getState(KPI_ENTITIES.producedDay);
    const totalDirectUse = getState(KPI_ENTITIES.selfConsumedDay);
    const sellRevenue = getState(KPI_ENTITIES.sellRevenueDay);
    const emissionsAvoided = getState(KPI_ENTITIES.emissionsAvoidedDay);
    const forecastTotal = solarEntity?.attributes?.total_today_kwh;

    return {
      totalProduced: totalProduced != null ? totalProduced.toFixed(1) : '—',
      forecastTotal: forecastTotal != null ? parseFloat(forecastTotal).toFixed(1) : '—',
      totalDirectUse: totalDirectUse != null ? totalDirectUse.toFixed(1) : '—',
      sellRevenue: sellRevenue != null ? sellRevenue.toFixed(2) : '—',
      emissionsAvoided: emissionsAvoided != null ? emissionsAvoided.toFixed(1) : '—',
    };
  }, [hass, solarEntity]);

  // Status items: only last update + working status
  const statusItems = useMemo(() => {
    const items = [];
    const now = Date.now();
    const fmtTime = (d) => d ? d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : null;

    const prodEntity = hass?.states?.[entities.producedEnergyHour] || hass?.states?.[entities.producedEnergy15m];
    const prodUpdated = prodEntity?.last_updated ? new Date(prodEntity.last_updated) : null;
    const prodRecent = prodUpdated && (now - prodUpdated.getTime()) < 30 * 60 * 1000;
    items.push({
      label: 'Communicatie',
      status: prodRecent ? 'green' : 'red',
      detail: prodRecent
        ? `Functioneert. Laatste update ${fmtTime(prodUpdated)}`
        : `Geen communicatie${prodUpdated ? `. Laatste update ${fmtTime(prodUpdated)}` : ''}`,
    });

    const scheduleEntity = hass?.states?.[entities.inverterSchedule];
    const scheduleUpdated = scheduleEntity?.last_updated ? new Date(scheduleEntity.last_updated) : null;
    const scheduleOk = scheduleEntity && scheduleEntity.state !== 'unavailable';
    items.push({
      label: 'Controlfuncties',
      status: scheduleOk ? 'green' : 'red',
      detail: scheduleOk
        ? `Functioneert. Laatste update ${fmtTime(scheduleUpdated) || '—'}`
        : `Niet beschikbaar${scheduleUpdated ? `. Laatste update ${fmtTime(scheduleUpdated)}` : ''}`,
    });

    const forecastOk = solarEntity && solarEntity.state !== 'unavailable';
    const forecastUpdated = solarEntity?.last_updated ? new Date(solarEntity.last_updated) : null;
    items.push({
      label: 'Forecast',
      status: forecastOk ? 'green' : 'red',
      detail: forecastOk
        ? `Functioneert. Laatste update ${fmtTime(forecastUpdated) || '—'}`
        : `Niet beschikbaar${forecastUpdated ? `. Laatste update ${fmtTime(forecastUpdated)}` : ''}`,
    });

    const forecastKwh = solarEntity?.attributes?.total_today_kwh;
    const producedKwh = parseFloat(kpis.totalProduced);
    const currentHour = new Date().getHours();
    let healthStatus, healthDetail;
    if (!forecastKwh || isNaN(producedKwh) || producedKwh <= 0 || currentHour < 8) {
      healthStatus = 'yellow';
      healthDetail = currentHour < 8
        ? 'Te vroeg voor beoordeling'
        : 'Onvoldoende data voor beoordeling';
    } else {
      const ratio = (producedKwh / forecastKwh) * 100;
      if (ratio >= 85 && ratio <= 115) {
        healthStatus = 'green';
        healthDetail = `Functioneert. ${ratio.toFixed(0)}% van forecast`;
      } else if (ratio >= 70 && ratio <= 130) {
        healthStatus = 'yellow';
        healthDetail = `Afwijking gedetecteerd. ${ratio.toFixed(0)}% van forecast`;
      } else {
        healthStatus = 'red';
        healthDetail = `Sterke afwijking. ${ratio.toFixed(0)}% van forecast`;
      }
    }
    items.push({ label: 'Health', status: healthStatus, detail: healthDetail });
    return items;
  }, [hass, entities, solarEntity, kpis.totalProduced]);

  const unitLabel = viewMode === '€' ? '€' : 'kWh';
  const hasBattery = chartData.some((d) => d.battery > 0 || d.battHome > 0 || d.battGrid > 0);

  const chartOption = useMemo(() => {
    const labels = displayData.map((d) => formatTime(d.timestamp));
    const barWidth = resolution === 'kwartier' ? 8 : 20;

    return {
      grid: GRID_DUAL,
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          if (!params?.length) return '';
          const idx = params[0].dataIndex;
          const slot = displayData[idx];
          const time = formatTime(slot?.timestamp || 0);
          let html = `<div style="font-family: 'Roboto Mono', monospace; font-size: 12px; font-weight: 500; margin-bottom: 6px; color: rgba(255,255,255,0.7)">${time}</div>`;
          for (const p of params) {
            const val = p.value;
            if (val == null || val === 0) continue;
            let formatted;
            if (p.seriesName === 'Verkoopprijs') {
              formatted = `${val.toFixed(1)} \u20acc/kWh`;
            } else {
              formatted = viewMode === '€' ? `\u20ac ${val.toFixed(3)}` : `${val.toFixed(3)} kWh`;
            }
            html += `<div style="display: flex; align-items: center; gap: 6px; margin: 3px 0; color: #fff">`;
            html += `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: ${p.color}"></span>`;
            html += `<span style="flex: 1; color: rgba(255,255,255,0.8)">${p.seriesName}</span>`;
            html += `<span style="font-weight: 600; color: #fff">${formatted}</span>`;
            html += `</div>`;
          }
          return html;
        },
      },
      legend: { show: false },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { interval: resolution === 'kwartier' ? 3 : 2, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: [
        { type: 'value', name: unitLabel, splitLine: { lineStyle: { type: 'dashed', color: '#e0e0e0' } } },
        ...(viewMode === 'kWh' ? [{ type: 'value', name: '\u20acc/kWh', splitLine: { show: false } }] : []),
      ],
      series: [
        {
          name: 'Eigenverbruik', type: 'bar', stack: 'production', yAxisIndex: 0,
          itemStyle: { color: colors.selfConsumed },
          barMaxWidth: barWidth,
          data: displayData.map((d) => d.directUse > 0 ? d.directUse : null),
        },
        {
          name: 'Teruggeleverd', type: 'bar', stack: 'production', yAxisIndex: 0,
          itemStyle: { color: colors.exported },
          barMaxWidth: barWidth,
          data: displayData.map((d) => d.returned > 0 ? d.returned : null),
        },
        {
          name: 'Opgeslagen', type: 'bar', stack: 'production', yAxisIndex: 0,
          itemStyle: { color: colors.battery, borderRadius: [2, 2, 0, 0] },
          barMaxWidth: barWidth,
          data: displayData.map((d) => d.battery > 0 ? d.battery : null),
        },
        ...(hasBattery ? [
          {
            name: 'Batterij \u2192 huis', type: 'bar', stack: 'battery', yAxisIndex: 0,
            itemStyle: { color: '#29B6F6' },
            barMaxWidth: barWidth,
            data: displayData.map((d) => d.battHome > 0 ? d.battHome : null),
          },
          {
            name: 'Batterij \u2192 net', type: 'bar', stack: 'battery', yAxisIndex: 0,
            itemStyle: { color: colors.batteryExported || '#7E57C2', borderRadius: [2, 2, 0, 0] },
            barMaxWidth: barWidth,
            data: displayData.map((d) => d.battGrid > 0 ? d.battGrid : null),
          },
        ] : []),
        {
          name: 'Forecast', type: 'line', yAxisIndex: 0,
          lineStyle: { type: 'dashed', color: colors.solar, width: 1.5 },
          areaStyle: { color: colors.solar, opacity: 0.12 },
          itemStyle: { color: colors.solar },
          showSymbol: false, connectNulls: true,
          data: displayData.map((d) => d.forecast),
        },
        ...(viewMode === 'kWh' ? [{
          name: 'Verkoopprijs', type: 'line', step: 'end', yAxisIndex: 1,
          lineStyle: { color: colors.warning, width: 1.5 },
          itemStyle: { color: colors.warning },
          showSymbol: false, connectNulls: true,
          data: displayData.map((d) => d.sellingPrice),
        }] : []),
      ],
    };
  }, [displayData, colors, viewMode, unitLabel, resolution, hasBattery]);

  // Pie chart: year totals
  const pieData = useMemo(() => {
    const slices = [
      { key: 'selfConsumed', label: 'Direct verbruik', entity: 'sensor.ec_self_consumed_energy_year', color: colors.selfConsumed },
      { key: 'exported', label: 'Teruggeleverd', entity: 'sensor.ec_exported_energy_year', color: colors.exported },
      { key: 'selfStored', label: 'Opgeslagen', entity: 'sensor.ec_self_stored_energy_year', color: colors.battery },
      { key: 'battHome', label: 'Batterij \u2192 huis', entity: 'sensor.ec_self_consumed_battery_energy_year', color: '#29B6F6' },
      { key: 'battGrid', label: 'Batterij \u2192 net', entity: 'sensor.ec_exported_battery_energy_year', color: colors.batteryExported || '#7E57C2' },
    ];
    const data = [];
    let total = 0;
    for (const s of slices) {
      const val = readEntityFloat(hass, s.entity);
      if (val != null && val > 0) {
        data.push({ name: s.label, value: parseFloat(val.toFixed(1)), color: s.color });
        total += val;
      }
    }
    return { data, total };
  }, [hass, colors]);

  // Contract comparison
  const contractData = useMemo(() => {
    const contractType = hass?.states?.['select.ep_electricity_contract_type']?.state;
    const netCostsYear = readEntityFloat(hass, 'sensor.ep_net_energy_costs_year');
    return { contractType, netCostsYear };
  }, [hass]);

  const statusColors = { green: '#16a34a', orange: '#ea580c', yellow: '#d97706', red: '#dc2626', gray: '#9ca3af' };

  const kpiStyle = (dark) => ({
    padding: '10px 14px', borderRadius: '8px',
    background: dark ? '#212121' : '#fff',
    border: dark ? 'none' : `1px solid ${colors.border}`,
    minWidth: '100px', flex: '1 1 100px',
  });

  const kpiLabelStyle = (dark) => ({
    fontSize: '12px',
    color: dark ? 'rgba(255,255,255,0.7)' : colors.textLight,
    marginBottom: '2px',
    fontWeight: 500,
    fontFamily: fonts.body,
  });

  const kpiValueStyle = (dark) => ({
    fontSize: '18px',
    fontWeight: 600,
    fontFamily: fonts.data,
    color: dark ? '#EEFF41' : colors.text,
  });

  const toggleBtn = (active, isRed) => ({
    padding: '6px 0',
    width: '80px',
    fontSize: '12px',
    fontFamily: fonts.body,
    fontWeight: active ? 600 : 400,
    border: `1px solid ${isRed ? '#dc2626' : colors.border}`,
    background: active ? colors.text : '#fff',
    color: active ? '#fff' : (isRed ? '#dc2626' : colors.textLight),
    borderRadius: '4px',
    cursor: isRed ? 'not-allowed' : 'pointer',
    transition: 'all 0.15s',
    textAlign: 'center',
  });

  return (
    <div>
      {/* Section: Productie vandaag */}
      <div style={{ fontSize: '16px', fontWeight: 600, fontFamily: fonts.body, color: colors.text, marginBottom: '12px' }}>Productie vandaag</div>

      {/* KPIs + Config */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', flex: 1 }}>
          {[
            { label: 'Productie', value: `${kpis.totalProduced} kWh`, dark: false },
            { label: 'Forecast', value: `${kpis.forecastTotal} kWh`, dark: false },
            { label: 'Direct use', value: `${kpis.totalDirectUse} kWh`, dark: true },
            { label: 'Opbrengst', value: `\u20ac ${kpis.sellRevenue}`, dark: true },
            { label: 'CO\u2082 vermeden', value: `${kpis.emissionsAvoided} kg`, dark: true },
          ].map((kpi) => (
            <div key={kpi.label} style={kpiStyle(kpi.dark)}>
              <div style={kpiLabelStyle(kpi.dark)}>{kpi.label}</div>
              <div style={kpiValueStyle(kpi.dark)}>{kpi.value}</div>
            </div>
          ))}
        </div>
        <div ref={configRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowConfig(!showConfig)}
            style={{
              width: '36px', height: '36px', borderRadius: '8px',
              border: `1px solid ${colors.border}`, background: showConfig ? colors.text : '#fff',
              color: showConfig ? '#fff' : colors.textLight,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span style={matIcon}>tune</span>
          </button>
          {showConfig && (
            <div style={{
              position: 'absolute', top: '42px', right: 0, zIndex: 100,
              background: '#fff', borderRadius: '8px', border: `1px solid ${colors.border}`,
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)', padding: '12px',
              display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '176px',
            }}>
              <div style={{ fontSize: '11px', color: colors.textLight, fontFamily: fonts.body, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Resolutie</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button style={toggleBtn(resolution === 'uur', false)} onClick={() => { setResolution('uur'); setHistoryData(null); }}>Uur</button>
                <button style={toggleBtn(resolution === 'kwartier', viewMode === '€' && !hasQuarterPrices)} onClick={() => { if (viewMode !== '€' || hasQuarterPrices) { setResolution('kwartier'); setHistoryData(null); } }}>Kwartier</button>
              </div>
              <div style={{ fontSize: '11px', color: colors.textLight, fontFamily: fonts.body, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '4px' }}>Weergave</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button style={toggleBtn(viewMode === 'kWh', false)} onClick={() => setViewMode('kWh')}>Wh</button>
                <button style={toggleBtn(viewMode === '€', false)} onClick={() => setViewMode('€')}>{'\u20ac'}</button>
              </div>
              {viewMode === '€' && !hasQuarterPrices && resolution === 'uur' && (
                <div style={{ fontSize: '10px', color: '#dc2626', fontFamily: fonts.body }}>Kwartierprijzen niet beschikbaar</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <ReactECharts option={chartOption} theme="samba" style={{ height: 400 }} notMerge={true} />

      {/* Pie chart: Energy distribution year */}
      {pieData.data.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, fontFamily: fonts.body, color: colors.text, marginBottom: '12px' }}>Energieverdeling zonnesysteem</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
            <div style={{ width: '220px', height: '220px', position: 'relative' }}>
              <ReactECharts
                option={{
                  series: [{
                    type: 'pie',
                    radius: ['55%', '80%'],
                    data: pieData.data.map((d) => ({ value: d.value, name: d.name, itemStyle: { color: d.color } })),
                    label: { show: false },
                    emphasis: { label: { show: false } },
                    padAngle: 2,
                  }],
                  tooltip: {
                    formatter: (p) => `${p.name}: ${viewMode === '€' ? `\u20ac${p.value.toFixed(2)}` : `${p.value.toFixed(1)} kWh`}`,
                  },
                  graphic: [{
                    type: 'text',
                    left: 'center', top: '42%',
                    style: { text: `${pieData.total.toFixed(0)} kWh`, fontSize: 18, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", fill: colors.text, textAlign: 'center' },
                  }, {
                    type: 'text',
                    left: 'center', top: '54%',
                    style: { text: 'dit jaar', fontSize: 11, fill: colors.textLight, textAlign: 'center' },
                  }],
                }}
                style={{ height: '220px', width: '220px' }}
                notMerge={true}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {pieData.data.map((entry) => (
                <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: entry.color, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '12px', color: colors.text, fontWeight: 500, fontFamily: fonts.body }}>{entry.name}</div>
                    <div style={{ fontSize: '11px', color: colors.textLight, fontFamily: fonts.data }}>{entry.value.toFixed(1)} kWh</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Contract comparison */}
      {contractData.netCostsYear != null && (
        <div style={{ marginTop: '24px' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, fontFamily: fonts.body, color: colors.text, marginBottom: '12px' }}>Vergelijking contracttype</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{ fontSize: '13px', color: colors.text, width: '140px', fontFamily: fonts.body }}>
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
                fontSize: '12px', fontWeight: 600, fontFamily: fonts.data, color: colors.text,
              }}>
                {'\u20ac'}{contractData.netCostsYear.toFixed(2)}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '13px', color: colors.textLight, width: '140px', fontFamily: fonts.body }}>
              {contractData.contractType === 'Dynamic' ? 'Vast' : 'Dynamisch'} (alternatief)
            </div>
            <div style={{
              flex: 1, height: '28px', background: '#f3f4f6', borderRadius: '4px',
              display: 'flex', alignItems: 'center', paddingLeft: '8px',
            }}>
              <span style={{ fontSize: '11px', color: colors.textLight, fontStyle: 'italic', fontFamily: fonts.body }}>
                Beschikbaar na update energy-pricing module
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Section: Status rapport */}
      <div style={{ fontSize: '16px', fontWeight: 600, fontFamily: fonts.body, color: colors.text, marginTop: '24px', marginBottom: '12px' }}>Status rapport</div>

      <div style={{ padding: '16px', borderRadius: '8px', background: '#fff', border: `1px solid ${colors.border}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fonts.body }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${colors.border}` }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: '11px', fontWeight: 600, color: colors.textLight, textTransform: 'uppercase', letterSpacing: '0.5px', width: '30px' }}>Status</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: '11px', fontWeight: 600, color: colors.textLight, textTransform: 'uppercase', letterSpacing: '0.5px', width: '130px' }}>Onderdeel</th>
              <th style={{ textAlign: 'left', padding: '6px 0 6px 8px', fontSize: '11px', fontWeight: 600, color: colors.textLight, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Bijzonderheden</th>
            </tr>
          </thead>
          <tbody>
            {statusItems.map((item) => (
              <tr key={item.label} style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ padding: '10px 8px', verticalAlign: 'top' }}>
                  <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: statusColors[item.status] }} />
                </td>
                <td style={{ padding: '10px 8px', fontSize: '13px', fontWeight: 600, color: colors.text, verticalAlign: 'top' }}>{item.label}</td>
                <td style={{ padding: '10px 0 10px 8px', fontSize: '12px', color: colors.textLight }}>{item.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
