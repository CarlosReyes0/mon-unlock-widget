# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Install a lightweight static file server
RUN npm install -g http-server

# Copy built assets and static pages
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/demo.html ./demo.html
COPY --from=builder /app/generator.html ./generator.html
COPY --from=builder /app/examples ./examples

# Serve the current directory with index.html as default and directory listings disabled; --proxy falls back to demo.html for unknown paths
CMD ["sh", "-c", "http-server . -p ${PORT:-8080} -d false --proxy http://localhost:${PORT:-8080}/demo.html"]
