"""Config flow for Solar Production integration."""
from __future__ import annotations

import logging
import re
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    DOMAIN,
    CONF_SOLAR_FORECAST_PREFIX,
    CONF_INVERTERS,
    CONF_INVERTER_NAME,
    CONF_INVERTER_ON_ENTITY,
    CONF_INVERTER_OFF_ENTITY,
    CONF_INVERTER_POWER_ENTITY,
    CONF_INVERTER_POWER_SENSOR,
    CONF_INVERTER_RATED_POWER_W,
    CONF_ENERGY_CORE_ENTRY,
    DEFAULT_SOLAR_FORECAST_PREFIX,
)

_LOGGER = logging.getLogger(__name__)


def _sanitize_name(name: str) -> str:
    """Convert inverter name to snake_case for entity_id."""
    name = name.lower().strip()
    name = re.sub(r"[^a-z0-9]+", "_", name)
    return name.strip("_")


class SolarProductionConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Solar Production."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialize the config flow."""
        self._solar_prefix: str = DEFAULT_SOLAR_FORECAST_PREFIX
        self._inverters: list[dict[str, Any]] = []
        self._energy_core_entry: str | None = None

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry):
        """Get the options flow for this handler."""
        return SolarProductionOptionsFlow(config_entry)

    def _detect_solar_prefix(self) -> str:
        """Auto-detect available solar forecast prefix."""
        candidates = [
            DEFAULT_SOLAR_FORECAST_PREFIX,
            "sensor.forecast_solar",
            "sensor.solcast_pv_forecast",
        ]
        for prefix in candidates:
            entity_id = f"{prefix}_today"
            state = self.hass.states.get(entity_id)
            if state and state.attributes.get("watts"):
                _LOGGER.info("Auto-detected solar prefix: %s", prefix)
                return prefix
        return DEFAULT_SOLAR_FORECAST_PREFIX

    def _get_energy_core_entries(self) -> dict[str, str]:
        """Get available Energy Core entries."""
        entries = self.hass.config_entries.async_entries("energy_core")
        return {entry.entry_id: entry.title for entry in entries}

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Step 1: Solar forecast source configuration."""
        errors: dict[str, str] = {}

        if user_input is not None:
            prefix = user_input.get(CONF_SOLAR_FORECAST_PREFIX, "").strip()
            if not prefix:
                errors[CONF_SOLAR_FORECAST_PREFIX] = "empty_prefix"
            else:
                # Soft validation: check if _today sensor exists
                entity_id = f"{prefix}_today"
                state = self.hass.states.get(entity_id)
                if state is None:
                    _LOGGER.warning(
                        "Sensor %s not found - continuing anyway (may appear later)",
                        entity_id,
                    )
                elif not state.attributes.get("watts"):
                    _LOGGER.warning(
                        "Sensor %s exists but has no 'watts' attribute",
                        entity_id,
                    )

                self._solar_prefix = prefix
                return await self.async_step_inverter()

        detected_prefix = self._detect_solar_prefix()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_SOLAR_FORECAST_PREFIX,
                        default=detected_prefix,
                    ): selector.TextSelector(),
                }
            ),
            errors=errors,
        )

    async def async_step_inverter(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Step 2: Inverter configuration."""
        errors: dict[str, str] = {}

        if user_input is not None:
            name = user_input.get(CONF_INVERTER_NAME, "").strip()
            on_entity = user_input.get(CONF_INVERTER_ON_ENTITY)
            off_entity = user_input.get(CONF_INVERTER_OFF_ENTITY)
            power_entity = user_input.get(CONF_INVERTER_POWER_ENTITY)

            if not name:
                errors[CONF_INVERTER_NAME] = "empty_inverter_name"
            elif not on_entity and not off_entity and not power_entity:
                errors["base"] = "no_control_entity"
            else:
                inverter_data = {
                    CONF_INVERTER_NAME: name,
                    "inverter_id": _sanitize_name(name),
                    CONF_INVERTER_ON_ENTITY: on_entity,
                    CONF_INVERTER_OFF_ENTITY: off_entity,
                    CONF_INVERTER_POWER_ENTITY: power_entity,
                    CONF_INVERTER_POWER_SENSOR: user_input.get(CONF_INVERTER_POWER_SENSOR),
                    CONF_INVERTER_RATED_POWER_W: user_input.get(CONF_INVERTER_RATED_POWER_W),
                }
                self._inverters.append(inverter_data)
                return await self.async_step_add_another()

        inverter_num = len(self._inverters) + 1

        return self.async_show_form(
            step_id="inverter",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_INVERTER_NAME): str,
                    vol.Optional(CONF_INVERTER_ON_ENTITY): selector.EntitySelector(
                        selector.EntitySelectorConfig(
                            domain=["switch", "script", "button", "input_button"],
                        )
                    ),
                    vol.Optional(CONF_INVERTER_OFF_ENTITY): selector.EntitySelector(
                        selector.EntitySelectorConfig(
                            domain=["switch", "script", "button", "input_button"],
                        )
                    ),
                    vol.Optional(CONF_INVERTER_POWER_ENTITY): selector.EntitySelector(
                        selector.EntitySelectorConfig(
                            domain=["number", "input_number"],
                        )
                    ),
                    vol.Optional(CONF_INVERTER_POWER_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(
                            domain=["sensor"],
                        )
                    ),
                    vol.Optional(CONF_INVERTER_RATED_POWER_W): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=0,
                            max=100000,
                            step=100,
                            unit_of_measurement="W",
                            mode=selector.NumberSelectorMode.BOX,
                        )
                    ),
                }
            ),
            errors=errors,
            description_placeholders={"inverter_num": str(inverter_num)},
        )

    async def async_step_add_another(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Step 3: Ask to add another inverter."""
        if user_input is not None:
            if user_input.get("add_another", False):
                return await self.async_step_inverter()
            return await self.async_step_energy_core()

        return self.async_show_form(
            step_id="add_another",
            data_schema=vol.Schema(
                {
                    vol.Required("add_another", default=False): bool,
                }
            ),
            description_placeholders={
                "inverter_count": str(len(self._inverters)),
                "inverters_list": ", ".join(
                    inv[CONF_INVERTER_NAME] for inv in self._inverters
                ),
            },
        )

    async def async_step_energy_core(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Step 4: Energy Core entry selection."""
        errors: dict[str, str] = {}
        ec_entries = self._get_energy_core_entries()

        if not ec_entries:
            return self.async_abort(reason="energy_core_required")

        # Auto-select if only one
        if len(ec_entries) == 1:
            self._energy_core_entry = list(ec_entries.keys())[0]
            return self._create_entry()

        if user_input is not None:
            self._energy_core_entry = user_input.get(CONF_ENERGY_CORE_ENTRY)
            if not self._energy_core_entry:
                errors["base"] = "energy_core_required"
            else:
                return self._create_entry()

        return self.async_show_form(
            step_id="energy_core",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ENERGY_CORE_ENTRY): vol.In(ec_entries),
                }
            ),
            errors=errors,
        )

    def _create_entry(self) -> config_entries.FlowResult:
        """Create the config entry."""
        data = {
            CONF_SOLAR_FORECAST_PREFIX: self._solar_prefix,
            CONF_INVERTERS: self._inverters,
            CONF_ENERGY_CORE_ENTRY: self._energy_core_entry,
        }
        return self.async_create_entry(title="Solar Production", data=data)


