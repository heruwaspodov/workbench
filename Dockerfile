FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock* ./
COPY patches patches/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile
COPY . .
RUN bun --cwd apps/web run build

FROM oven/bun:1.3-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
WORKDIR /app/apps/server
EXPOSE 3000
CMD ["sh", "-c", "bun run db:migrate && bun run start"]
