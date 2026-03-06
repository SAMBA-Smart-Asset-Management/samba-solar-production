#!/usr/bin/with-contenv bash

echo "[INFO] Starting Solar Production addon..."

VERSION=$(cat /app/VERSION 2>/dev/null || echo "unknown")
echo "[INFO] Version: ${VERSION}"

# Deploy integration files to HA custom_components
echo "[INFO] Deploying solar_production integration..."
mkdir -p /config/custom_components
cp -r /app/solar_production /config/custom_components/solar_production
echo "[INFO] solar_production deployed to /config/custom_components/"

# Restart HA core to pick up the new/updated integration
echo "[INFO] Requesting Home Assistant core restart..."
curl -s -X POST \
    -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" \
    http://supervisor/core/restart
echo "[INFO] Restart requested."

# Stay running so Supervisor considers the addon healthy
echo "[INFO] Addon running. Sleeping..."
sleep infinity
