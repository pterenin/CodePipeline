# syntax=docker/dockerfile:1.7

ARG PLAYWRIGHT_IMAGE_TAG=v1.59.1-noble

FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_IMAGE_TAG} AS build

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_IMAGE_TAG} AS runtime

ARG CODEX_CLI_NPM_VERSION=0.117.0

WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PORT=3000 \
    WORK_ROOT=/app/workdir

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm install -g @openai/codex@${CODEX_CLI_NPM_VERSION} \
    && npm cache clean --force

COPY --from=build /app/dist ./dist

VOLUME ["/app/workdir"]
EXPOSE 3000

CMD ["node", "dist/index.js"]
