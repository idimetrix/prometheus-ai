FROM node:22-alpine AS builder
WORKDIR /action
COPY package.json tsconfig.json ./
RUN corepack enable && corepack prepare pnpm@10 --activate
RUN pnpm install --frozen-lockfile
COPY src/ ./src/
RUN pnpm run build

FROM node:22-alpine AS runner
WORKDIR /action
COPY --from=builder /action/dist ./dist
COPY --from=builder /action/package.json ./
ENTRYPOINT ["node", "/action/dist/index.js"]
