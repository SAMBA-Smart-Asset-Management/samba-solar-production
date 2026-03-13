// Shared ECharts configuration helpers for SAMBA Solar Dashboard

export const GRID = { top: 40, right: 50, left: 50, bottom: 30, containLabel: true };
export const GRID_DUAL = { top: 40, right: 60, left: 50, bottom: 30, containLabel: true };

export const formatTime = (ms) => {
  const val = typeof ms === 'number' ? ms : parseInt(ms);
  return new Date(val).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
};

export const formatDate = (ms) => {
  const val = typeof ms === 'number' ? ms : parseInt(ms);
  return new Date(val).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
};

export const formatMonth = (ms) => {
  const val = typeof ms === 'number' ? ms : parseInt(ms);
  return new Date(val).toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' });
};

export const DAY_NAMES = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

export const formatDay = (ms) => {
  const d = new Date(typeof ms === 'number' ? ms : parseInt(ms));
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
};

// Common tooltip formatter for energy charts (dark background)
export function energyTooltipFormatter(params) {
  if (!params || !params.length) return '';
  // Support both time axis ([timestamp, value]) and category axis (name=timestamp, value=scalar)
  const firstP = params[0];
  const timeVal = Array.isArray(firstP.value) ? firstP.value[0] : (firstP.name || firstP.axisValue);
  const time = formatTime(timeVal);
  let html = `<div style="font-family: 'Roboto Mono', monospace; font-size: 12px; font-weight: 500; margin-bottom: 6px; color: rgba(255,255,255,0.7)">${time}</div>`;
  for (const p of params) {
    const val = Array.isArray(p.value) ? p.value[1] : p.value;
    if (val == null) continue;
    let formatted;
    if (p.seriesName === 'Verkoopprijs') {
      formatted = `${val.toFixed(1)} \u20acc/kWh`;
    } else {
      formatted = `${val.toFixed(2)} kWh`;
    }
    html += `<div style="display: flex; align-items: center; gap: 6px; margin: 3px 0; color: #fff">`;
    html += `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: ${p.color}"></span>`;
    html += `<span style="flex: 1; color: rgba(255,255,255,0.8)">${p.seriesName}</span>`;
    html += `<span style="font-weight: 600; color: #fff">${formatted}</span>`;
    html += `</div>`;
  }
  return html;
}

// Common xAxis config for time-based charts
export function timeXAxis(data, formatter = formatTime) {
  return {
    type: 'time',
    axisLabel: { formatter: (val) => formatter(val) },
    splitLine: { show: false },
  };
}

// Common yAxis for kWh
export function kwhYAxis(name = 'kWh') {
  return {
    type: 'value',
    name,
    nameTextStyle: { fontSize: 11, fontFamily: "'JetBrains Mono', monospace" },
  };
}

// Common yAxis for secondary (price, percentage)
export function secondaryYAxis(name = '\u20acc/kWh') {
  return {
    type: 'value',
    name,
    nameTextStyle: { fontSize: 11, fontFamily: "'JetBrains Mono', monospace" },
    splitLine: { show: false },
  };
}
