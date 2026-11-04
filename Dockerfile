# One image: the API, the built web app and the grading worker run in one process.

# --- build: install everything, build the web app ---
FROM oven/bun:1.4.4-slim AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# --ignore-scripts: the tsc patch (prepare) is for typechecking, not runtime.
RUN bun install --frozen-lockfile --ignore-scripts
COPY packages packages
COPY apps apps
RUN bun run build

# --- runtime: production deps + server source + built web ---
FROM oven/bun:1.4.4-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
COPY packages/domain/package.json packages/domain/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY packages/domain/src packages/domain/src
COPY apps/server/src apps/server/src
COPY apps/server/migrations apps/server/migrations
COPY prompts prompts
COPY --from=build /app/apps/web/dist apps/web/dist
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION WEB_DIST=/app/apps/web/dist PORT=8080
WORKDIR /app/apps/server
USER bun
EXPOSE 8080
CMD ["bun", "src/main.ts"]
