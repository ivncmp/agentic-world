# Clean, self-contained dbrain instance for agentic-world.
# Installed from npm (not the dtoolkit monorepo) so this repo stays portable:
# anyone cloning it can `docker compose up` without checking out dtoolkit.
FROM node:22-slim

ARG DBRAIN_VERSION=1.0.1

# better-sqlite3 is a native module; build deps are needed if no prebuilt
# binary matches the platform. Purged afterwards to keep the image small.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && npm install -g "@dtoolkit/dbrain@${DBRAIN_VERSION}" \
 && apt-get purge -y python3 make g++ \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

ENV DBRAIN_DATA=/data \
    DBRAIN_PORT=7878 \
    DBRAIN_HOST=0.0.0.0 \
    DBRAIN_NON_INTERACTIVE=1

VOLUME /data
EXPOSE 7878 7879

# init is idempotent-safe on a populated volume; start serves API + dashboard.
CMD ["sh", "-c", "dbrain init --non-interactive $DBRAIN_DATA && dbrain start $DBRAIN_DATA"]
