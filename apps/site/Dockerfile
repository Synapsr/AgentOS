# The AgentOS website, as a small image: the static site served by nginx.
#
# Build it from the repository root (the site reads packages/design,
# packages/presence and docs/screenshots):
#   docker build -f apps/site/Dockerfile -t agentos-site .
# Run it:
#   docker run -d -p 8080:80 agentos-site
# SITE_URL (a build argument) is the address the site is published at; it
# goes into links, the sitemap and link previews.

FROM node:22-bookworm-slim AS build
ARG SITE_URL=https://os.synapsr.io
ENV SITE_URL=$SITE_URL
WORKDIR /repo
RUN corepack enable
# Dependencies first, from the lockfile: this layer only changes when they do.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/design/package.json packages/design/
COPY packages/presence/package.json packages/presence/
COPY apps/site/package.json apps/site/
RUN pnpm install --frozen-lockfile --filter "@agentos/site..."
# Then the sources: the two packages the site draws with, the screenshots it shows, the site.
COPY packages/design packages/design
COPY packages/presence packages/presence
COPY docs/screenshots docs/screenshots
COPY apps/site apps/site
# "@agentos/site..." builds the site after the packages it depends on.
RUN pnpm -r --filter "@agentos/site..." build

FROM nginx:1.29-alpine
COPY apps/site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/site/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
