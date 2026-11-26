# ---------- 1. Build the React client ----------
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---------- 2. Install server production dependencies ----------
FROM node:22-alpine AS deps
WORKDIR /app/server
RUN apk add --no-cache python3 make g++
COPY server/package*.json ./
RUN npm ci --omit=dev

# ---------- 3. Runtime image (no build tools, non-root user) ----------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0
WORKDIR /app/server
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
RUN mkdir -p data && chown -R node:node /app/server/data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "src/index.js"]
