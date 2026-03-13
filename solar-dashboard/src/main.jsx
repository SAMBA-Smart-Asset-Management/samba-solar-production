import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// ECharts tree-shaking setup
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  DataZoomComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { sambaTheme } from './sambaTheme';

echarts.use([
  BarChart, LineChart,
  GridComponent, TooltipComponent, LegendComponent,
  MarkLineComponent, DataZoomComponent,
  CanvasRenderer,
]);
echarts.registerTheme('samba', sambaTheme);

class SolarProductionPanel extends HTMLElement {
  constructor() {
    super();
    this.root = null;
    this._hass = null;
    this._renderApp = null;
  }

  set hass(hass) {
    this._hass = hass;
    this._renderApp?.(hass);
  }

  connectedCallback() {
    // Load Google Fonts for samba.energy design system
    if (!document.querySelector('link[href*="IBM+Plex+Sans"]')) {
      const link = document.createElement('link');
      link.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Roboto+Mono:wght@400;500&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }

    const container = document.createElement('div');
    container.id = 'root';
    this.appendChild(container);
    this.root = ReactDOM.createRoot(container);
    this._renderApp = (hass) => {
      this.root?.render(<App hass={hass} />);
    };
    if (this._hass) {
      this._renderApp(this._hass);
    } else {
      this.root.render(<App hass={null} />);
    }
  }

  disconnectedCallback() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this._renderApp = null;
  }
}

customElements.define('solar-production-panel', SolarProductionPanel);
