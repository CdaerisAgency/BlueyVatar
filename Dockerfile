# One image for web, delivery, indexer, and the migration runner. Each Fly
# app sets its own command in fly/*.toml.
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
# Overridden per app by [experimental] cmd in fly/*.toml.
CMD ["node", "apps/delivery/dist/server.js"]
