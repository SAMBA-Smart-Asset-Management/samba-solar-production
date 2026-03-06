"""Select entity for inverter control mode."""

from __future__ import annotations

import logging

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import (
    CONF_INVERTERS,
    DOMAIN,
    INVERTER_MODES,
    MODE_FULL_PRODUCTION,
    SELLING_PRICE_ENTITY,
    SENSOR_PREFIX,
)
from .coordinator import SolarProductionCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Solar Production select entities."""
    coordinator: SolarProductionCoordinator = hass.data[DOMAIN][entry.entry_id][
        "coordinator"
    ]

    entities = []
    for inv in entry.data.get(CONF_INVERTERS, []):
        inv_id = inv.get("inverter_id", "")
        inv_name = inv.get("inverter_name", inv_id)
        entities.append(SPInverterModeSelect(coordinator, hass, inv_id, inv_name))

    async_add_entities(entities)


class SPInverterModeSelect(RestoreEntity, SelectEntity):
    """Select entity for choosing inverter control mode."""

    _attr_has_entity_name = False
    _attr_icon = "mdi:tune-variant"

    def __init__(
        self,
        coordinator: SolarProductionCoordinator,
        hass: HomeAssistant,
        inverter_id: str,
        inverter_name: str,
    ) -> None:
        """Initialize the select entity."""
        self._coordinator = coordinator
        self._hass = hass
        self._inverter_id = inverter_id
        self._inverter_name = inverter_name
        self._attr_unique_id = f"{SENSOR_PREFIX}_inverter_mode_{inverter_id}"
        self.entity_id = f"select.{SENSOR_PREFIX}_inverter_mode_{inverter_id}"
        self._attr_current_option = MODE_FULL_PRODUCTION

    @property
    def name(self) -> str:
        """Return the name."""
        return f"SP {self._inverter_name} Mode"

    @property
    def options(self) -> list[str]:
        """Return available modes."""
        # Check if energy_price is available for no_negative_prices
        ep_available = self._hass.states.get(SELLING_PRICE_ENTITY) is not None
        if ep_available:
            return INVERTER_MODES
        # Without energy_price, no_negative_prices is not functional
        return [m for m in INVERTER_MODES if m != "no_negative_prices"]

    async def async_added_to_hass(self) -> None:
        """Restore last known state on startup."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state and last_state.state in INVERTER_MODES:
            self._attr_current_option = last_state.state
            self._coordinator.set_inverter_mode(self._inverter_id, last_state.state)
            _LOGGER.info(
                "Restored inverter %s mode: %s",
                self._inverter_id,
                last_state.state,
            )

    async def async_select_option(self, option: str) -> None:
        """Handle mode selection."""
        if option not in INVERTER_MODES:
            _LOGGER.warning("Invalid mode: %s", option)
            return

        self._attr_current_option = option
        self._coordinator.set_inverter_mode(self._inverter_id, option)
        self.async_write_ha_state()
        _LOGGER.info(
            "Inverter %s mode changed to %s",
            self._inverter_id,
            option,
        )
