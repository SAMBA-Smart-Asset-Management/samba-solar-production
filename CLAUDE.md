# SAMBA Smart Asset Management

## Role
You are a world-class software engineer specialized in building Energy Management Systems.
You have deep expertise in battery optimization, solar forecasting, energy pricing, and
Home Assistant integration development. Apply this expertise in every task.

## Mission
SAMBA is a Smart **Asset** Management platform (not just EMS). It manages energy assets
as a complete system: batteries, solar panels, heat pumps, EV chargers, and individual devices.
Platform: Home Assistant (HACS integrations + Supervisor add-ons).

## Token Efficiency
Minimize token usage at all times:
- Do NOT scan or analyze entire repos unnecessarily — read only the files relevant to the task
- Do NOT get stuck in retry loops — if something fails twice, stop and ask the user
- Do NOT re-read files you have already read in this session
- Do NOT generate lengthy explanations unless asked — be concise and direct
- When exploring code, target specific files/functions instead of broad searches
- Prefer editing existing code over rewriting entire files
- Skip redundant validations — trust the context from this CLAUDE.md

## Environments
- **DEV/Test**: https://wz123-1.samba.energy/ | IP 192.168.178.170 | SSH port 22222 | user: homeassistant | pw: Homie4life | Samba Share available
  - Runs in Proxmox VM, files directly editable via Samba Share
- **Staging**: https://or24.smart-homie.nl/ — live test variant, first deploy after dev
- **Production**: Live customer systems via backup-restore on new mini-PCs

## Development & Testing Workflow
1. Claude builds/modifies code locally
2. Claude uploads to HA test environment via Samba Share
3. Claude commits and pushes to git
4. **User tests in HA** — Claude does NOT test in HA unless explicitly asked
5. User reports results, Claude iterates if needed

## Deployment Flow
1. Dev: `source deploy.sh` to test environment
2. Release: `git tag v1.x.y && git push --tags`
3. CI (GitHub Actions): Docker build → GHCR push → metadata to samba-addon-repo (GitHub Pages)
4. HA machines: poll GitHub Pages → pull image from GHCR (private, via registries.yaml token)
5. New sites: HA backup restore on mini-PC + `setup-ha-machine.sh` for GHCR credentials
   (see samba-dev-ops issue #1 for full distribution architecture)

## Version & Release (BELANGRIJK)
HA detecteert updates alleen via **git tags**. Na elke wijziging die naar productie moet:
1. Bump `version` in `manifest.json` (en `const.py` VERSION als het project een dashboard heeft)
2. Commit de version bump
3. `git tag v{versie} && git push origin main --tags`
Zonder tag ziet HA geen update, ook al staat de code op main.


## GitHub
- Org: SAMBA-Smart-Asset-Management
- Auth: `gh auth login` as Leonsturkenboom
- All repos (private + public) accessible via this account

## Modular Architecture
Each block is independent, communicates via HA entities with fixed prefixes:
| Module | Prefix | Type |
|--------|--------|------|
| battery-optimizer | `bo_` | Add-on |
| solar-production | `es_` | HACS integration |
| energy-forecaster | `ef_` | Add-on |
| energy-price | `ep_` | HACS integration |
| energy-core | `ec_` | HACS integration |
| main (orchestration) | `sm_` | HACS integration |

## Development Standards
- Python: Poetry, type hints, PEP 8, pytest, pre-commit, line length 88
- Docstrings on public APIs, f-strings, early returns
- Documentation: lean, bullet points, entities.md per project
- Code language: English | Communication language: Dutch

---

# Solar Production

## Overview
HACS custom integration for solar production forecasting, monitoring, and inverter control.
Aggregates solar forecasts, tracks production vs forecast accuracy, monitors inverter health,
and provides a React-based dashboard panel.

## Key Concepts
- **Forecast Aggregation**: Combines multiple solar forecast sources into a unified prediction
- **Inverter Control**: On/off control logic for solar inverters based on grid/price conditions
- **Solar Dashboard**: React frontend panel embedded in HA (Vite + Recharts)
- **Degradation Tracking**: Monitors solar panel degradation over time
- Entity prefix: `es_`
- Depends on: `energy_core`

## Project Structure
```
custom_components/
  solar_production/
    __init__.py          # Integration setup
    config_flow.py       # UI-based configuration
    const.py             # Constants and defaults
    coordinator.py       # DataUpdateCoordinator
    inverter_control.py  # Inverter on/off logic
    manifest.json        # HACS manifest (domain: solar_production)
    select.py            # Select entities
    sensor.py            # Sensor entities
    translations/        # en.json, nl.json
solar-dashboard/
  src/
    App.jsx              # Main dashboard app
    components/
      ControlPanel.jsx
      DegradationChart.jsx
      ForecastChart.jsx
      HistoricalChart.jsx
      InverterHealthChart.jsx
      ProductionTodayChart.jsx
  dist/
    solar-production-panel.js  # Built output (committed)
  package.json           # React 19, Recharts, Vite 7
  vite.config.js
hacs.json                # HACS metadata
```

## Commands
- **Frontend build**: `cd solar-dashboard && npm run build`
- **Frontend dev**: `cd solar-dashboard && npm run dev`

## HACS Integration Pattern
This repo follows the standard HA custom integration pattern:
- `manifest.json` defines domain, dependencies, version
- `config_flow.py` handles UI setup
- `coordinator.py` manages data updates via `DataUpdateCoordinator`
- `sensor.py` defines sensor entities
- `translations/` for multi-language support (en + nl)

## Frontend
The solar dashboard is a React panel built with Vite. The built JS file is committed to
`custom_components/solar_production/solar-production-panel.js` for HA to serve directly.
After changes to `solar-dashboard/src/`, rebuild and copy the output.

## Learnings
> Add new patterns, bug fixes, or architecture decisions here with date.


## Dashboard Versioning Convention (IMPORTANT)
All SAMBA integrations that ship a frontend panel MUST apply **cache busting**:
1. Store the panel JS file inside the integration directory (ships with HACS).
2. On setup, `__init__.py` copies the JS to `/config/www/` and registers the panel with a `?v={VERSION}` query string.
3. `VERSION` is defined in `const.py` and MUST be bumped on every dashboard change.
4. The Vite build config should include a `copyToIntegration()` plugin that copies the bundle into the integration directory automatically.

### Registration pattern:
```python
import shutil
from pathlib import Path
from homeassistant.components.panel_custom import async_register_panel

src = Path(__file__).parent / "my-panel.js"
www_dir = Path(hass.config.path("www"))
www_dir.mkdir(exist_ok=True)
shutil.copy2(str(src), str(www_dir / "my-panel.js"))

await async_register_panel(
    hass,
    frontend_url_path="my-panel",
    webcomponent_name="my-panel",
    sidebar_title="My Panel",
    sidebar_icon="mdi:view-dashboard",
    js_url=f"/local/my-panel.js?v={VERSION}",
    require_admin=False,
    config={},
)
```
