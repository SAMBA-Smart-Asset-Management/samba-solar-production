"""Inverter control logic for Solar Production."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant

from .const import (
    CONF_INVERTER_ON_ENTITY,
    CONF_INVERTER_OFF_ENTITY,
    CONF_INVERTER_POWER_ENTITY,
    CONF_INVERTER_RATED_POWER_W,
    CONF_GLOBAL_ON_ENTITY,
    CONF_GLOBAL_OFF_ENTITY,
    MODE_FULL_PRODUCTION,
    MODE_SELF_CONSUMPTION,
    MODE_NO_NEGATIVE_PRICES,
    SLOT_MINUTES,
)

_LOGGER = logging.getLogger(__name__)


@dataclass
class InverterAction:
    """Result of inverter control evaluation."""

    action: str  # "turn_on", "turn_off", "set_power"
    target_power_w: float = 0.0
    reason: str = ""


def evaluate_inverter(
    mode: str,
    inv_config: dict[str, Any],
    production_w: float,
    net_power_w: float,
    selling_price: float,
    purchase_price: float,
) -> InverterAction | None:
    """Evaluate what action to take for an inverter.

    Returns InverterAction or None if no action needed.
    """
    is_modulatable = bool(inv_config.get(CONF_INVERTER_POWER_ENTITY))
    rated_power = inv_config.get(CONF_INVERTER_RATED_POWER_W, 0) or 0

    if mode == MODE_FULL_PRODUCTION:
        return _eval_full_production(is_modulatable, rated_power)

    if mode == MODE_SELF_CONSUMPTION:
        return _eval_self_consumption(
            is_modulatable, rated_power,
            production_w, net_power_w,
            selling_price, purchase_price,
        )

    if mode == MODE_NO_NEGATIVE_PRICES:
        return _eval_no_negative_prices(
            is_modulatable, rated_power,
            production_w, net_power_w,
            selling_price, purchase_price,
        )

    return None


def _eval_full_production(
    is_modulatable: bool,
    rated_power: float,
) -> InverterAction:
    """Full production: no limitations."""
    if is_modulatable:
        return InverterAction(
            action="set_power",
            target_power_w=rated_power,
            reason="Full production: max power",
        )
    return InverterAction(
        action="turn_on",
        reason="Full production: on",
    )


def _eval_self_consumption(
    is_modulatable: bool,
    rated_power: float,
    production_w: float,
    net_power_w: float,
    selling_price: float,
    purchase_price: float,
) -> InverterAction:
    """Self consumption: no feed-in to grid."""
    # Current demand = what the site is consuming
    # net_power_w > 0 means importing, < 0 means exporting
    # production_w is the current solar output
    demand_w = net_power_w + production_w  # total site demand

    if is_modulatable:
        # Limit to current demand so export ≈ 0
        target = max(0.0, min(demand_w, rated_power))
        return InverterAction(
            action="set_power",
            target_power_w=target,
            reason=f"Self consumption: limit to {target:.0f}W demand",
        )

    # Binary inverter: cost comparison
    return _binary_cost_comparison(
        production_w=production_w,
        demand_w=demand_w,
        selling_price=selling_price,
        purchase_price=purchase_price,
    )


def _eval_no_negative_prices(
    is_modulatable: bool,
    rated_power: float,
    production_w: float,
    net_power_w: float,
    selling_price: float,
    purchase_price: float,
) -> InverterAction:
    """No negative prices: full production when selling price >= 0,
    self-consumption mode when price < 0."""
    if selling_price >= 0:
        return _eval_full_production(is_modulatable, rated_power)

    # Negative selling price → switch to self-consumption logic
    return _eval_self_consumption(
        is_modulatable, rated_power,
        production_w, net_power_w,
        selling_price, purchase_price,
    )


def _binary_cost_comparison(
    production_w: float,
    demand_w: float,
    selling_price: float,
    purchase_price: float,
) -> InverterAction:
    """Cost comparison for binary (on/off) inverters.

    Compares the financial benefit of keeping the inverter on vs off:
    - ON: self-consumption saves (purchase_price per kWh), but export at
      negative selling price costs money
    - OFF: all demand met from grid at purchase_price
    """
    self_consumption_w = min(production_w, max(demand_w, 0))
    export_w = max(0.0, production_w - max(demand_w, 0))

    hours = SLOT_MINUTES / 60.0

    # Savings from self-consumption (avoiding grid purchase)
    savings_eur = (self_consumption_w / 1000.0) * hours * purchase_price

    # Cost/revenue from export
    # selling_price > 0 → revenue, selling_price < 0 → cost
    export_value_eur = (export_w / 1000.0) * hours * selling_price

    # Net benefit of having inverter ON
    net_benefit = savings_eur + export_value_eur

    if net_benefit > 0:
        return InverterAction(
            action="turn_on",
            reason=(
                f"On: self-consumption {self_consumption_w:.0f}W "
                f"saves €{savings_eur:.3f}/h, "
                f"export {export_w:.0f}W "
                f"{'earns' if export_value_eur >= 0 else 'costs'} "
                f"€{abs(export_value_eur):.3f}/h"
            ),
        )

    return InverterAction(
        action="turn_off",
        reason=(
            f"Off: self-consumption {self_consumption_w:.0f}W "
            f"saves €{savings_eur:.3f}/h, "
            f"but export {export_w:.0f}W "
            f"costs €{abs(export_value_eur):.3f}/h → net loss"
        ),
    )


def recommend_slot_action(
    mode: str,
    solar_w: float,
    demand_w: float,
    export_w: float,
    selling_price: float,
    purchase_price: float,
    is_modulatable: bool,
    rated_power: float,
) -> tuple[str, float, str]:
    """Recommend action for a future schedule slot.

    Returns (action_name, target_power_w, reason).
    Used by the schedule builder in the coordinator.
    """
    if mode == MODE_FULL_PRODUCTION:
        target = rated_power if is_modulatable else solar_w
        return MODE_FULL_PRODUCTION, target, "Full production"

    # For self_consumption and no_negative_prices with negative price
    needs_self_consumption = (
        mode == MODE_SELF_CONSUMPTION
        or (mode == MODE_NO_NEGATIVE_PRICES and selling_price < 0)
    )

    if needs_self_consumption:
        if is_modulatable:
            target = min(demand_w, rated_power) if demand_w > 0 else 0
            return (
                MODE_SELF_CONSUMPTION,
                target,
                f"Self consumption: limit to {target:.0f}W",
            )

        # Binary: cost comparison
        self_consumption_w = min(solar_w, max(demand_w, 0))
        export_forecast_w = max(0.0, solar_w - max(demand_w, 0))
        hours = SLOT_MINUTES / 60.0

        savings = (self_consumption_w / 1000.0) * hours * purchase_price
        export_val = (export_forecast_w / 1000.0) * hours * selling_price
        net = savings + export_val

        if net > 0:
            return (
                MODE_FULL_PRODUCTION,
                solar_w,
                f"On: net benefit €{net:.3f}/slot",
            )
        return (
            "off",
            0,
            f"Off: net loss €{abs(net):.3f}/slot",
        )

    # no_negative_prices with positive price → full production
    target = rated_power if is_modulatable else solar_w
    return MODE_FULL_PRODUCTION, target, f"Positive price ({selling_price:.4f})"


async def execute_action(
    hass: HomeAssistant,
    inv_config: dict[str, Any],
    action: InverterAction,
    global_config: dict[str, Any] | None = None,
) -> None:
    """Execute an inverter control action.

    Falls back to global on/off entities when the inverter has no
    dedicated on/off entity configured.
    """
    global_config = global_config or {}

    if action.action == "turn_on":
        entity_id = inv_config.get(CONF_INVERTER_ON_ENTITY) or global_config.get(CONF_GLOBAL_ON_ENTITY)
        if entity_id:
            await _call_entity_action(hass, entity_id)
            _LOGGER.info("Inverter ON via %s: %s", entity_id, action.reason)
        else:
            _LOGGER.warning("Inverter ON requested but no on entity configured (individual or global)")

    elif action.action == "turn_off":
        entity_id = inv_config.get(CONF_INVERTER_OFF_ENTITY) or global_config.get(CONF_GLOBAL_OFF_ENTITY)
        if entity_id:
            await _call_entity_action(hass, entity_id)
            _LOGGER.info("Inverter OFF via %s: %s", entity_id, action.reason)
        else:
            _LOGGER.warning("Inverter OFF requested but no off entity configured (individual or global)")

    elif action.action == "set_power":
        entity_id = inv_config.get(CONF_INVERTER_POWER_ENTITY)
        if entity_id:
            domain = entity_id.split(".")[0]
            await hass.services.async_call(
                domain,
                "set_value",
                {"entity_id": entity_id, "value": action.target_power_w},
            )
            _LOGGER.info(
                "Inverter power set to %.0fW: %s",
                action.target_power_w, action.reason,
            )
        else:
            _LOGGER.warning("Inverter set_power requested but no power control entity configured")


async def _call_entity_action(hass: HomeAssistant, entity_id: str) -> None:
    """Call turn_on for a switch/script/button entity."""
    domain = entity_id.split(".")[0]
    if domain == "button":
        service = "press"
    else:
        service = "turn_on"
    await hass.services.async_call(
        domain, service, {"entity_id": entity_id}
    )
