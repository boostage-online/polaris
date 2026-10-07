# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --filter @polaris/web... --filter @polaris/config

FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY packages ./packages
COPY apps/web ./apps/web
COPY turbo.json ./
RUN pnpm --filter @polaris/contracts build && pnpm --filter @polaris/web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
RUN addgroup -S polaris && adduser -S polaris -G polaris
WORKDIR /app
COPY --from=build --chown=polaris:polaris /repo/apps/web/.next/standalone ./
COPY --from=build --chown=polaris:polaris /repo/apps/web/.next/static ./apps/web/.next/static
USER polaris
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
