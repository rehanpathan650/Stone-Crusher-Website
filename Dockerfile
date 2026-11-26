# ---------- 1. Install dependencies (build tools only for native modules) ----------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

# ---------- 2. Build the Next.js app ----------
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- 3. Runtime image: only the standalone server (no build tools, non-root user) ----------
FROM node:22-alpine
ENV NODE_ENV=production     PORT=4000     HOSTNAME=0.0.0.0     NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# The API reads its migrations from disk and writes backups to server/data
COPY --from=build /app/server/src/migrations ./server/src/migrations
RUN mkdir -p server/data .next/cache && chown -R node:node server/data .next/cache
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "server.js"]
