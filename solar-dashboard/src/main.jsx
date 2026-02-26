import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

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
