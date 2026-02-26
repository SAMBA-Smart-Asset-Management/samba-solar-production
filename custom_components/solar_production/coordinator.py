"""Coordinator for Solar Production integration."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import (
    DOMAIN,
    CONF_SOLAR_FORECAST_PREFIX,
    CONF_INVERTERS,
    CONF_INVERTER_NAME,
    CONF_INVERTER_POWER_SENSOR,
    CONF_INVERTER_RATED_POWER_W,
    FORECAST_DAY_SUFFIXES,
    UPDATE_INTERVAL_SECONDS,
    INVERTER_EVAL_SECONDS,
    SLOT_MINUTES,
    EC_PRODUCTION_POWER,
    EC_NET_POWER,
    SELLING_PRICE_ENTITY,
    PURCHASE_PRICE_ENTITY,
    EF_FORECAST_PARAMS,
    EF_FORECAST_SIMPLE,
    BO_SCHEDULE_FULL,
    MODE_FULL_PRODUCTION,
)
from .inverter_control import evaluate_inverter, execute_action

_LOGGER = logging.getLogger(__name__)


@dataclass
class SolarForecastData:
    """Aggregated solar forecast data."""

    watts: dict[str, float] = field(default_factory=dict)
    total_today_kwh: float = 0.0
    total_tomorrow_kwh: float = 0.0
    peak_today_w: float = 0.0
    peak_today_time: str | None = None
    sunrise_time: str | None = None
    sunset_time: str | None = None
    current_forecast_w: float = 0.0


@dataclass
class InverterStatus:
    """Status of a single inverter."""

    name: str = ""
    inverter_id: str = ""
    mode: str = MODE_FULL_PRODUCTION
    current_power_w: float = 0.0
    rated_power_w: float = 0.0
    is_on: bool = True
    last_action: str = "none"
    last_action_reason: str = ""


@dataclass
class InverterScheduleSlot:
    """One slot in the inverter schedule prediction."""

    timestamp: str = ""
    solar_forecast_w: float = 0.0
    demand_forecast_w: float = 0.0
    export_forecast_w: float = 0.0
    selling_price: float = 0.0
    recommended_action: str = MODE_FULL_PRODUCTION
    target_power_w: float = 0.0
    reason: str = ""


@dataclass
class SolarProductionData:
    """All data managed by the coordinator."""

    forecast: SolarForecastData = field(default_factory=SolarForecastData)
    inverters: dict[str, InverterStatus] = field(default_factory=dict)
    schedule: list[InverterScheduleSlot] = field(default_factory=list)


class SolarProductionCoordinator(DataUpdateCoordinator[SolarProductionData]):
    """Coordinator for Solar Production."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=UPDATE_INTERVAL_SECONDS),
        )
        self.entry = entry
        self._inverter_control_unsub: asyncio.Task | None = None

        # Initialize inverter statuses from config
        for inv in entry.data.get(CONF_INVERTERS, []):
            inv_id = inv.get("inverter_id", "")
            self.data = SolarProductionData()
            self.data.inverters[inv_id] = InverterStatus(
                name=inv.get(CONF_INVERTER_NAME, ""),
                inverter_id=inv_id,
                rated_power_w=inv.get(CONF_INVERTER_RATED_POWER_W, 0) or 0,
            )

    async def _async_update_data(self) -> SolarProductionData:
        """Fetch and aggregate all solar production data."""
        data = self.data if self.data else SolarProductionData()

        # 1. Aggregate solar forecast
        data.forecast = self._aggregate_forecast()

        # 2. Update inverter power readings
        self._update_inverter_power(data)

        # 3. Build inverter schedule prediction
        data.schedule = self._build_schedule(data.forecast)

        return data

    def _aggregate_forecast(self) -> SolarForecastData:
        """Read and combine forecast from all day sensors."""
        prefix = self.entry.data.get(CONF_SOLAR_FORECAST_PREFIX, "")
        combined_watts: dict[str, float] = {}

        for suffix in FORECAST_DAY_SUFFIXES:
            entity_id = f"{prefix}{suffix}"
            state = self.hass.states.get(entity_id)
            if state is None:
                continue

            watts_attr = state.attributes.get("watts")
            if not watts_attr or not isinstance(watts_attr, dict):
                continue

            for ts, value in watts_attr.items():
                try:
                    combined_watts[ts] = float(value)
                except (ValueError, TypeError):
                    continue

        if not combined_watts:
            return SolarForecastData()

        # Calculate statistics
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        tomorrow_start = today_start + timedelta(days=1)
        tomorrow_end = tomorrow_start + timedelta(days=1)

        total_today = 0.0
        total_tomorrow = 0.0
        peak_w = 0.0
        peak_time = None
        sunrise = None
        sunset = None
        current_w = 0.0

        for ts_str, w in sorted(combined_watts.items()):
            try:
                ts = datetime.fromisoformat(ts_str)
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
            except (ValueError, TypeError):
                continue

            kwh = w / 1000.0 * (SLOT_MINUTES / 60.0)

            if today_start <= ts < tomorrow_start:
                total_today += kwh
                if w > peak_w:
                    peak_w = w
                    peak_time = ts_str
                if w > 0:
                    if sunrise is None:
                        sunrise = ts_str
                    sunset = ts_str
            elif tomorrow_start <= ts < tomorrow_end:
                total_tomorrow += kwh

            # Find current slot value
            slot_diff = abs((ts - now).total_seconds())
            if slot_diff < SLOT_MINUTES * 60:
                current_w = w

        return SolarForecastData(
            watts=combined_watts,
            total_today_kwh=round(total_today, 3),
            total_tomorrow_kwh=round(total_tomorrow, 3),
            peak_today_w=round(peak_w, 1),
            peak_today_time=peak_time,
            sunrise_time=sunrise,
            sunset_time=sunset,
            current_forecast_w=round(current_w, 1),
        )

    def _update_inverter_power(self, data: SolarProductionData) -> None:
        """Read current power for each inverter."""
        for inv in self.entry.data.get(CONF_INVERTERS, []):
            inv_id = inv.get("inverter_id", "")
            power_sensor = inv.get(CONF_INVERTER_POWER_SENSOR)

            if inv_id not in data.inverters:
                data.inverters[inv_id] = InverterStatus(
                    name=inv.get(CONF_INVERTER_NAME, ""),
                    inverter_id=inv_id,
                    rated_power_w=inv.get(CONF_INVERTER_RATED_POWER_W, 0) or 0,
                )

            if power_sensor:
                state = self.hass.states.get(power_sensor)
                if state and state.state not in ("unavailable", "unknown"):
                    try:
                        data.inverters[inv_id].current_power_w = float(state.state)
                    except (ValueError, TypeError):
                        pass

    def _build_schedule(self, forecast: SolarForecastData) -> list[InverterScheduleSlot]:
        """Build predicted inverter schedule based on forecasts and prices."""
        schedule: list[InverterScheduleSlot] = []

        if not forecast.watts:
            return schedule

        # Get demand forecast
        demand_forecast = self._get_demand_forecast()

        # Get selling price forecast
        price_forecast = self._get_price_forecast()

        # Get battery schedule (optional)
        battery_schedule = self._get_battery_schedule()

        # Get the first inverter config for type determination
        inverters = self.entry.data.get(CONF_INVERTERS, [])
        inv_config = inverters[0] if inverters else {}
        is_modulatable = bool(inv_config.get("inverter_power_control_entity"))
        rated_power = inv_config.get(CONF_INVERTER_RATED_POWER_W, 0) or 0

        # Get purchase price for cost comparison (binary inverters)
        purchase_price = self._get_current_price(PURCHASE_PRICE_ENTITY)

        for ts_str, solar_w in sorted(forecast.watts.items()):
            demand_w = demand_forecast.get(ts_str, 0.0)
            battery_charge_w = battery_schedule.get(ts_str, 0.0)
            net_consumption_w = demand_w + battery_charge_w
            export_w = max(0.0, solar_w - net_consumption_w)
            selling_price = price_forecast.get(ts_str, 0.0)

            # Determine recommended action
            action, target_w, reason = self._recommend_action(
                solar_w=solar_w,
                demand_w=demand_w,
                export_w=export_w,
                selling_price=selling_price,
                purchase_price=purchase_price,
                is_modulatable=is_modulatable,
                rated_power=rated_power,
            )

            schedule.append(InverterScheduleSlot(
                timestamp=ts_str,
                solar_forecast_w=round(solar_w, 1),
                demand_forecast_w=round(demand_w, 1),
                export_forecast_w=round(export_w, 1),
                selling_price=round(selling_price, 5),
                recommended_action=action,
                target_power_w=round(target_w, 1),
                reason=reason,
            ))

        return schedule

    def _recommend_action(
        self,
        solar_w: float,
        demand_w: float,
        export_w: float,
        selling_price: float,
        purchase_price: float,
        is_modulatable: bool,
        rated_power: float,
    ) -> tuple[str, float, str]:
        """Determine recommended inverter action for a single slot."""
        # Get the active mode from the first inverter
        inverters = self.entry.data.get(CONF_INVERTERS, [])
        inv_id = inverters[0].get("inverter_id", "") if inverters else ""
        mode = MODE_FULL_PRODUCTION
        if self.data and inv_id in self.data.inverters:
            mode = self.data.inverters[inv_id].mode

        from .inverter_control import recommend_slot_action
        return recommend_slot_action(
            mode=mode,
            solar_w=solar_w,
            demand_w=demand_w,
            export_w=export_w,
            selling_price=selling_price,
            purchase_price=purchase_price,
            is_modulatable=is_modulatable,
            rated_power=rated_power,
        )

    def _get_demand_forecast(self) -> dict[str, float]:
        """Get demand forecast from Energy Forecaster."""
        for entity_id in (EF_FORECAST_PARAMS, EF_FORECAST_SIMPLE):
            state = self.hass.states.get(entity_id)
            if state is None:
                continue
            forecast = state.attributes.get("forecast")
            if forecast and isinstance(forecast, dict):
                result = {}
                for ts, val in forecast.items():
                    try:
                        # EF forecast is in kWh per 15 min → convert to W
                        result[ts] = float(val) * 4000.0
                    except (ValueError, TypeError):
                        continue
                return result
        return {}

    def _get_price_forecast(self) -> dict[str, float]:
        """Get selling price forecast from Energy Price."""
        state = self.hass.states.get(SELLING_PRICE_ENTITY)
        if state is None:
            return {}

        result = {}

        # Try selling_prices_today/tomorrow arrays
        for attr_name in ("selling_prices_today", "selling_prices_tomorrow"):
            prices = state.attributes.get(attr_name)
            if prices and isinstance(prices, list):
                for entry in prices:
                    if isinstance(entry, dict) and "from" in entry and "price" in entry:
                        try:
                            result[entry["from"]] = float(entry["price"])
                        except (ValueError, TypeError):
                            continue

        # Try selling_price_forecast dict
        forecast = state.attributes.get("selling_price_forecast")
        if forecast and isinstance(forecast, dict):
            for ts, price in forecast.items():
                try:
                    result[ts] = float(price)
                except (ValueError, TypeError):
                    continue

        return result

    def _get_battery_schedule(self) -> dict[str, float]:
        """Get battery charge schedule from Battery Optimizer (optional)."""
        state = self.hass.states.get(BO_SCHEDULE_FULL)
        if state is None:
            return {}

        full_schedule = state.attributes.get("full_schedule")
        if not full_schedule or not isinstance(full_schedule, list):
            return {}

        result = {}
        for record in full_schedule:
            if isinstance(record, dict):
                ts = record.get("timestamp", "")
                charge_kwh = record.get("charge", 0)
                try:
                    # Convert kWh per 15 min to W
                    result[ts] = float(charge_kwh) * 4000.0
                except (ValueError, TypeError):
                    continue
        return result

    def _get_current_price(self, entity_id: str) -> float:
        """Get current price from a price entity."""
        state = self.hass.states.get(entity_id)
        if state and state.state not in ("unavailable", "unknown"):
            try:
                return float(state.state)
            except (ValueError, TypeError):
                pass
        return 0.0

    # -----------------------------------------------------------------
    # Inverter control loop (runs every 15 seconds)
    # -----------------------------------------------------------------

    async def async_start_inverter_control(self) -> None:
        """Start the inverter control evaluation loop."""
        self._inverter_control_unsub = asyncio.ensure_future(
            self._inverter_control_loop()
        )

    async def async_stop_inverter_control(self) -> None:
        """Stop the inverter control loop."""
        if self._inverter_control_unsub:
            self._inverter_control_unsub.cancel()
            self._inverter_control_unsub = None

    async def _inverter_control_loop(self) -> None:
        """Evaluate and execute inverter control every N seconds."""
        while True:
            try:
                await asyncio.sleep(INVERTER_EVAL_SECONDS)
                await self._evaluate_all_inverters()
            except asyncio.CancelledError:
                break
            except Exception:
                _LOGGER.exception("Error in inverter control loop")

    async def _evaluate_all_inverters(self) -> None:
        """Evaluate control logic for all inverters."""
        if not self.data:
            return

        for inv_config in self.entry.data.get(CONF_INVERTERS, []):
            inv_id = inv_config.get("inverter_id", "")
            inv_status = self.data.inverters.get(inv_id)
            if not inv_status:
                continue

            # Gather current data
            production_w = self._get_current_power(EC_PRODUCTION_POWER)
            net_power_w = self._get_current_power(EC_NET_POWER)
            selling_price = self._get_current_price(SELLING_PRICE_ENTITY)
            purchase_price = self._get_current_price(PURCHASE_PRICE_ENTITY)

            action = evaluate_inverter(
                mode=inv_status.mode,
                inv_config=inv_config,
                production_w=production_w,
                net_power_w=net_power_w,
                selling_price=selling_price,
                purchase_price=purchase_price,
            )

            if action:
                await execute_action(self.hass, inv_config, action)
                inv_status.last_action = action.action
                inv_status.last_action_reason = action.reason
                inv_status.is_on = action.action != "turn_off"
                self.async_set_updated_data(self.data)

    def _get_current_power(self, entity_id: str) -> float:
        """Get current power reading from an entity."""
        state = self.hass.states.get(entity_id)
        if state and state.state not in ("unavailable", "unknown"):
            try:
                return float(state.state)
            except (ValueError, TypeError):
                pass
        return 0.0

    def set_inverter_mode(self, inverter_id: str, mode: str) -> None:
        """Set the control mode for an inverter (called from select entity)."""
        if self.data and inverter_id in self.data.inverters:
            self.data.inverters[inverter_id].mode = mode
            _LOGGER.info(
                "Inverter %s mode set to %s", inverter_id, mode
            )
