FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# --ignore-scripts: the image only runs tsc (pure JS) and the compiled server.
# esbuild's postinstall exists for vitest, which never runs in here, and pnpm 10
# fails the install rather than skipping it silently.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=build /app/dist ./dist
EXPOSE 7070
# The world keeps its own clock; the container only has to stay alive.
CMD ["node", "dist/server/engine.js"]
