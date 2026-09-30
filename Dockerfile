FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
# npm resolves every workspace listed in the root package.json, so the client and e2e manifests must exist.
COPY client/package.json client/
COPY e2e/package.json e2e/
RUN npm ci --workspace=server --workspace=shared --include-workspace-root

COPY shared shared
COPY server/src server/src
COPY server/tsconfig.json server/

# Run as the image's unprivileged user. The app files stay root-owned and read-only to it; tsx caches in /tmp.
USER node
EXPOSE 8080
CMD ["npx", "tsx", "server/src/index.ts"]
