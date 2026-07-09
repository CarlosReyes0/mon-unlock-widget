# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# Privy app ID is baked into the checkout bundle at build time.
ARG VITE_PRIVY_APP_ID=
ENV VITE_PRIVY_APP_ID=$VITE_PRIVY_APP_ID

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

# Serve static files (incl. /dist/* hashed chunks for ES modules) with CORS headers so any site can embed the widget via CDN.
# Uses Access-Control-Allow-Origin: * (permissive for public CDN embeds; non-credentialed requests only).
# To restrict later, replace with a custom server reading EMBED_ALLOWED_ORIGINS env var.
CMD ["sh", "-c", "http-server . -p ${PORT:-8080} -d false --cors -c-1 --proxy http://localhost:${PORT:-8080}/index.html"]
