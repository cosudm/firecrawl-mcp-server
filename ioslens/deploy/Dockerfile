# iOSLENS control plane — container image.
# Hosts the iOSLENS core + MCP server (§02: Azure Container Apps, 2–4 vCPU).
# Multi-stage: install the optional pg driver in a builder, ship a lean runtime.
FROM node:20-alpine AS deps
WORKDIR /app
# `pg` is the only production dependency (PostgreSQL backend). Installed here so
# the offline in-memory mode needs nothing, but production has the driver ready.
RUN npm install --no-save --omit=dev pg@^8.13.0

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Run as non-root.
RUN addgroup -S ioslens && adduser -S ioslens -G ioslens && chown -R ioslens:ioslens /app
USER ioslens

ENV MCP_TRANSPORT=http
ENV MCP_HTTP_HOST=0.0.0.0
ENV MCP_HTTP_PORT=8080
EXPOSE 8080

# Liveness against the MCP health endpoint.
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1

CMD ["node", "bin/ioslens.mjs"]