class SolarProductionOptionsFlow(config_entries.OptionsFlow):
    """Handle options flow for Solar Production."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self._inverters: list[dict[str, Any]] = list(
            config_entry.data.get(CONF_INVERTERS, [])
        )

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Manage the options."""
        return self.async_show_menu(
            step_id="init",
            menu_options=["edit_prefix", "add_inverter", "remove_inverter"],
        )

    async def async_step_edit_prefix(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Edit the solar forecast prefix."""
        if user_input is not None:
            new_data = dict(self.config_entry.data)
            new_data[CONF_SOLAR_FORECAST_PREFIX] = user_input[CONF_SOLAR_FORECAST_PREFIX]
            self.hass.config_entries.async_update_entry(
                self.config_entry, data=new_data
            )
            return self.async_create_entry(title="", data={})

        current = self.config_entry.data.get(
            CONF_SOLAR_FORECAST_PREFIX, DEFAULT_SOLAR_FORECAST_PREFIX
        )
        return self.async_show_form(
            step_id="edit_prefix",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_SOLAR_FORECAST_PREFIX, default=current): selector.TextSelector(),
                }
            ),
        )

    async def async_step_add_inverter(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Add a new inverter."""
        errors: dict[str, str] = {}

        if user_input is not None:
            name = user_input.get(CONF_INVERTER_NAME, "").strip()
            on_entity = user_input.get(CONF_INVERTER_ON_ENTITY)
            off_entity = user_input.get(CONF_INVERTER_OFF_ENTITY)
            power_entity = user_input.get(CONF_INVERTER_POWER_ENTITY)

            if not name:
                errors[CONF_INVERTER_NAME] = "empty_inverter_name"
            elif not on_entity and not off_entity and not power_entity:
                errors["base"] = "no_control_entity"
            else:
                inverter_data = {
                    CONF_INVERTER_NAME: name,
                    "inverter_id": _sanitize_name(name),
                    CONF_INVERTER_ON_ENTITY: on_entity,
                    CONF_INVERTER_OFF_ENTITY: off_entity,
                    CONF_INVERTER_POWER_ENTITY: power_entity,
                    CONF_INVERTER_POWER_SENSOR: user_input.get(CONF_INVERTER_POWER_SENSOR),
                    CONF_INVERTER_RATED_POWER_W: user_input.get(CONF_INVERTER_RATED_POWER_W),
                }
                self._inverters.append(inverter_data)
                new_data = dict(self.config_entry.data)
                new_data[CONF_INVERTERS] = self._inverters
                self.hass.config_entries.async_update_entry(
                    self.config_entry, data=new_data
                )
                return self.async_create_entry(title="", data={})

        return self.async_show_form(
            step_id="add_inverter",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_INVERTER_NAME): str,
                    vol.Optional(CONF_INVERTER_ON_ENTITY): selector.EntitySelector(
                        selector.EntitySelectorConfig(
                            domain=["switch", "script", "button", "input_button"],
                        )
                    ),
                    vol.Optional(CONF_INVERTER_OFF_ENTITY): selector.EntitySelector(
                        selector.EntitySelectorConfig(
                            domain=["switch", "script", "button", "input_button"],
                        )
                    ),
                    vol.Optional(CONF_INVERTER_POWER_ENTITY): selector.EntitySelector(
                        selector.EntitySelectorConfig(
                            domain=["number", "input_number"],
                        )
                    ),
                    vol.Optional(CONF_INVERTER_POWER_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(
                            domain=["sensor"],
                        )
                    ),
                    vol.Optional(CONF_INVERTER_RATED_POWER_W): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=0, max=100000, step=100,
                            unit_of_measurement="W",
                            mode=selector.NumberSelectorMode.BOX,
                        )
                    ),
                }
            ),
            errors=errors,
        )

    async def async_step_remove_inverter(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Remove an inverter."""
        if not self._inverters:
            return self.async_abort(reason="no_inverters")

        if user_input is not None:
            name = user_input.get("inverter_to_remove")
            self._inverters = [
                inv for inv in self._inverters
                if inv[CONF_INVERTER_NAME] != name
            ]
            new_data = dict(self.config_entry.data)
            new_data[CONF_INVERTERS] = self._inverters
            self.hass.config_entries.async_update_entry(
                self.config_entry, data=new_data
            )
            return self.async_create_entry(title="", data={})

        options = {
            inv[CONF_INVERTER_NAME]: inv[CONF_INVERTER_NAME]
            for inv in self._inverters
        }
        return self.async_show_form(
            step_id="remove_inverter",
            data_schema=vol.Schema(
                {
                    vol.Required("inverter_to_remove"): vol.In(options),
                }
            ),
        )
