"""Constants for the Solar Production integration."""
from __future__ import annotations

DOMAIN = "solar_production"
VERSION = "0.1.0"
ENERGY_CORE_DOMAIN = "energy_core"

# Sensor prefix
SENSOR_PREFIX = "sp"

# ---------------------------------------------------------------------------
# Config keys – Solar forecast
# ---------------------------------------------------------------------------
CONF_SOLAR_FORECAST_PREFIX = "solar_forecast_prefix"
DEFAULT_SOLAR_FORECAST_PREFIX = "sensor.energy_production"

# Forecast sensor day suffixes (matching battery optimizer pattern)
FORECAST_DAY_SUFFIXES = [
    "_today",
    "_tomorrow",
    "_d2",
    "_d3",
    "_d4",
    "_d5",
    "_d6",
    "_d7",
]

# ---------------------------------------------------------------------------
# Config keys – Inverter
# ---------------------------------------------------------------------------
CONF_INVERTERS = "inverters"
CONF_INVERTER_NAME = "inverter_name"
CONF_INVERTER_ON_ENTITY = "inverter_on_entity"
CONF_INVERTER_OFF_ENTITY = "inverter_off_entity"
CONF_INVERTER_POWER_ENTITY = "inverter_power_control_entity"
CONF_INVERTER_POWER_SENSOR = "inverter_power_sensor"
CONF_INVERTER_RATED_POWER_W = "inverter_rated_power_w"

# ---------------------------------------------------------------------------
# Config keys – Energy Core
# ---------------------------------------------------------------------------
CONF_ENERGY_CORE_ENTRY = "energy_core_entry"

# ---------------------------------------------------------------------------
# Inverter control modes
# ---------------------------------------------------------------------------
MODE_FULL_PRODUCTION = "full_production"
MODE_SELF_CONSUMPTION = "self_consumption"
MODE_NO_NEGATIVE_PRICES = "no_negative_prices"

INVERTER_MODES = [
    MODE_FULL_PRODUCTION,
    MODE_SELF_CONSUMPTION,
    MODE_NO_NEGATIVE_PRICES,
]

# ---------------------------------------------------------------------------
# External sensor entities
# ---------------------------------------------------------------------------
SELLING_PRICE_ENTITY = "sensor.ep_selling_price"
PURCHASE_PRICE_ENTITY = "sensor.ep_purchase_price"

# Energy Core sensors
EC_PRODUCTION_POWER = "sensor.ec_production_power"
EC_NET_POWER = "sensor.ec_net_power"

# Energy Forecaster sensors (for schedule prediction)
EF_FORECAST_PARAMS = "sensor.ef_forecast_parametersincluded"
EF_FORECAST_SIMPLE = "sensor.ef_forecast_simple"

# Battery Optimizer sensor (optional)
BO_SCHEDULE_FULL = "sensor.bo_battery_schedule_full"

# ---------------------------------------------------------------------------
# Update intervals
# ---------------------------------------------------------------------------
UPDATE_INTERVAL_SECONDS = 60
INVERTER_EVAL_SECONDS = 15

# ---------------------------------------------------------------------------
# Slot duration
# ---------------------------------------------------------------------------
SLOT_MINUTES = 15
