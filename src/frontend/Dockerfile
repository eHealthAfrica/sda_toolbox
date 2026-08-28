# syntax=docker/dockerfile:1

# SDA Toolbox — frontend (Vite + React) image.
# Multi-stage: build the static bundle with Node, then serve it with a
# minimal nginx image. Nothing here needs a Node runtime at serve time — the
# build output is plain static files (index.html + hashed JS/CSS, plus the
# two sql.js .wasm files that live in public/ and that Vite copies to the
# output root unchanged; see src/utils/gpkg.ts for why both are needed).

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# Stage 1: build — npm ci + vite build
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS builder

WORKDIR /app

# Dependency layer first, cached independently of source changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_API_BASE_URL is baked into the built JS at build time — Vite only
# ever substitutes import.meta.env.VITE_* with values present when `vite
# build` runs (see api/client.ts's `const API_BASE_URL =
# import.meta.env.VITE_API_BASE_URL`); there's no reading it from the
# environment once the static bundle is being served, unlike the backend's
# CORS_ALLOW_ORIGINS. So this has to be a build ARG, not a runtime env var.
# Default matches this same repo's docker-compose.yml backend port mapping
# (8000:8000) for local `docker compose up` use; override it via
# docker-compose.yml's build.args (FRONTEND_API_BASE_URL in the root .env)
# with the real public API URL for any other deployment. .env.example has
# the equivalent variable for local (non-Docker) `npm run dev` use.
ARG VITE_API_BASE_URL=http://localhost:8000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: runtime — nginx serving the built static files
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
