FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=1001:0 /app/package*.json ./
COPY --from=build --chown=1001:0 /app/node_modules ./node_modules
COPY --from=build --chown=1001:0 /app/dist ./dist
USER 1001
EXPOSE 3100
CMD ["node", "dist/main.js"]
