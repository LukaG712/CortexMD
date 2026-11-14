# Stage 1: Install dependencies and build Next.js standalone app
FROM node:24-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage 2: Minimal production runtime
FROM node:24-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV CORTEX_DATA_DIR=/data

RUN groupadd --system --gid 1001 cortex && \
    useradd --system --uid 1001 --gid cortex cortex && \
    mkdir -p /data/vaults /data/backups && \
    chown -R cortex:cortex /data

COPY --from=builder --chown=cortex:cortex /app/.next/standalone ./
COPY --from=builder --chown=cortex:cortex /app/.next/static ./.next/static
COPY --from=builder --chown=cortex:cortex /app/public ./public

USER cortex
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
