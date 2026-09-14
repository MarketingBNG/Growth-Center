# syntax=docker/dockerfile:1
#
# The only image this project builds — used both for the Neon-pointed stack
# (docker-compose.yml) and the local-Postgres stack (+ docker-compose.local-db.yml).
# No dev/hot-reload variant lives here or anywhere else in this repo anymore.
#
# Just the Next.js app. Nginx (if/when added) is its own separate container in
# docker-compose.yml, reverse-proxying to this one on port 3000 — it does not
# belong inside this image.
#
# Single stage: a separate build/runner split copied full node_modules (dev deps
# included, no `output: standalone` in next.config.ts) into the final image
# either way, so it bought no smaller image — just extra layers.

# Default only — kept in sync with "engines.node" in package.json at build
# time by `npm run docker:build` (tools/docker-build.ts reads package.json and
# passes --build-arg NODE_VERSION), not by hand. Plain `docker build .` still
# falls back to this default, so bump it here too if you ever build without
# that script.
ARG NODE_VERSION=22

# Debian slim (not alpine): Prisma's query engine ships prebuilt binaries per
# libc target, and glibc avoids musl mismatches.
FROM node:${NODE_VERSION}-slim
WORKDIR /app
# openssl is required by Prisma's engine at runtime on Debian slim.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .

# next build with static/SSG pages may touch the DB — see README note in docker-compose.
# Provide build-time-only placeholders so `prisma generate` (which needs no live DB) and
# `next build` succeed even when real secrets are only supplied at container run time.
ARG DATABASE_URL="postgresql://user:pass@localhost:5432/db"
ARG DIRECT_URL="postgresql://user:pass@localhost:5432/db"
ENV DATABASE_URL=${DATABASE_URL} \
    DIRECT_URL=${DIRECT_URL} \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Runs as an unprivileged user rather than root — the node:22-slim base image
# already ships one (uid 1000) for exactly this purpose.
RUN chown -R node:node /app
USER node

EXPOSE 3000
ENV PORT=3000 HOSTNAME="0.0.0.0"

CMD ["npm", "run", "start"]
