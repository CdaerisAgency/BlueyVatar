# One image for web, delivery, indexer, and the migration runner. Each Railway
# service runs a different start command (see railway/*.json).
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm lex:build \
 && pnpm -r build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
USER node
# Overridden per service by deploy.startCommand.
CMD ["node", "apps/delivery/dist/server.js"]
