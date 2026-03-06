ARG BUILD_FROM=scratch
FROM ${BUILD_FROM}

ARG CACHEBUST=1
RUN echo "Cache bust: ${CACHEBUST}"

COPY custom_components/solar_production /app/solar_production
COPY run.sh /
RUN chmod a+x /run.sh

ARG ADDON_VERSION=dev
RUN echo "${ADDON_VERSION}" > /app/VERSION
LABEL \
    io.hass.name="Solar Production" \
    io.hass.description="Solar production forecasting and control integration" \
    io.hass.type="addon" \
    io.hass.version="${ADDON_VERSION}"

CMD ["/run.sh"]
