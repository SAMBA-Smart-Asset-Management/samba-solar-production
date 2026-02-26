"""Sensor entities for Solar Production integration."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import (
    SensorEntity,
    SensorDeviceClass,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfPower
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, CONF_INVERTERS, SENSOR_PREFIX
from .coordinator import SolarProductionCoordinator, SolarProductionData

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Solar Production sensors."""
    coordinator: SolarProductionCoordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]

    entities: list[SensorEntity] = [
        SPSolarForecastSensor(coordinator),
        SPInverterScheduleSensor(coordinator),
    ]

    # Add per-inverter status sensors
    for inv in entry.data.get(CONF_INVERTERS, []):
        inv_id = inv.get("inverter_id", "")
        inv_name = inv.get("inverter_name", inv_id)
        entities.append(SPInverterStatusSensor(coordinator, inv_id, inv_name))

    async_add_entities(entities)


class SPSolarForecastSensor(CoordinatorEntity[SolarProductionCoordinator], SensorEntity):
    """Main solar forecast sensor - aggregates all day forecasts into one."""

    _attr_has_entity_name = False
    _attr_native_unit_of_measurement = UnitOfPower.WATT
    _attr_device_class = SensorDeviceClass.POWER
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_icon = "mdi:solar-power-variant"

    def __init__(self, coordinator: SolarProductionCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{SENSOR_PREFIX}_solar_forecast"
        self.entity_id = f"sensor.{SENSOR_PREFIX}_solar_forecast"

    @property
    def name(self) -> str:
        """Return the name."""
        return "SP Solar Forecast"

    @property
    def native_value(self) -> float | None:
        """Return current forecast wattage for this timeslot."""
        if self.coordinator.data and self.coordinator.data.forecast:
            return self.coordinator.data.forecast.current_forecast_w
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return forecast data as attributes."""
        if not self.coordinator.data or not self.coordinator.data.forecast:
            return {}

        fc = self.coordinator.data.forecast
        return {
            "watts": fc.watts,
            "total_today_kwh": fc.total_today_kwh,
            "total_tomorrow_kwh": fc.total_tomorrow_kwh,
            "peak_today_w": fc.peak_today_w,
            "peak_today_time": fc.peak_today_time,
            "sunrise_time": fc.sunrise_time,
            "sunset_time": fc.sunset_time,
        }


class SPInverterStatusSensor(CoordinatorEntity[SolarProductionCoordinator], SensorEntity):
    """Status sensor for a single inverter."""

    _attr_has_entity_name = False
    _attr_icon = "mdi:solar-panel"

    def __init__(
        self,
        coordinator: SolarProductionCoordinator,
        inverter_id: str,
        inverter_name: str,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._inverter_id = inverter_id
        self._inverter_name = inverter_name
        self._attr_unique_id = f"{SENSOR_PREFIX}_inverter_{inverter_id}_status"
        self.entity_id = f"sensor.{SENSOR_PREFIX}_inverter_{inverter_id}_status"

    @property
    def name(self) -> str:
        """Return the name."""
        return f"SP Inverter {self._inverter_name}"

    @property
    def native_value(self) -> str | None:
        """Return inverter status (on/off/limited)."""
        if not self.coordinator.data:
            return None
        inv = self.coordinator.data.inverters.get(self._inverter_id)
        if not inv:
            return None
        if not inv.is_on:
            return "off"
        if inv.last_action == "set_power":
            return "limited"
        return "on"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return inverter details."""
        if not self.coordinator.data:
            return {}
        inv = self.coordinator.data.inverters.get(self._inverter_id)
        if not inv:
            return {}
        return {
            "power_w": inv.current_power_w,
            "rated_power_w": inv.rated_power_w,
            "mode": inv.mode,
            "last_action": inv.last_action,
            "last_action_reason": inv.last_action_reason,
        }


class SPInverterScheduleSensor(CoordinatorEntity[SolarProductionCoordinator], SensorEntity):
    """Schedule prediction sensor - when should inverter be on/off/limited."""

    _attr_has_entity_name = False
    _attr_icon = "mdi:calendar-clock"

    def __init__(self, coordinator: SolarProductionCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{SENSOR_PREFIX}_inverter_schedule"
        self.entity_id = f"sensor.{SENSOR_PREFIX}_inverter_schedule"

    @property
    def name(self) -> str:
        """Return the name."""
        return "SP Inverter Schedule"

    @property
    def native_value(self) -> str | None:
        """Return last updated timestamp."""
        if self.coordinator.data and self.coordinator.data.schedule:
            return self.coordinator.data.schedule[0].timestamp
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return the full schedule as attribute."""
        if not self.coordinator.data or not self.coordinator.data.schedule:
            return {"schedule": []}

        return {
            "schedule": [
                {
                    "timestamp": slot.timestamp,
                    "solar_forecast_w": slot.solar_forecast_w,
                    "demand_forecast_w": slot.demand_forecast_w,
                    "export_forecast_w": slot.export_forecast_w,
                    "selling_price": slot.selling_price,
                    "recommended_action": slot.recommended_action,
                    "target_power_w": slot.target_power_w,
                    "reason": slot.reason,
                }
                for slot in self.coordinator.data.schedule
            ],
        }
