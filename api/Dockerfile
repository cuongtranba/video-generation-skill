FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
EXPOSE 8080
CMD ["bun", "src/index.ts"]
