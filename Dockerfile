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

# Install a lightweight static file server
RUN npm install -g http-server

# Copy built assets and static pages
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-checkout/ ./
COPY --from=builder /app/index.html ./index.html
COPY --from=builder /app/generator.html ./generator.html
COPY --from=builder /app/dashboard.html ./dashboard.html
COPY --from=builder /app/embed-example.html ./embed-example.html
COPY --from=builder /app/register.html ./register.html

# Serve static files with CORS. No SPA proxy — the old
# `--proxy .../index.html` caused ENAMETOOLONG 500s for missing /assets/* paths.
CMD ["sh", "-c", "http-server . -p ${PORT:-8080} -d false --cors -c-1"]
