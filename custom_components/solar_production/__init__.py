"""Solar Production - Solar forecast aggregation and inverter control."""
from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, VERSION
from .coordinator import SolarProductionCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[str] = ["sensor", "select"]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Solar Production from a config entry."""
    _LOGGER.info("Setting up Solar Production v%s", VERSION)

    coordinator = SolarProductionCoordinator(hass, entry)

    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "coordinator": coordinator,
    }

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Start inverter control loop
    await coordinator.async_start_inverter_control()

    _LOGGER.info(
        "Solar Production setup complete with %d inverter(s)",
        len(entry.data.get("inverters", [])),
    )

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    entry_data = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if entry_data:
        coordinator = entry_data.get("coordinator")
        if coordinator:
            await coordinator.async_stop_inverter_control()

    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        if not hass.data[DOMAIN]:
            hass.data.pop(DOMAIN, None)

    return unload_ok
