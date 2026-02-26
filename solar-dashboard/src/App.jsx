import { useState, useMemo } from 'react';
import ProductionTodayChart from './components/ProductionTodayChart';
import HistoricalChart from './components/HistoricalChart';
import ForecastChart from './components/ForecastChart';
import InverterHealthChart from './components/InverterHealthChart';
import DegradationChart from './components/DegradationChart';
import ControlPanel from './components/ControlPanel';

const ENTITIES = {
  solarForecast: 'sensor.sp_solar_forecast',
  solarForecastFallback: 'sensor.gecombineerde_productie_totaal_2',
  inverterSchedule: 'sensor.sp_inverter_schedule',
  producedEnergy15m: 'sensor.ec_produced_energy_15m',
  exportedEnergy15m: 'sensor.ec_exported_energy_15m',
  productionPower: 'sensor.ec_production_power',
  sellingPrice: 'sensor.ep_selling_price',
  purchasePrice: 'sensor.ep_purchase_price',
};

const TABS = [
  { id: 'today', label: 'Vandaag' },
  { id: 'history', label: 'Historisch' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'health', label: 'Gezondheid' },
  { id: 'degradation', label: 'Degradatie' },
  { id: 'control', label: 'Control' },
];

const COLORS = {
  solar: '#FDD835',
  solarLight: '#EEFF41',
  selfConsumed: '#66BB6A',
  battery: '#42A5F5',
  exported: '#FFA726',
  warning: '#EF5350',
  text: '#374151',
  textLight: '#6b7280',
  border: '#e5e7eb',
  bg: '#f9fafb',
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    background: 'transparent',
    color: COLORS.text,
    padding: '24px',
    boxSizing: 'border-box',
  },
  header: {
    marginBottom: '16px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 600,
    margin: '0 0 4px',
    color: '#1a1a1a',
    letterSpacing: '0.5px',
  },
  meta: {
    fontSize: '12px',
    color: COLORS.textLight,
    margin: 0,
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    marginBottom: '16px',
    borderBottom: `2px solid ${COLORS.border}`,
    paddingBottom: '0',
  },
  tab: (active) => ({
    padding: '8px 16px',
    cursor: 'pointer',
    border: 'none',
    background: active ? COLORS.solar : 'transparent',
    color: active ? '#1a1a1a' : COLORS.textLight,
    fontWeight: active ? 600 : 400,
    fontSize: '14px',
    borderRadius: '6px 6px 0 0',
    transition: 'all 0.2s',
  }),
  content: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
  },
};

function getSolarEntity(hass) {
  if (!hass?.states) return null;
  const primary = hass.states[ENTITIES.solarForecast];
  if (primary && primary.state !== 'unavailable') return primary;
  return hass.states[ENTITIES.solarForecastFallback] || null;
}

function App({ hass }) {
  const [activeTab, setActiveTab] = useState('today');

  if (!hass || !hass.states) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>Solar Production</h1>
        </div>
        <div style={{ color: '#9ca3af', textAlign: 'center', marginTop: '40px' }}>
          Waiting for Home Assistant connection...
        </div>
      </div>
    );
  }

  const solarEntity = getSolarEntity(hass);

  const renderTab = () => {
    switch (activeTab) {
      case 'today':
        return <ProductionTodayChart hass={hass} entities={ENTITIES} colors={COLORS} solarEntity={solarEntity} />;
      case 'history':
        return <HistoricalChart hass={hass} entities={ENTITIES} colors={COLORS} />;
      case 'forecast':
        return <ForecastChart hass={hass} entities={ENTITIES} colors={COLORS} solarEntity={solarEntity} />;
      case 'health':
        return <InverterHealthChart hass={hass} entities={ENTITIES} colors={COLORS} solarEntity={solarEntity} />;
      case 'degradation':
        return <DegradationChart hass={hass} entities={ENTITIES} colors={COLORS} />;
      case 'control':
        return <ControlPanel hass={hass} entities={ENTITIES} colors={COLORS} />;
      default:
        return null;
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Solar Production</h1>
        <p style={styles.meta}>
          {solarEntity
            ? `Forecast: ${solarEntity.attributes?.total_today_kwh ?? '—'} kWh vandaag | Piek: ${solarEntity.attributes?.peak_today_w ?? '—'} W`
            : 'Solar forecast sensor niet beschikbaar'}
        </p>
      </div>
      <div style={styles.tabs}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            style={styles.tab(activeTab === tab.id)}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div style={styles.content}>
        {renderTab()}
      </div>
    </div>
  );
}

export default App;
