# ---- Build Stage ----
FROM node:24-alpine AS builder

RUN --mount=type=cache,target=/var/cache/apk apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
# Prune dev deps in builder so production just copies clean node_modules
RUN npm prune --omit=dev

# ---- Production Stage ----
FROM node:24-alpine

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/data

ENV PORT=3001
ENV DB_PATH=/app/data/cf-manager.db

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "dist/index.js"]
