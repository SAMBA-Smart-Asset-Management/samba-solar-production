// SAMBA ECharts Theme - based on samba.energy design system
export const sambaTheme = {
  color: ['#085E34', '#FFA726', '#2563EB', '#EEFF41', '#EF5350', '#6b7280'],
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    color: '#212121',
  },
  title: {
    textStyle: {
      fontFamily: "'Roboto Mono', monospace",
      fontWeight: 600,
      color: '#212121',
    },
  },
  legend: {
    textStyle: {
      fontFamily: "'IBM Plex Sans', sans-serif",
      fontSize: 12,
      color: '#6b7280',
    },
  },
  tooltip: {
    backgroundColor: 'rgba(33, 33, 33, 0.95)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    textStyle: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      color: '#ffffff',
    },
    extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.3); border-radius: 6px;',
  },
  valueAxis: {
    nameTextStyle: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      color: '#6b7280',
    },
    axisLabel: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      color: '#6b7280',
    },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: {
      lineStyle: { type: 'dashed', color: '#e0e0e0' },
    },
  },
  categoryAxis: {
    axisLabel: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      color: '#6b7280',
    },
    axisLine: { lineStyle: { color: '#e5e7eb' } },
    axisTick: { show: false },
  },
  bar: {
    itemStyle: { borderRadius: [2, 2, 0, 0] },
  },
  line: {
    smooth: false,
    symbolSize: 0,
    showSymbol: false,
  },
};
