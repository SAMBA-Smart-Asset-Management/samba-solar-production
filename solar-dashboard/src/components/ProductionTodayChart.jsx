import { useState, useEffect, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { GRID_DUAL, formatTime } from '../chartHelpers';

const HOUR_MS = 60 * 60 * 1000;
const Q_MS = 15 * 60 * 1000;
const LS_KEY = 'samba_solar_resolution';

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

function readEntityFloat(hass, entityId) {
  const state = hass?.states?.[entityId];
  if (!state || state.state === 'unavailable' || state.state === 'unknown') return null;
  const val = parseFloat(state.state);
  return isNaN(val) ? null : val;
}

// Resolve HA CSS variables for ECharts (which can't use CSS vars directly)
function resolveHAColor(varName, fallback) {
  try {
    const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return val || fallback;
  } catch { return fallback; }
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
  const [resolution, setResolution] = useState(() => {
    try { return localStorage.getItem(LS_KEY) || 'kwartier'; } catch { return 'kwartier'; }
  });
  const [showConfig, setShowConfig] = useState(false);
  const configRef = useRef(null);

  // Persist resolution preference
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, resolution); } catch {}
  }, [resolution]);

  useEffect(() => {
    if (!showConfig) return;
    const handler = (e) => {
      if (configRef.current && !configRef.current.contains(e.target)) setShowConfig(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showConfig]);

  // Quarter data availability from ep_dynamic_interval
  const hasQuarterData = useMemo(() => {
    const state = hass?.states?.[entities.dynamicInterval]?.state;
    return state === '15 min';
  }, [hass, entities.dynamicInterval]);

  // Auto-switch to uur if quarter data not available
  useEffect(() => {
    if (!hasQuarterData && resolution === 'kwartier') {
      setResolution('uur');
    }
  }, [hasQuarterData, resolution]);

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
    const priceEntity = hass?.states?.[entities.sellingPrice];
    const prices = {};
    if (priceEntity?.attributes?.selling_prices_today) {
      for (const p of priceEntity.attributes.selling_prices_today) {
        if (p?.from && p?.price != null) prices[new Date(p.from).getTime()] = p.price * 100;
      }
    }
    return prices;
  }, [hass, entities.sellingPrice]);

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

    // Selling prices for secondary axis
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

  // KPIs from day sensors
  const kpis = useMemo(() => {
    const getState = (entityId) => readEntityFloat(hass, entityId);
    const totalProduced = getState(KPI_ENTITIES.producedDay);
    const totalDirectUse = getState(KPI_ENTITIES.selfConsumedDay);
    const sellRevenue = getState(KPI_ENTITIES.sellRevenueDay);
    const emissionsAvoided = getState(KPI_ENTITIES.emissionsAvoidedDay);
    const forecastTotal = solarEntity?.attributes?.total_today_kwh;

    return {
      totalProduced: totalProduced != null ? totalProduced.toFixed(1) : '\u2014',
      forecastTotal: forecastTotal != null ? parseFloat(forecastTotal).toFixed(1) : '\u2014',
      totalDirectUse: totalDirectUse != null ? totalDirectUse.toFixed(1) : '\u2014',
      sellRevenue: sellRevenue != null ? sellRevenue.toFixed(2) : '\u2014',
      emissionsAvoided: emissionsAvoided != null ? emissionsAvoided.toFixed(1) : '\u2014',
    };
  }, [hass, solarEntity]);

  // Status items
  const statusItems = useMemo(() => {
    const items = [];
    const now = Date.now();
    const fmtTime = (d) => d ? d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : null;

    // 1. Communicatie
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

    // 2. Controlfuncties
    const scheduleEntity = hass?.states?.[entities.inverterSchedule];
    const scheduleUpdated = scheduleEntity?.last_updated ? new Date(scheduleEntity.last_updated) : null;
    const scheduleOk = scheduleEntity && scheduleEntity.state !== 'unavailable';
    items.push({
      label: 'Controlfuncties',
      status: scheduleOk ? 'green' : 'red',
      detail: scheduleOk
        ? `Functioneert. Laatste update ${fmtTime(scheduleUpdated) || '\u2014'}`
        : `Niet beschikbaar${scheduleUpdated ? `. Laatste update ${fmtTime(scheduleUpdated)}` : ''}`,
    });

    // 3. Forecast (combined: availability + accuracy)
    const forecastOk = solarEntity && solarEntity.state !== 'unavailable';
    const forecastUpdated = solarEntity?.last_updated ? new Date(solarEntity.last_updated) : null;
    const forecastKwh = solarEntity?.attributes?.total_today_kwh;
    const producedKwh = parseFloat(kpis.totalProduced);
    const currentHour = new Date().getHours();

    if (!forecastOk) {
      items.push({
        label: 'Forecast',
        status: 'red',
        detail: `Niet beschikbaar${forecastUpdated ? `. Laatste update ${fmtTime(forecastUpdated)}` : ''}`,
      });
    } else if (!forecastKwh || isNaN(producedKwh) || producedKwh <= 0 || currentHour < 8) {
      items.push({
        label: 'Forecast',
        status: 'yellow',
        detail: currentHour < 8
          ? `Beschikbaar. Te vroeg voor beoordeling. Laatste update ${fmtTime(forecastUpdated) || '\u2014'}`
          : `Beschikbaar. Onvoldoende data. Laatste update ${fmtTime(forecastUpdated) || '\u2014'}`,
      });
    } else {
      const ratio = (producedKwh / forecastKwh) * 100;
      let status, label;
      if (ratio >= 95 && ratio <= 105) {
        status = 'green';
        label = 'Functioneert';
      } else if (ratio >= 85 && ratio <= 115) {
        status = 'yellow';
        label = 'Lichte afwijking';
      } else if (ratio >= 70 && ratio <= 130) {
        status = 'orange';
        label = 'Afwijking gedetecteerd';
      } else {
        status = 'red';
        label = 'Sterke afwijking';
      }
      items.push({
        label: 'Forecast',
        status,
        detail: `${label}. ${ratio.toFixed(0)}% van forecast. Laatste update ${fmtTime(forecastUpdated) || '\u2014'}`,
      });
    }

    // 4. Health (placeholder)
    items.push({
      label: 'Health',
      status: 'gray',
      detail: 'Nog niet beschikbaar',
    });

    return items;
  }, [hass, entities, solarEntity, kpis.totalProduced]);

  const hasBattery = chartData.some((d) => d.battery > 0 || d.battHome > 0 || d.battGrid > 0);

  // Resolved HA colors for ECharts
  const haTextColor = resolveHAColor('--primary-text-color', '#212121');
  const haTextLight = resolveHAColor('--secondary-text-color', '#6b7280');
  const haDivider = resolveHAColor('--divider-color', '#e5e7eb');

  const chartOption = useMemo(() => {
    const labels = displayData.map((d) => formatTime(d.timestamp));
    const barWidth = resolution === 'kwartier' ? 12 : 30;

    return {
      grid: GRID_DUAL,
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          if (!params?.length) return '';
          const idx = params[0].dataIndex;
          const slot = chartData[idx];
          const time = formatTime(slot?.timestamp || 0);
          let html = `<div style="font-family: 'Roboto Mono', monospace; font-size: 12px; font-weight: 500; margin-bottom: 6px; color: rgba(255,255,255,0.7)">${time}</div>`;
          for (const p of params) {
            const val = p.value;
            if (val == null || val === 0) continue;
            const formatted = p.seriesName === 'Verkoopprijs'
              ? `${val.toFixed(1)} \u20acc/kWh`
              : `${val.toFixed(3)} kWh`;
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
        axisLabel: { interval: resolution === 'kwartier' ? 3 : 2, fontSize: 11, color: haTextLight },
        splitLine: { show: false },
        axisLine: { lineStyle: { color: haDivider } },
      },
      yAxis: [
        { type: 'value', name: 'kWh', nameTextStyle: { color: haTextLight }, axisLabel: { color: haTextLight }, splitLine: { lineStyle: { type: 'dashed', color: haDivider } } },
        { type: 'value', name: '\u20acc/kWh', nameTextStyle: { color: haTextLight }, axisLabel: { color: haTextLight }, splitLine: { show: false } },
      ],
      series: [
        {
          name: 'Eigenverbruik', type: 'bar', stack: 'production', yAxisIndex: 0,
          itemStyle: { color: colors.selfConsumed },
          barMaxWidth: barWidth,
          data: chartData.map((d) => d.directUse > 0 ? d.directUse : null),
        },
        {
          name: 'Teruggeleverd', type: 'bar', stack: 'production', yAxisIndex: 0,
          itemStyle: { color: colors.exported },
          barMaxWidth: barWidth,
          data: chartData.map((d) => d.returned > 0 ? d.returned : null),
        },
        {
          name: 'Opgeslagen', type: 'bar', stack: 'production', yAxisIndex: 0,
          itemStyle: { color: colors.battery },
          barMaxWidth: barWidth,
          data: chartData.map((d) => d.battery > 0 ? d.battery : null),
        },
        ...(hasBattery ? [
          {
            name: 'Batterij \u2192 huis', type: 'bar', stack: 'production', yAxisIndex: 0,
            itemStyle: { color: '#26C6DA' },
            barMaxWidth: barWidth,
            data: chartData.map((d) => d.battHome > 0 ? d.battHome : null),
          },
          {
            name: 'Batterij \u2192 net', type: 'bar', stack: 'production', yAxisIndex: 0,
            itemStyle: { color: colors.batteryExported || '#00ACC1', borderRadius: [2, 2, 0, 0] },
            barMaxWidth: barWidth,
            data: chartData.map((d) => d.battGrid > 0 ? d.battGrid : null),
          },
        ] : []),
        {
          name: 'Forecast', type: 'line', yAxisIndex: 0,
          lineStyle: { color: colors.solar, width: 2 },
          areaStyle: { color: colors.solar, opacity: 0.3 },
          itemStyle: { color: colors.solar },
          showSymbol: false, connectNulls: true,
          data: chartData.map((d) => d.forecast),
        },
        {
          name: 'Verkoopprijs', type: 'line', step: 'end', yAxisIndex: 1,
          lineStyle: { color: colors.warning, width: 1.5 },
          itemStyle: { color: colors.warning },
          showSymbol: false, connectNulls: true,
          data: chartData.map((d) => d.sellingPrice),
        },
      ],
    };
  }, [chartData, colors, haTextLight, haDivider, resolution, hasBattery]);

  // Use chartData directly as displayData (€ toggle disabled)
  const displayData = chartData;

  // Pie chart: today totals from chart data
  const pieTodayData = useMemo(() => {
    let directUse = 0, returned = 0, battery = 0, battHome = 0, battGrid = 0;
    for (const d of chartData) {
      directUse += d.directUse;
      returned += d.returned;
      battery += d.battery;
      battHome += d.battHome;
      battGrid += d.battGrid;
    }
    const slices = [
      { name: 'Direct verbruik', value: parseFloat(directUse.toFixed(1)), color: colors.selfConsumed },
      { name: 'Teruggeleverd', value: parseFloat(returned.toFixed(1)), color: colors.exported },
      { name: 'Opgeslagen', value: parseFloat(battery.toFixed(1)), color: colors.battery },
      { name: 'Batterij \u2192 huis', value: parseFloat(battHome.toFixed(1)), color: '#26C6DA' },
      { name: 'Batterij \u2192 net', value: parseFloat(battGrid.toFixed(1)), color: colors.batteryExported || '#00ACC1' },
    ].filter((s) => s.value > 0);
    const total = slices.reduce((sum, s) => sum + s.value, 0);
    return { data: slices, total };
  }, [chartData, colors]);

  // Pie chart: year totals
  const pieYearData = useMemo(() => {
    const slices = [
      { key: 'selfConsumed', label: 'Direct verbruik', entity: 'sensor.ec_self_consumed_energy_year', color: colors.selfConsumed },
      { key: 'exported', label: 'Teruggeleverd', entity: 'sensor.ec_exported_energy_year', color: colors.exported },
      { key: 'selfStored', label: 'Opgeslagen', entity: 'sensor.ec_self_stored_energy_year', color: colors.battery },
      { key: 'battHome', label: 'Batterij \u2192 huis', entity: 'sensor.ec_self_consumed_battery_energy_year', color: '#26C6DA' },
      { key: 'battGrid', label: 'Batterij \u2192 net', entity: 'sensor.ec_exported_battery_energy_year', color: colors.batteryExported || '#00ACC1' },
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

  // All unique legend entries from both pies
  const legendEntries = useMemo(() => {
    const seen = new Set();
    const entries = [];
    for (const d of [...pieTodayData.data, ...pieYearData.data]) {
      if (!seen.has(d.name)) {
        seen.add(d.name);
        entries.push({ name: d.name, color: d.color });
      }
    }
    return entries;
  }, [pieTodayData, pieYearData]);

  const statusColors = { green: '#16a34a', orange: '#ea580c', yellow: '#d97706', red: '#dc2626', gray: '#9ca3af' };

  const kpiStyle = (highlight) => ({
    padding: '10px 14px', borderRadius: '8px',
    background: highlight ? '#EEFF41' : 'var(--card-background-color, #fff)',
    border: highlight ? 'none' : '1px solid var(--divider-color, #e5e7eb)',
    minWidth: '100px', flex: '1 1 100px',
  });

  const kpiLabelStyle = (highlight) => ({
    fontSize: '12px',
    color: highlight ? 'rgba(0,0,0,0.6)' : 'var(--secondary-text-color, #6b7280)',
    marginBottom: '2px', fontWeight: 500, fontFamily: fonts.body,
  });

  const kpiValueStyle = (highlight) => ({
    fontSize: '18px', fontWeight: 600, fontFamily: fonts.data,
    color: highlight ? '#212121' : 'var(--primary-text-color, #212121)',
  });

  const toggleBtn = (active, isDisabled) => ({
    padding: '6px 0', width: '80px', fontSize: '12px', fontFamily: fonts.body,
    fontWeight: active ? 600 : 400,
    border: `1px solid ${isDisabled ? '#dc2626' : 'var(--divider-color, #e5e7eb)'}`,
    background: active ? 'var(--primary-text-color, #212121)' : 'var(--card-background-color, #fff)',
    color: active ? 'var(--card-background-color, #fff)' : (isDisabled ? '#dc2626' : 'var(--secondary-text-color, #6b7280)'),
    borderRadius: '4px', cursor: isDisabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.15s', textAlign: 'center',
    opacity: isDisabled ? 0.5 : 1,
  });

  const makePieOption = (data, total, subtitle) => ({
    series: [{
      type: 'pie', radius: ['55%', '80%'],
      data: data.map((d) => ({ value: d.value, name: d.name, itemStyle: { color: d.color } })),
      label: { show: false }, emphasis: { label: { show: false } }, padAngle: 2,
    }],
    tooltip: { formatter: (p) => `${p.name}: ${p.value.toFixed(1)} kWh` },
    graphic: [{
      type: 'text', left: 'center', top: '40%',
      style: { text: `${total.toFixed(0)} kWh`, fontSize: 16, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", fill: haTextColor, textAlign: 'center' },
    }, {
      type: 'text', left: 'center', top: '54%',
      style: { text: subtitle, fontSize: 11, fill: haTextLight, textAlign: 'center' },
    }],
  });

  return (
    <div>
      {/* Section: Productie vandaag */}
      <div style={{ fontSize: '16px', fontWeight: 600, fontFamily: fonts.body, color: 'var(--primary-text-color, #212121)', marginBottom: '12px' }}>Productie vandaag</div>

      {/* Status rapport — bovenaan */}
      <div style={{ padding: '12px 16px', borderRadius: '8px', background: 'var(--card-background-color, rgba(255,255,255,0.05))', border: '1px solid var(--divider-color, #e5e7eb)', marginBottom: '16px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, fontFamily: fonts.body, color: 'var(--primary-text-color, #212121)', marginBottom: '8px' }}>Status rapport</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fonts.body }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--divider-color, #e5e7eb)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: '11px', fontWeight: 600, color: 'var(--secondary-text-color, #6b7280)', textTransform: 'uppercase', letterSpacing: '0.5px', width: '30px' }}>Status</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: '11px', fontWeight: 600, color: 'var(--secondary-text-color, #6b7280)', textTransform: 'uppercase', letterSpacing: '0.5px', width: '130px' }}>Onderdeel</th>
              <th style={{ textAlign: 'left', padding: '6px 0 6px 8px', fontSize: '11px', fontWeight: 600, color: 'var(--secondary-text-color, #6b7280)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Bijzonderheden</th>
            </tr>
          </thead>
          <tbody>
            {statusItems.map((item) => (
              <tr key={item.label} style={{ borderBottom: '1px solid var(--divider-color, #e5e7eb)' }}>
                <td style={{ padding: '10px 8px', verticalAlign: 'top' }}>
                  <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: statusColors[item.status] }} />
                </td>
                <td style={{ padding: '10px 8px', fontSize: '13px', fontWeight: 600, color: 'var(--primary-text-color, #212121)', verticalAlign: 'top' }}>{item.label}</td>
                <td style={{ padding: '10px 0 10px 8px', fontSize: '12px', color: 'var(--secondary-text-color, #6b7280)' }}>{item.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* KPIs + Config */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', flex: 1 }}>
          {[
            { label: 'Productie', value: `${kpis.totalProduced} kWh`, highlight: false },
            { label: 'Forecast', value: `${kpis.forecastTotal} kWh`, highlight: false },
            { label: 'Direct use', value: `${kpis.totalDirectUse} kWh`, highlight: true },
            { label: 'Opbrengst', value: `\u20ac ${kpis.sellRevenue}`, highlight: true },
            { label: 'CO\u2082 vermeden', value: `${kpis.emissionsAvoided} kg`, highlight: true },
          ].map((kpi) => (
            <div key={kpi.label} style={kpiStyle(kpi.highlight)}>
              <div style={kpiLabelStyle(kpi.highlight)}>{kpi.label}</div>
              <div style={kpiValueStyle(kpi.highlight)}>{kpi.value}</div>
            </div>
          ))}
        </div>
        <div ref={configRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowConfig(!showConfig)}
            style={{
              width: '36px', height: '36px', borderRadius: '8px',
              border: '1px solid var(--divider-color, #e5e7eb)',
              background: showConfig ? 'var(--primary-text-color, #212121)' : 'var(--card-background-color, #fff)',
              color: showConfig ? 'var(--card-background-color, #fff)' : 'var(--secondary-text-color, #6b7280)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span style={matIcon}>tune</span>
          </button>
          {showConfig && (
            <div style={{
              position: 'absolute', top: '42px', right: 0, zIndex: 100,
              background: 'var(--card-background-color, #fff)', borderRadius: '8px',
              border: '1px solid var(--divider-color, #e5e7eb)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)', padding: '12px',
              display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '176px',
            }}>
              <div style={{ fontSize: '11px', color: 'var(--secondary-text-color, #6b7280)', fontFamily: fonts.body, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Resolutie</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button style={toggleBtn(resolution === 'uur', false)} onClick={() => { setResolution('uur'); setHistoryData(null); }}>Uur</button>
                <button style={toggleBtn(resolution === 'kwartier', !hasQuarterData)} onClick={() => { if (hasQuarterData) { setResolution('kwartier'); setHistoryData(null); } }}>Kwartier</button>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--secondary-text-color, #6b7280)', fontFamily: fonts.body, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '4px' }}>Weergave</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button style={toggleBtn(true, false)} onClick={() => {}}>Wh</button>
                <button style={{ ...toggleBtn(false, true), opacity: 0.4 }} onClick={() => {}} title="Binnenkort beschikbaar">{'\u20ac'}</button>
              </div>
              {!hasQuarterData && (
                <div style={{ fontSize: '10px', color: '#dc2626', fontFamily: fonts.body }}>Kwartierdata niet beschikbaar</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <ReactECharts option={chartOption} theme="samba" style={{ height: 400 }} notMerge={true} />

      {/* Energieverdeling: vandaag + jaar + legenda */}
      {(pieTodayData.data.length > 0 || pieYearData.data.length > 0) && (
        <div style={{ marginTop: '24px' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, fontFamily: fonts.body, color: 'var(--primary-text-color, #212121)', marginBottom: '12px' }}>Energieverdeling</div>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            {/* Pie vandaag */}
            {pieTodayData.data.length > 0 && (
              <div style={{ flex: '1 1 0', minWidth: '180px' }}>
                <ReactECharts option={makePieOption(pieTodayData.data, pieTodayData.total, 'vandaag')} style={{ height: '200px' }} notMerge={true} />
              </div>
            )}
            {/* Pie jaar */}
            {pieYearData.data.length > 0 && (
              <div style={{ flex: '1 1 0', minWidth: '180px' }}>
                <ReactECharts option={makePieOption(pieYearData.data, pieYearData.total, 'dit jaar')} style={{ height: '200px' }} notMerge={true} />
              </div>
            )}
            {/* Legenda */}
            <div style={{ flex: '1 1 0', minWidth: '160px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px' }}>
              {legendEntries.map((entry) => {
                const todayVal = pieTodayData.data.find((d) => d.name === entry.name)?.value;
                const yearVal = pieYearData.data.find((d) => d.name === entry.name)?.value;
                return (
                  <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: entry.color, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', color: 'var(--primary-text-color, #212121)', fontWeight: 500, fontFamily: fonts.body }}>{entry.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--secondary-text-color, #6b7280)', fontFamily: fonts.data }}>
                        {todayVal != null ? `${todayVal} kWh` : '\u2014'} / {yearVal != null ? `${yearVal} kWh` : '\u2014'}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: '10px', color: 'var(--secondary-text-color, #6b7280)', fontFamily: fonts.body, marginTop: '4px' }}>vandaag / jaar</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
