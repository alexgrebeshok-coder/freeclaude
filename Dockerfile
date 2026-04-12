FROM node:20-slim AS builder

WORKDIR /app

# Install Bun
RUN npm install -g bun

# Copy source
COPY package.json bun.lock* ./
COPY bin/ ./bin/
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY tsconfig*.json ./

# Install deps and build
RUN bun install --frozen-lockfile 2>/dev/null || bun install
RUN bun run build

# ─── Runtime ───────────────────────────────────────────────────────────────

FROM node:20-slim

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/bin/ ./bin/
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/package.json ./

# Create config dir
RUN mkdir -p /root/.freeclaude

ENV FREECLAUDE_CONFIG=/root/.freeclaude.json

ENTRYPOINT ["node", "dist/cli.mjs"]
CMD []
