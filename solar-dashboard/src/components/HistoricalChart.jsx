import { useState, useEffect, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { GRID, formatTime, formatDate, formatMonth } from '../chartHelpers';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const RANGES = [
  { key: 'day', label: 'Dag' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Maand' },
  { key: 'year', label: 'Jaar' },
];

function toHourKey(date) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function toDayKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function lastPerSlot(points, keyFn) {
  const bySlot = {};
  for (const point of points) {
    const ts = point.lu || point.last_updated;
    if (!ts) continue;
    const key = keyFn(ts);
    const val = parseFloat(point.s ?? point.state);
    if (!isNaN(val) && val >= 0) bySlot[key] = val;
  }
  return bySlot;
}

function getNavigationLabel(range, offset) {
  const now = new Date();
  if (range === 'day') {
    if (offset === 0) return 'Vandaag';
    if (offset === 1) return 'Gisteren';
    const d = new Date(now.getTime() - offset * DAY_MS);
    return d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  if (range === 'week') {
    if (offset === 0) return 'Deze week';
    if (offset === 1) return 'Vorige week';
    const start = new Date(now.getTime() - (offset * 7 + now.getDay()) * DAY_MS);
    return `Week van ${start.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}`;
  }
  if (range === 'month') {
    if (offset === 0) return 'Deze maand';
    if (offset === 1) return 'Vorige maand';
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    return d.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
  }
  if (offset === 0) return 'Dit jaar';
  return new Date(now.getFullYear() - offset, 0, 1).getFullYear().toString();
}

function getDateRange(range, offset) {
  const now = new Date();
  let start, end;
  if (range === 'day') {
    start = new Date(now); start.setDate(start.getDate() - offset); start.setHours(0, 0, 0, 0);
    end = new Date(start); end.setDate(end.getDate() + 1);
  } else if (range === 'week') {
    end = new Date(now); end.setDate(end.getDate() - offset * 7); end.setHours(23, 59, 59, 999);
    start = new Date(end); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
    if (offset === 0) end = now;
  } else if (range === 'month') {
    start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 0, 23, 59, 59, 999);
    if (offset === 0) end = now;
  } else {
    start = new Date(now.getFullYear() - offset, 0, 1);
    end = new Date(now.getFullYear() - offset, 11, 31, 23, 59, 59, 999);
    if (offset === 0) end = now;
  }
  return { start, end };
}

export default function HistoricalChart({ hass, entities, colors, fonts, solarEntity }) {
  const [range, setRange] = useState('day');
  const [offset, setOffset] = useState(0);
  const [historyData, setHistoryData] = useState(null);

  const { start, end } = useMemo(() => getDateRange(range, offset), [range, offset]);

  useEffect(() => {
    if (!hass?.callWS) return;
    hass.callWS({
      type: 'history/history_during_period',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      entity_ids: [entities.selfConsumedHour, entities.exportedResidualHour, entities.selfStoredHour, entities.producedEnergyHour].filter(Boolean),
      minimal_response: true,
      significant_changes_only: false,
    }).then(setHistoryData).catch(() => {});
  }, [hass, start, end, entities]);

  const chartData = useMemo(() => {
    if (!historyData) return [];
    if (range === 'day') {
      const slots = [];
      for (let t = start.getTime(); t < end.getTime(); t += HOUR_MS) {
        slots.push({ timestamp: t, directUse: 0, returned: 0, battery: 0, forecast: null });
      }
      const slotIndex = {};
      slots.forEach((s, i) => { slotIndex[s.timestamp] = i; });

      const fill = (entityId, field) => {
        if (!entityId) return;
        const bySlot = lastPerSlot(historyData[entityId] || [], toHourKey);
        for (const [key, val] of Object.entries(bySlot)) {
          const idx = slotIndex[parseInt(key)];
          if (idx != null) slots[idx][field] = val;
        }
      };
      fill(entities.selfConsumedHour, 'directUse');
      fill(entities.exportedResidualHour, 'returned');
      fill(entities.selfStoredHour, 'battery');

      const watts = solarEntity?.attributes?.watts;
      if (watts && typeof watts === 'object') {
        const forecastSlots = {};
        for (const [ts, w] of Object.entries(watts)) {
          try {
            const d = new Date(ts);
            if (d >= start && d < end) {
              const key = toHourKey(ts);
              if (!forecastSlots[key]) forecastSlots[key] = { sum: 0, count: 0 };
              forecastSlots[key].sum += parseFloat(w);
              forecastSlots[key].count++;
            }
          } catch {}
        }
        for (const [key, { sum, count }] of Object.entries(forecastSlots)) {
          const idx = slotIndex[parseInt(key)];
          if (idx != null) slots[idx].forecast = (sum / count) / 1000;
        }
      }
      return slots;
    }

    const dayMap = {};
    const fillDaily = (entityId, field) => {
      if (!entityId) return;
      const bySlot = lastPerSlot(historyData[entityId] || [], toHourKey);
      for (const [hourKey, val] of Object.entries(bySlot)) {
        const dayKey = toDayKey(parseInt(hourKey));
        if (!dayMap[dayKey]) dayMap[dayKey] = { timestamp: dayKey, directUse: 0, returned: 0, battery: 0 };
        dayMap[dayKey][field] += val;
      }
    };
    fillDaily(entities.selfConsumedHour, 'directUse');
    fillDaily(entities.exportedResidualHour, 'returned');
    fillDaily(entities.selfStoredHour, 'battery');

    let data = Object.values(dayMap).sort((a, b) => a.timestamp - b.timestamp);

    if (range === 'year') {
      const monthMap = {};
      for (const day of data) {
        const d = new Date(day.timestamp);
        const mk = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
        if (!monthMap[mk]) monthMap[mk] = { timestamp: mk, directUse: 0, returned: 0, battery: 0 };
        monthMap[mk].directUse += day.directUse;
        monthMap[mk].returned += day.returned;
        monthMap[mk].battery += day.battery;
      }
      data = Object.values(monthMap).sort((a, b) => a.timestamp - b.timestamp);
    }
    return data;
  }, [historyData, range, start, end, entities, solarEntity]);

  const tickFormatter = range === 'day' ? formatTime : range === 'year' ? formatMonth : formatDate;

  const chartOption = useMemo(() => {
    if (!chartData.length) return {};
    const labels = chartData.map((d) => tickFormatter(d.timestamp));
    const hasForecast = range === 'day';

    return {
      grid: GRID,
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          if (!params?.length) return '';
          const idx = params[0].dataIndex;
          const slot = chartData[idx];
          const time = tickFormatter(slot?.timestamp || 0);
          let html = `<div style="font-family: 'Roboto Mono', monospace; font-size: 12px; font-weight: 500; margin-bottom: 6px; color: rgba(255,255,255,0.7)">${time}</div>`;
          for (const p of params) {
            const val = p.value;
            if (val == null || val === 0) continue;
            const formatted = `${val.toFixed(2)} kWh`;
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
        axisLabel: { interval: range === 'day' ? 2 : 0, rotate: range === 'month' ? 45 : 0, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: { type: 'value', name: 'kWh', splitLine: { lineStyle: { type: 'dashed', color: '#e0e0e0' } } },
      series: [
        {
          name: 'Direct use', type: 'bar', stack: 'production',
          itemStyle: { color: colors.selfConsumed },
          barMaxWidth: range === 'day' ? 20 : 40,
          data: chartData.map((d) => d.directUse || null),
        },
        {
          name: 'Teruggeleverd', type: 'bar', stack: 'production',
          itemStyle: { color: colors.exported },
          barMaxWidth: range === 'day' ? 20 : 40,
          data: chartData.map((d) => d.returned || null),
        },
        {
          name: 'Batterij', type: 'bar', stack: 'production',
          itemStyle: { color: colors.battery, borderRadius: [2, 2, 0, 0] },
          barMaxWidth: range === 'day' ? 20 : 40,
          data: chartData.map((d) => d.battery || null),
        },
        ...(hasForecast ? [{
          name: 'Forecast', type: 'line',
          lineStyle: { type: 'dashed', color: colors.solar, width: 1.5 },
          areaStyle: { color: colors.solar, opacity: 0.12 },
          itemStyle: { color: colors.solar },
          showSymbol: false, connectNulls: true,
          data: chartData.map((d) => d.forecast),
        }] : []),
      ],
    };
  }, [chartData, range, colors, tickFormatter]);

  const navLabel = getNavigationLabel(range, offset);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => { setRange(r.key); setOffset(0); }}
              style={{
                padding: '6px 14px', borderRadius: '6px', border: `1px solid ${colors.border}`,
                background: range === r.key ? colors.solar : '#fff',
                color: range === r.key ? colors.text : colors.textLight,
                fontWeight: range === r.key ? 600 : 400,
                fontFamily: fonts.body, cursor: 'pointer', fontSize: '13px',
              }}>{r.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={() => setOffset((o) => o + 1)}
            style={{ padding: '4px 10px', border: `1px solid ${colors.border}`, borderRadius: '6px', background: '#fff', cursor: 'pointer', fontSize: '16px', color: colors.text }}>{'\u2190'}</button>
          <span style={{ fontSize: '13px', fontFamily: fonts.body, fontWeight: 500, color: colors.text, minWidth: '120px', textAlign: 'center' }}>{navLabel}</span>
          <button onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0}
            style={{ padding: '4px 10px', border: `1px solid ${colors.border}`, borderRadius: '6px', background: '#fff', cursor: offset === 0 ? 'not-allowed' : 'pointer', fontSize: '16px', color: offset === 0 ? colors.border : colors.text, opacity: offset === 0 ? 0.5 : 1 }}>{'\u2192'}</button>
        </div>
      </div>

      {!chartData.length ? (
        <div style={{ color: '#9ca3af', textAlign: 'center', marginTop: '40px' }}>Geen historische data beschikbaar</div>
      ) : (
        <ReactECharts option={chartOption} theme="samba" style={{ height: 400 }} notMerge={true} />
      )}
    </div>
  );
}
