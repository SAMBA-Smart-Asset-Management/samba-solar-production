"""Solar Production - Solar forecast aggregation and inverter control."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, VERSION
from .coordinator import SolarProductionCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[str] = ["sensor", "select"]

PANEL_FILENAME = "solar-production-panel.js"
PANEL_NAME = "solar-production-panel"
PANEL_TITLE = "Zon / Solar"
PANEL_ICON = "mdi:solar-power"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Solar Production component."""
    src = Path(__file__).parent / PANEL_FILENAME
    if src.is_file():
        # Copy JS to /config/www/ so it's served at /local/
        www_dir = Path(hass.config.path("www"))
        www_dir.mkdir(exist_ok=True)
        shutil.copy2(str(src), str(www_dir / PANEL_FILENAME))
        _LOGGER.debug("Copied solar production panel to %s", www_dir)

        # Register the sidebar panel with cache-busting version
        try:
            from homeassistant.components.panel_custom import async_register_panel

            await async_register_panel(
                hass,
                frontend_url_path="solar-production",
                webcomponent_name=PANEL_NAME,
                sidebar_title=PANEL_TITLE,
                sidebar_icon=PANEL_ICON,
                js_url=f"/local/{PANEL_FILENAME}?v={VERSION}",
                require_admin=False,
                config={},
            )
            _LOGGER.info(
                "Solar Production sidebar panel registered (v%s)", VERSION
            )
        except Exception:
            _LOGGER.warning(
                "Could not register sidebar panel — "
                "add panel_custom entry to configuration.yaml manually"
            )
    else:
        _LOGGER.warning(
            "solar-production-panel.js not found at %s — "
            "sidebar panel will not be available",
            src,
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
