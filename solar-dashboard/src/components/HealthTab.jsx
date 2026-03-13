import { useState, useEffect, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { GRID_DUAL, formatTime, formatDay, formatMonth } from '../chartHelpers';

const SLOT_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export default function HealthTab({ hass, entities, colors, fonts, solarEntity }) {
  // --- Health section ---
  const [healthHistory, setHealthHistory] = useState(null);
  const [healthRange, setHealthRange] = useState('today');

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
    if (healthRange === 'today') { start.setHours(0, 0, 0, 0); }
    else { start.setTime(now.getTime() - 7 * DAY_MS); start.setHours(0, 0, 0, 0); }

    const powerSensors = inverterEntities.map((inv) => {
      const id = inv.entityId.replace('_status', '');
      return hass.states[inv.entityId]?.attributes?.power_sensor || `${id}_power`;
    }).filter((id) => hass.states[id]);

    if (!powerSensors.length) return;
    const entityIds = [...powerSensors];
    if (entities.productionPower) entityIds.push(entities.productionPower);

    hass.callWS({
      type: 'history/history_during_period', start_time: start.toISOString(), end_time: now.toISOString(),
      entity_ids: entityIds, minimal_response: true, significant_changes_only: false,
    }).then(setHealthHistory).catch(() => {});
  }, [hass, healthRange, inverterEntities, entities.productionPower]);

  const { healthChartData, healthMetrics } = useMemo(() => {
    const watts = solarEntity?.attributes?.watts;
    const forecastMap = {};
    if (watts && typeof watts === 'object') {
      for (const [ts, w] of Object.entries(watts)) { try { forecastMap[new Date(ts).getTime()] = parseFloat(w); } catch {} }
    }
    const slots = {};
    if (healthHistory && entities.productionPower) {
      for (const point of (healthHistory[entities.productionPower] || [])) {
        const d = new Date(point.lu || point.last_updated);
        const slotMs = Math.floor(d.getTime() / SLOT_MS) * SLOT_MS;
        const val = parseFloat(point.s || point.state);
        if (!isNaN(val)) slots[slotMs] = { timestamp: slotMs, actual: val };
      }
    }
    let totalActual = 0, totalForecast = 0, deviationSlots = 0, totalSlots = 0;
    for (const slot of Object.values(slots)) {
      let bestForecast = null, bestDist = Infinity;
      for (const [fMs, fW] of Object.entries(forecastMap)) {
        const dist = Math.abs(parseInt(fMs) - slot.timestamp);
        if (dist < bestDist && dist < SLOT_MS) { bestDist = dist; bestForecast = fW; }
      }
      slot.forecast = bestForecast;
      if (bestForecast != null && bestForecast > 50 && slot.actual != null) {
        slot.ratio = (slot.actual / bestForecast) * 100;
        totalActual += slot.actual; totalForecast += bestForecast; totalSlots++;
        if (Math.abs(slot.ratio - 100) > 15) deviationSlots++;
      }
    }
    return {
      healthChartData: Object.values(slots).sort((a, b) => a.timestamp - b.timestamp),
      healthMetrics: { overallRatio: totalForecast > 0 ? (totalActual / totalForecast) * 100 : null, deviationPct: totalSlots > 0 ? (deviationSlots / totalSlots) * 100 : 0, totalSlots },
    };
  }, [healthHistory, solarEntity, entities.productionPower]);

  const getRatioColor = (ratio) => {
    if (ratio == null) return colors.textLight;
    if (ratio >= 85 && ratio <= 115) return '#16a34a';
    if (ratio >= 70 && ratio <= 130) return colors.exported;
    return colors.warning;
  };

  const healthOption = useMemo(() => {
    if (!healthChartData.length) return {};
    return {
      grid: GRID_DUAL,
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          if (!params?.length) return '';
          const ts = params[0].value[0];
          const fmt = healthRange === 'today' ? formatTime : formatDay;
          let html = `<div style="font-weight: 500; margin-bottom: 4px">${fmt(ts)}</div>`;
          for (const p of params) {
            if (p.value[1] == null) continue;
            const formatted = p.seriesName === 'Ratio' ? `${p.value[1].toFixed(0)}%` : `${Math.round(p.value[1])} W`;
            html += `<div style="display: flex; gap: 6px; margin: 2px 0"><span style="width: 10px; height: 10px; border-radius: 2px; background: ${p.color}; margin-top: 3px"></span><span style="flex:1">${p.seriesName}</span><span style="font-weight: 600">${formatted}</span></div>`;
          }
          return html;
        },
      },
      legend: { show: false },
      xAxis: { type: 'time', axisLabel: { formatter: (val) => (healthRange === 'today' ? formatTime : formatDay)(val) }, splitLine: { show: false } },
      yAxis: [
        { type: 'value', name: 'W', splitLine: { lineStyle: { type: 'dashed', color: '#e0e0e0' } } },
        { type: 'value', name: '%', min: 0, max: 150, splitLine: { show: false } },
      ],
      series: [
        {
          name: 'Actueel', type: 'bar', barWidth: 3, itemStyle: { color: colors.solar, opacity: 0.7 },
          data: healthChartData.map((d) => [d.timestamp, d.actual]),
        },
        {
          name: 'Forecast', type: 'line', lineStyle: { type: 'dashed', color: colors.solarLight, width: 1.5 },
          itemStyle: { color: colors.solarLight }, showSymbol: false, connectNulls: true,
          data: healthChartData.map((d) => [d.timestamp, d.forecast]),
        },
        {
          name: 'Ratio', type: 'line', yAxisIndex: 1, lineStyle: { color: '#16a34a', width: 1.5 },
          itemStyle: { color: '#16a34a' }, showSymbol: false, connectNulls: true,
          data: healthChartData.map((d) => [d.timestamp, d.ratio]),
          markLine: {
            silent: true, symbol: 'none', label: { show: false },
            data: [
              { yAxis: 100, lineStyle: { color: '#9ca3af', type: 'dashed', width: 1 } },
              { yAxis: 85, lineStyle: { color: colors.exported, type: 'dashed', width: 1 } },
              { yAxis: 115, lineStyle: { color: colors.exported, type: 'dashed', width: 1 } },
            ],
          },
        },
      ],
    };
  }, [healthChartData, healthRange, colors]);

  // --- Degradation section ---
  const [degradationHistory, setDegradationHistory] = useState(null);
  const [degradationRate, setDegradationRate] = useState(0.5);

  useEffect(() => {
    if (!hass?.callWS) return;
    const now = new Date();
    const start = new Date(now); start.setFullYear(start.getFullYear() - 2); start.setDate(1); start.setHours(0, 0, 0, 0);
    hass.callWS({
      type: 'history/history_during_period', start_time: start.toISOString(), end_time: now.toISOString(),
      entity_ids: [entities.producedEnergy15m], minimal_response: true, significant_changes_only: false,
    }).then(setDegradationHistory).catch(() => {});
  }, [hass, entities.producedEnergy15m]);

  const degradationData = useMemo(() => {
    if (!degradationHistory) return [];
    const monthMap = {};
    for (const point of (degradationHistory[entities.producedEnergy15m] || [])) {
      const d = new Date(point.lu || point.last_updated);
      const mk = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      if (!monthMap[mk]) monthMap[mk] = { month: mk, total: 0 };
      const val = parseFloat(point.s || point.state);
      if (!isNaN(val)) monthMap[mk].total += val;
    }
    const months = Object.values(monthMap).sort((a, b) => a.month - b.month);
    if (!months.length) return [];
    const baselineKwh = months[0].total;
    return months.map((m) => {
      const yearsFraction = (m.month - months[0].month) / (30 * DAY_MS) / 12;
      const expected = baselineKwh * (1 - (degradationRate / 100) * yearsFraction);
      const ratio = expected > 0 ? (m.total / expected) * 100 : null;
      return { month: m.month, production: parseFloat(m.total.toFixed(1)), expected: parseFloat(expected.toFixed(1)), performanceRatio: ratio != null ? parseFloat(ratio.toFixed(0)) : null };
    });
  }, [degradationHistory, degradationRate, entities.producedEnergy15m]);

  const degradationSummary = useMemo(() => {
    if (degradationData.length < 2) return null;
    const first = degradationData[0], last = degradationData[degradationData.length - 1];
    const monthsSpan = (last.month - first.month) / (30 * DAY_MS);
    const actualChange = last.production > 0 && first.production > 0 ? ((last.production - first.production) / first.production) * 100 : null;
    const valid = degradationData.filter((d) => d.performanceRatio != null);
    const avgRatio = valid.length > 0 ? valid.reduce((s, d) => s + d.performanceRatio, 0) / valid.length : 0;
    return { months: Math.round(monthsSpan), actualChange: actualChange?.toFixed(1), avgPerformance: avgRatio.toFixed(0) };
  }, [degradationData]);

  const degradationOption = useMemo(() => {
    if (!degradationData.length) return {};
    return {
      grid: GRID_DUAL,
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          if (!params?.length) return '';
          let html = `<div style="font-weight: 500; margin-bottom: 4px">${formatMonth(params[0].value[0])}</div>`;
          for (const p of params) {
            if (p.value[1] == null) continue;
            const formatted = p.seriesName === 'Prestatie %' ? `${p.value[1]}%` : `${p.value[1]} kWh`;
            html += `<div style="display: flex; gap: 6px; margin: 2px 0"><span style="width: 10px; height: 10px; border-radius: 2px; background: ${p.color}; margin-top: 3px"></span><span style="flex:1">${p.seriesName}</span><span style="font-weight: 600">${formatted}</span></div>`;
          }
          return html;
        },
      },
      legend: { show: false },
      xAxis: { type: 'time', axisLabel: { formatter: (val) => formatMonth(val) }, splitLine: { show: false } },
      yAxis: [
        { type: 'value', name: 'kWh', splitLine: { lineStyle: { type: 'dashed', color: '#e0e0e0' } } },
        { type: 'value', name: '%', min: 60, max: 140, splitLine: { show: false } },
      ],
      series: [
        { name: 'Productie', type: 'bar', itemStyle: { color: colors.solar, opacity: 0.7 }, data: degradationData.map((d) => [d.month, d.production]) },
        { name: 'Verwacht', type: 'line', lineStyle: { type: 'dashed', color: colors.textLight, width: 1.5 }, itemStyle: { color: colors.textLight }, showSymbol: false, connectNulls: true, data: degradationData.map((d) => [d.month, d.expected]) },
        { name: 'Prestatie %', type: 'line', yAxisIndex: 1, lineStyle: { color: '#16a34a', width: 2 }, itemStyle: { color: '#16a34a' }, showSymbol: true, symbolSize: 6, connectNulls: true, data: degradationData.map((d) => [d.month, d.performanceRatio]) },
      ],
    };
  }, [degradationData, colors]);

  const kpiStyle = { padding: '12px 16px', borderRadius: '8px', background: '#fff', border: `1px solid ${colors.border}`, minWidth: '120px' };

  return (
    <div>
      {/* Health Section */}
      <h2 style={{ fontSize: '16px', fontWeight: 600, fontFamily: fonts.ui, marginBottom: '12px', color: colors.text }}>Inverter Health</h2>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {[{ key: 'today', label: 'Vandaag' }, { key: 'week', label: 'Week' }].map((r) => (
          <button key={r.key} onClick={() => setHealthRange(r.key)}
            style={{ padding: '6px 14px', borderRadius: '6px', border: `1px solid ${colors.border}`, background: healthRange === r.key ? colors.solar : '#fff', color: healthRange === r.key ? colors.text : colors.textLight, fontWeight: healthRange === r.key ? 600 : 400, fontFamily: fonts.ui, cursor: 'pointer', fontSize: '13px' }}>{r.label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={kpiStyle}>
          <div style={{ fontSize: '13px', color: colors.text, marginBottom: '4px', fontWeight: 500 }}>Productie / Forecast</div>
          <div style={{ fontSize: '20px', fontWeight: 600, fontFamily: fonts.data, color: getRatioColor(healthMetrics.overallRatio) }}>
            {healthMetrics.overallRatio != null ? `${healthMetrics.overallRatio.toFixed(0)}%` : '\u2014'}
          </div>
        </div>
        <div style={kpiStyle}>
          <div style={{ fontSize: '13px', color: colors.text, marginBottom: '4px', fontWeight: 500 }}>Afwijkingen (&gt;15%)</div>
          <div style={{ fontSize: '20px', fontWeight: 600, fontFamily: fonts.data, color: healthMetrics.deviationPct > 30 ? colors.warning : '#16a34a' }}>
            {healthMetrics.totalSlots > 0 ? `${healthMetrics.deviationPct.toFixed(0)}%` : '\u2014'}
          </div>
        </div>
        {inverterEntities.map((inv) => {
          const state = hass?.states?.[inv.entityId];
          return (
            <div key={inv.entityId} style={kpiStyle}>
              <div style={{ fontSize: '13px', color: colors.text, marginBottom: '4px', fontWeight: 500 }}>{inv.name}</div>
              <div style={{ fontSize: '20px', fontWeight: 600, fontFamily: fonts.data, color: colors.text }}>
                {state?.attributes?.power_w != null ? `${Math.round(state.attributes.power_w)} W` : state?.state || '\u2014'}
              </div>
              <div style={{ fontSize: '11px', fontFamily: fonts.ui, color: colors.textLight }}>{state?.attributes?.mode || ''} {'\u00b7'} {inv.ratedPower ? `${inv.ratedPower} W nom.` : ''}</div>
            </div>
          );
        })}
      </div>

      {healthChartData.length > 0 && <ReactECharts option={healthOption} theme="samba" style={{ height: 300 }} notMerge={true} />}

      {/* Degradation Section */}
      <div style={{ marginTop: '32px', borderTop: `2px solid ${colors.border}`, paddingTop: '24px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, fontFamily: fonts.ui, marginBottom: '12px', color: colors.text }}>Degradatie</h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <span style={{ fontSize: '13px', color: colors.textLight }}>Verwachte degradatie:</span>
          {[0.3, 0.5, 0.7, 1.0].map((rate) => (
            <button key={rate} onClick={() => setDegradationRate(rate)}
              style={{ padding: '4px 10px', borderRadius: '6px', border: `1px solid ${colors.border}`, background: degradationRate === rate ? colors.solar : '#fff', color: degradationRate === rate ? colors.text : colors.textLight, fontWeight: degradationRate === rate ? 600 : 400, fontFamily: fonts.ui, cursor: 'pointer', fontSize: '12px' }}>{rate}%/jaar</button>
          ))}
        </div>

        {degradationSummary && (
          <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <div style={kpiStyle}>
              <div style={{ fontSize: '13px', color: colors.text, marginBottom: '4px', fontWeight: 500 }}>Periode</div>
              <div style={{ fontSize: '20px', fontWeight: 600, fontFamily: fonts.data, color: colors.text }}>{degradationSummary.months} mnd</div>
            </div>
            <div style={kpiStyle}>
              <div style={{ fontSize: '13px', color: colors.text, marginBottom: '4px', fontWeight: 500 }}>Gem. prestatie</div>
              <div style={{ fontSize: '20px', fontWeight: 600, fontFamily: fonts.data, color: parseInt(degradationSummary.avgPerformance) >= 90 ? '#16a34a' : colors.warning }}>{degradationSummary.avgPerformance}%</div>
            </div>
            {degradationSummary.actualChange != null && (
              <div style={kpiStyle}>
                <div style={{ fontSize: '13px', color: colors.text, marginBottom: '4px', fontWeight: 500 }}>Werkelijke verandering</div>
                <div style={{ fontSize: '20px', fontWeight: 600, fontFamily: fonts.data, color: parseFloat(degradationSummary.actualChange) >= 0 ? '#16a34a' : colors.warning }}>
                  {parseFloat(degradationSummary.actualChange) >= 0 ? '+' : ''}{degradationSummary.actualChange}%
                </div>
              </div>
            )}
          </div>
        )}

        {degradationData.length > 0 ? (
          <ReactECharts option={degradationOption} theme="samba" style={{ height: 300 }} notMerge={true} />
        ) : (
          <div style={{ color: '#9ca3af', textAlign: 'center', marginTop: '20px' }}>Geen historische data beschikbaar (minimaal 2 maanden nodig)</div>
        )}
      </div>
    </div>
  );
}
