"""InfluxDB v1 helper — reads config centrally from samba_main."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

SAMBA_MAIN_DOMAIN = "samba_main"


def get_influxdb_config(hass: HomeAssistant) -> dict[str, Any] | None:
    """Get InfluxDB v1 config from samba_main via hass.data.

    Returns dict with keys: url, username, password, database.
    Returns None if samba_main is not configured or InfluxDB is disabled.
    """
    sm_data = hass.data.get(SAMBA_MAIN_DOMAIN, {})
    for entry_data in sm_data.values():
        if not isinstance(entry_data, dict):
            continue
        config = entry_data.get("config", {})
        options = entry_data.get("options", {})
        merged = {**config, **options}
        if merged.get("influxdb_enabled", False):
            return {
                "url": merged.get("influxdb_url", "http://a0d7b954-influxdb:8086"),
                "username": merged.get("influxdb_username", "samba"),
                "password": merged.get("influxdb_password", ""),
                "database": merged.get("influxdb_database", "Samba"),
            }
    return None
