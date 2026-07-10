# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# Prefer Railway/runtime env VITE_PRIVY_APP_ID. Optional ARG for explicit build-arg wiring.
ARG VITE_PRIVY_APP_ID=
ENV VITE_PRIVY_APP_ID=${VITE_PRIVY_APP_ID}

RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Production deps only (includes @coinbase/cdp-sdk for session tokens).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

# Copy built assets, static pages, and the API server.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-checkout/ ./
COPY --from=builder /app/index.html ./index.html
COPY --from=builder /app/generator.html ./generator.html
COPY --from=builder /app/dashboard.html ./dashboard.html
COPY --from=builder /app/embed-example.html ./embed-example.html
COPY --from=builder /app/register.html ./register.html
COPY server ./server

# Serves static CDN + POST /api/coinbase/session-token (CDP keys from Railway env).
CMD ["node", "server/index.mjs"]
