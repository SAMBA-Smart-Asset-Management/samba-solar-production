import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { GRID_DUAL, formatDay, formatTime } from '../chartHelpers';

export default function ForecastChart({ hass, entities, colors, fonts, solarEntity }) {
  const { chartData, dailyTotals } = useMemo(() => {
    const watts = solarEntity?.attributes?.watts;
    if (!watts || typeof watts !== 'object') return { chartData: [], dailyTotals: [] };

    const data = [];
    const dayMap = {};

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

        let price = null;
        for (const [pMs, pVal] of Object.entries(priceForecast)) {
          if (Math.abs(parseInt(pMs) - ms) < 60 * 60 * 1000) { price = pVal; break; }
        }
        data.push({ timestamp: ms, forecast: val, price });

        const dayKey = new Date(d).setHours(0, 0, 0, 0);
        if (!dayMap[dayKey]) dayMap[dayKey] = { day: dayKey, total: 0 };
        dayMap[dayKey].total += val / 1000 * 0.25;
      } catch {}
    }

    data.sort((a, b) => a.timestamp - b.timestamp);
    const dailyTotals = Object.values(dayMap).sort((a, b) => a.day - b.day).map((d) => ({ ...d, total: d.total.toFixed(1) }));
    return { chartData: data, dailyTotals };
  }, [solarEntity, hass, entities.sellingPrice]);

  const chartOption = useMemo(() => {
    if (!chartData.length) return {};
    return {
      grid: GRID_DUAL,
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          if (!params?.length) return '';
          const ts = params[0].value[0];
          let html = `<div style="font-family: 'Roboto Mono', monospace; font-size: 12px; font-weight: 500; margin-bottom: 6px; color: rgba(255,255,255,0.7)">${formatDay(ts)} ${formatTime(ts)}</div>`;
          for (const p of params) {
            if (p.value[1] == null) continue;
            const formatted = p.seriesName === 'Prijs' ? `${p.value[1].toFixed(1)} \u20acc/kWh` : `${Math.round(p.value[1])} Wh`;
            html += `<div style="display: flex; align-items: center; gap: 6px; margin: 3px 0; color: #fff">`;
            html += `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: ${p.color}"></span>`;
            html += `<span style="flex: 1; color: rgba(255,255,255,0.8)">${p.seriesName}</span><span style="font-weight: 600; color: #fff">${formatted}</span></div>`;
          }
          return html;
        },
      },
      legend: { show: false },
      xAxis: {
        type: 'time',
        axisLabel: { formatter: (val) => formatDay(val) },
        splitLine: { show: false },
      },
      yAxis: [
        { type: 'value', name: 'W', splitLine: { lineStyle: { type: 'dashed', color: '#e0e0e0' } } },
        { type: 'value', name: '\u20acc/kWh', splitLine: { show: false } },
      ],
      series: [
        {
          name: 'Solar Forecast', type: 'line',
          areaStyle: { color: colors.solar, opacity: 0.3 },
          lineStyle: { color: colors.solar, width: 2 },
          itemStyle: { color: colors.solar },
          showSymbol: false, connectNulls: true,
          data: chartData.map((d) => [d.timestamp, d.forecast]),
        },
        {
          name: 'Prijs', type: 'line', step: 'end', yAxisIndex: 1,
          lineStyle: { color: colors.warning, width: 1.5 },
          itemStyle: { color: colors.warning },
          showSymbol: false, connectNulls: true,
          data: chartData.map((d) => [d.timestamp, d.price]),
        },
      ],
    };
  }, [chartData, colors]);

  if (!chartData.length) {
    return <div style={{ color: '#9ca3af', textAlign: 'center', marginTop: '40px' }}>Geen forecast data beschikbaar</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {dailyTotals.map((d) => (
          <div key={d.day} style={{ padding: '6px 12px', borderRadius: '6px', background: '#fff', border: `1px solid ${colors.border}`, fontSize: '12px' }}>
            <span style={{ color: colors.textLight }}>{formatDay(d.day)}: </span>
            <span style={{ fontWeight: 600, fontFamily: fonts.data, color: colors.text }}>{d.total} kWh</span>
          </div>
        ))}
      </div>
      <ReactECharts option={chartOption} theme="samba" style={{ height: 400 }} notMerge={true} />
    </div>
  );
}
