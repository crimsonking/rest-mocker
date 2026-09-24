# Build stage: full toolchain, produces the standalone server bundle.
FROM node:26-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage: traced production bundle only, non-root, volume-ready /data.
FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    MOCK_DB_FILE=/data/mocks.db
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Sample seed config; mount a custom file over it or point MOCK_CONFIG_FILE elsewhere.
COPY --from=build /app/mocks.json ./mocks.json
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
# Probe the admin API, not mock data: /health is itself a mock and vanishes on
# clear-all, while /_mocks always answers 200 and is excluded from call stats.
# GET, not HEAD/wget --spider: the admin API answers 405 to unsupported methods.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/_mocks" > /dev/null || exit 1
CMD ["node", "server.js"]
