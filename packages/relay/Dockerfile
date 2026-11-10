# The AgentOS relay, as a small image.
#
# Build it from the repository root, where the lockfile is:
#   docker build -f packages/relay/Dockerfile -t agentos-relay .
# Run it, private, with a token of its own (see README.md):
#   docker run -d -p 8080:8080 -v agentos-relay:/data -e RELAY_TOKEN="$(openssl rand -hex 32)" agentos-relay

FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
# Dependencies first, from the lockfile: this layer only changes when they do.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/relay/package.json packages/relay/
RUN pnpm install --frozen-lockfile --filter @agentos/relay
COPY packages/relay/tsconfig.json packages/relay/
COPY packages/relay/src packages/relay/src
# `deploy --prod` gathers the built package and what it needs to run — one dependency — in /out.
RUN pnpm --filter @agentos/relay build \
 && pnpm --filter @agentos/relay deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 RELAY_DATA=/data
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
# The one file the relay keeps lives in /data; the relay runs as an ordinary user who owns it.
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "dist/cli.js"]
