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

ARG WALLETCONNECT_PROJECT_ID=c2a289e11ad2998f8ea4633db536334c
ENV WALLETCONNECT_PROJECT_ID=${WALLETCONNECT_PROJECT_ID}
ENV VITE_WALLETCONNECT_PROJECT_ID=${WALLETCONNECT_PROJECT_ID}

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
# Built publisher pages (account.html, write.html → /account.js, /write.js). Do not copy source
# account.html or write.html afterward — they still point at /src/publisher/*.tsx.
COPY --from=builder /app/dist-publisher/ ./
# Static HTML allowlist — keep in sync with server/dockerfile-static.test.mjs.
# When you add a new root *.html page that should ship to Railway, COPY it here
# (or the production URL will 404 even though local vite serves it).
COPY --from=builder /app/index.html ./index.html
COPY --from=builder /app/generator.html ./generator.html
COPY --from=builder /app/dashboard.html ./dashboard.html
COPY --from=builder /app/articles.html ./articles.html
COPY --from=builder /app/article.html ./article.html
COPY --from=builder /app/admin-listings.html ./admin-listings.html
COPY --from=builder /app/embed-example.html ./embed-example.html
COPY --from=builder /app/register.html ./register.html
COPY --from=builder /app/agents.html ./agents.html
COPY --from=builder /app/connect-demo.html ./connect-demo.html
COPY --from=builder /app/connect-store.html ./connect-store.html
COPY --from=builder /app/connect-success.html ./connect-success.html
# Root scripts loaded by static pages (not Vite output). generator.html 200s
# while media validation fails if generator-media.js is missing here.
COPY --from=builder /app/site-nav.js ./site-nav.js
COPY --from=builder /app/write-draft-resume.js ./write-draft-resume.js
COPY --from=builder /app/generator-media.js ./generator-media.js
COPY --from=builder /app/llms.txt ./llms.txt
COPY --from=builder /app/agents.md ./agents.md
COPY --from=builder /app/skill.md ./skill.md
COPY --from=builder /app/VOICE_DRAFTS.md ./VOICE_DRAFTS.md
COPY --from=builder /app/openapi.json ./openapi.json
COPY --from=builder /app/robots.txt ./robots.txt
COPY --from=builder /app/favicon.ico ./favicon.ico
COPY --from=builder /app/apple-touch-icon.png ./apple-touch-icon.png
COPY --from=builder /app/manifest.webmanifest ./manifest.webmanifest
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/.well-known ./.well-known
COPY --from=builder /app/skills/README.md ./skills/README.md
COPY --from=builder /app/skills/mon-unlock-embed/README.md ./skills/mon-unlock-embed/README.md
COPY --from=builder /app/skills/mon-unlock-embed/OPTIONS.md ./skills/mon-unlock-embed/OPTIONS.md
COPY --from=builder /app/skills/mon-unlock-embed/AGENT.md ./skills/mon-unlock-embed/AGENT.md
COPY server ./server

# Serves static CDN + APIs (Coinbase, Stripe, agent MPP publish).
CMD ["node", "server/index.mjs"]
