# Build from the repo root: docker build -f apps/mcp/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/mcp ./apps/mcp
RUN pnpm install --frozen-lockfile --filter mcp... && pnpm --filter mcp build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /repo/apps/mcp/dist/index.js ./index.js
USER node
ENTRYPOINT ["node", "index.js"]
