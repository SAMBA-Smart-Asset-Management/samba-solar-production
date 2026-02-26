"""Solar Production - Solar forecast aggregation and inverter control."""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.frontend import async_register_built_in_panel
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, VERSION
from .coordinator import SolarProductionCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[str] = ["sensor", "select"]

PANEL_URL = "/solar_production/solar-production-panel.js"
PANEL_NAME = "solar-production-panel"
PANEL_TITLE = "Solar Production"
PANEL_ICON = "mdi:solar-power"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Solar Production component."""
    # Register the panel JS file as a static path
    panel_path = Path(__file__).parent / "solar-production-panel.js"
    if panel_path.is_file():
        hass.http.register_static_path(PANEL_URL, str(panel_path), cache_headers=False)
        _LOGGER.debug("Registered static path for solar production panel")

        # Register the sidebar panel
        try:
            await async_register_panel(
                hass,
                frontend_url_path="solar-production",
                webcomponent_name=PANEL_NAME,
                sidebar_title=PANEL_TITLE,
                sidebar_icon=PANEL_ICON,
                module_url=PANEL_URL,
                require_admin=False,
                config={},
            )
            _LOGGER.info("Solar Production sidebar panel registered")
        except Exception:
            _LOGGER.warning(
                "Could not register sidebar panel — "
                "add panel_custom entry to configuration.yaml manually"
            )
    else:
        _LOGGER.warning(
            "solar-production-panel.js not found at %s — "
            "sidebar panel will not be available",
            panel_path,
        )

    return True


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
