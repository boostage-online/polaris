# syntax=docker/dockerfile:1.7
# Image worker : même build que l'API, autre point d'entrée (ADR-0001 : deux processus, un code).
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --filter @polaris/api... --filter @polaris/config

FROM deps AS build
COPY packages ./packages
COPY apps/api ./apps/api
COPY turbo.json ./
RUN pnpm --filter @polaris/contracts build && pnpm --filter @polaris/api build \
 && pnpm --filter @polaris/api --prod deploy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
RUN addgroup -S polaris && adduser -S polaris -G polaris
WORKDIR /app
COPY --from=build --chown=polaris:polaris /out ./
USER polaris
# Pas de port : la liveness est assurée par la supervision BullMQ (métriques) ; le PaaS redémarre sur sortie.
CMD ["node", "dist/worker/main.js"]
