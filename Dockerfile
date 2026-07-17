# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# Prefer Railway/runtime env for Vite keys. ARG wiring makes them available in Docker builds.
ARG VITE_PRIVY_APP_ID=
ENV VITE_PRIVY_APP_ID=${VITE_PRIVY_APP_ID}

ARG VITE_STRIPE_PUBLISHABLE_KEY=
ENV VITE_STRIPE_PUBLISHABLE_KEY=${VITE_STRIPE_PUBLISHABLE_KEY}

ARG VITE_RAMP_HOST_API_KEY=
ENV VITE_RAMP_HOST_API_KEY=${VITE_RAMP_HOST_API_KEY}

ARG VITE_CHECKOUT_ORIGIN=
ENV VITE_CHECKOUT_ORIGIN=${VITE_CHECKOUT_ORIGIN}

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
COPY --from=builder /app/dist-publisher/ ./
COPY --from=builder /app/index.html ./index.html
COPY --from=builder /app/generator.html ./generator.html
COPY --from=builder /app/dashboard.html ./dashboard.html
COPY --from=builder /app/account.html ./account.html
COPY --from=builder /app/embed-example.html ./embed-example.html
COPY --from=builder /app/register.html ./register.html
COPY --from=builder /app/agents.html ./agents.html
COPY --from=builder /app/connect-demo.html ./connect-demo.html
COPY --from=builder /app/connect-store.html ./connect-store.html
COPY --from=builder /app/connect-success.html ./connect-success.html
COPY --from=builder /app/site-nav.js ./site-nav.js
COPY --from=builder /app/llms.txt ./llms.txt
COPY --from=builder /app/agents.md ./agents.md
COPY --from=builder /app/skill.md ./skill.md
COPY --from=builder /app/openapi.json ./openapi.json
COPY --from=builder /app/robots.txt ./robots.txt
COPY --from=builder /app/.well-known ./.well-known
COPY --from=builder /app/skills/README.md ./skills/README.md
COPY --from=builder /app/skills/mon-unlock-embed/README.md ./skills/mon-unlock-embed/README.md
COPY --from=builder /app/skills/mon-unlock-embed/OPTIONS.md ./skills/mon-unlock-embed/OPTIONS.md
COPY --from=builder /app/skills/mon-unlock-embed/AGENT.md ./skills/mon-unlock-embed/AGENT.md
COPY server ./server

# Serves static CDN + APIs (Coinbase, Stripe, agent MPP publish).
CMD ["node", "server/index.mjs"]
