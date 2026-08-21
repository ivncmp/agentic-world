# The viewer is a window, never an authority: it reads the engine over HTTP and
# WebSocket and holds no state of its own, so it can restart freely.
#
# Built here rather than mounted so the image is self-contained — a stranger
# cloning the repo gets a working world from `docker compose up` with no local
# Node toolchain.

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# Full install, not --prod: vite and phaser are devDependencies (the engine
# image must not carry them) and both are needed to produce the bundle.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY vite.config.ts tsconfig.viewer.json ./
COPY src ./src
RUN pnpm run viewer:build

FROM nginx:alpine
COPY infra/viewer/nginx.conf /etc/nginx/conf.d/default.conf
COPY infra/viewer/api_proxy.conf /etc/nginx/api_proxy.conf
COPY --from=build /app/dist/viewer /usr/share/nginx/html
EXPOSE 80
