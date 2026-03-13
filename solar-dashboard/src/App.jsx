import { useState } from 'react';
import ProductionTodayChart from './components/ProductionTodayChart';
import HistoricalChart from './components/HistoricalChart';
import ForecastChart from './components/ForecastChart';
import HealthTab from './components/HealthTab';
import ControlPanel from './components/ControlPanel';

const ENTITIES = {
  solarForecast: 'sensor.sp_solar_forecast',
  solarForecastFallback: 'sensor.gecombineerde_productie_totaal_2',
  inverterSchedule: 'sensor.sp_inverter_schedule',
  producedEnergy15m: 'sensor.ec_produced_energy_15m',
  exportedEnergy15m: 'sensor.ec_exported_energy_15m',
  selfConsumedEnergy15m: 'sensor.ec_self_consumed_energy_15m',
  selfStoredEnergy15m: 'sensor.ec_self_stored_energy_15m',
  selfConsumedBatteryEnergy15m: 'sensor.ec_self_consumed_battery_energy_15m',
  exportedBatteryEnergy15m: 'sensor.ec_exported_battery_energy_15m',
  productionPower: 'sensor.ec_production_power',
  sellingPrice: 'sensor.ep_selling_price',
  purchasePrice: 'sensor.ep_purchase_price',
  // Hourly energy balance splits (energy_core)
  selfConsumedHour: 'sensor.ec_self_consumed_energy_hour',
  exportedResidualHour: 'sensor.ec_exported_residual_energy_hour',
  selfStoredHour: 'sensor.ec_self_stored_energy_hour',
  emissionsAvoidedHour: 'sensor.ec_emissions_avoided_hour',
  producedEnergyHour: 'sensor.ec_produced_energy_hour',
};

const TABS = [
  { id: 'overview', label: 'Overzicht', icon: 'wb_sunny' },
  { id: 'insight', label: 'Inzicht', icon: 'bar_chart' },
  { id: 'forecast', label: 'Forecast', icon: 'partly_cloudy_day' },
  { id: 'health', label: 'Health', icon: 'monitor_heart' },
  { id: 'control', label: 'Control', icon: 'tune' },
];

const COLORS = {
  solar: '#EEFF41',
  solarLight: '#EEFF41',
  selfConsumed: '#085E34',
  battery: '#2563EB',
  batteryExported: '#7E57C2',
  exported: '#FFA726',
  warning: '#EF5350',
  text: '#212121',
  textLight: '#6b7280',
  border: '#e5e7eb',
  bg: '#FBFBFB',
};

const FONTS = {
  body: "'IBM Plex Sans', sans-serif",
  data: "'JetBrains Mono', monospace",
  ui: "'Roboto Mono', monospace",
};

const iconStyle = {
  fontFamily: 'Material Symbols Outlined',
  fontWeight: 'normal',
  fontStyle: 'normal',
  fontSize: '20px',
  lineHeight: 1,
  letterSpacing: 'normal',
  textTransform: 'none',
  whiteSpace: 'nowrap',
  wordWrap: 'normal',
  direction: 'ltr',
  WebkitFontSmoothing: 'antialiased',
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    fontFamily: FONTS.body,
    background: 'transparent',
    color: COLORS.text,
    padding: '24px',
    boxSizing: 'border-box',
  },
  header: {
    marginBottom: '16px',
  },
  title: {
    fontSize: '28px',
    fontFamily: FONTS.body,
    fontWeight: 700,
    margin: '0 0 4px',
    color: COLORS.text,
  },
  meta: {
    fontSize: '12px',
    fontFamily: FONTS.body,
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
    color: active ? COLORS.text : COLORS.textLight,
    fontWeight: active ? 600 : 400,
    fontSize: '13px',
    fontFamily: FONTS.body,
    borderRadius: '6px 6px 0 0',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
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

function getLastUpdate(hass) {
  if (!hass?.states) return null;
  const entity = hass.states[ENTITIES.producedEnergyHour] || hass.states[ENTITIES.producedEnergy15m];
  if (!entity?.last_updated) return null;
  try {
    const d = new Date(entity.last_updated);
    const date = d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
    const time = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  } catch {
    return null;
  }
}

function App({ hass }) {
  const [activeTab, setActiveTab] = useState('overview');

  if (!hass || !hass.states) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>Zon</h1>
        </div>
        <div style={{ color: '#9ca3af', textAlign: 'center', marginTop: '40px' }}>
          Waiting for Home Assistant connection...
        </div>
      </div>
    );
  }

  const solarEntity = getSolarEntity(hass);
  const lastUpdate = getLastUpdate(hass);

  const renderTab = () => {
    switch (activeTab) {
      case 'overview':
        return <ProductionTodayChart hass={hass} entities={ENTITIES} colors={COLORS} fonts={FONTS} solarEntity={solarEntity} />;
      case 'insight':
        return <HistoricalChart hass={hass} entities={ENTITIES} colors={COLORS} fonts={FONTS} solarEntity={solarEntity} />;
      case 'forecast':
        return <ForecastChart hass={hass} entities={ENTITIES} colors={COLORS} fonts={FONTS} solarEntity={solarEntity} />;
      case 'health':
        return <HealthTab hass={hass} entities={ENTITIES} colors={COLORS} fonts={FONTS} solarEntity={solarEntity} />;
      case 'control':
        return <ControlPanel hass={hass} entities={ENTITIES} colors={COLORS} />;
      default:
        return null;
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Zon</h1>
        <p style={styles.meta}>
          {lastUpdate ? `Laatst bijgewerkt: ${lastUpdate}` : 'Wachten op data...'}
        </p>
      </div>
      <div style={styles.tabs}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            style={styles.tab(activeTab === tab.id)}
            onClick={() => setActiveTab(tab.id)}
          >
            <span style={{ ...iconStyle, fontSize: '18px', color: activeTab === tab.id ? COLORS.text : COLORS.textLight }}>{tab.icon}</span>
            <span>{tab.label}</span>
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
