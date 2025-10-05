FROM node:20-slim
WORKDIR /app

# system deps for Prisma
RUN apt-get update && apt-get install -y openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY prisma ./prisma
# NOTE: prisma generate can download native binaries which may fail during docker build in restricted networks.
# We'll run `prisma generate` at container start (in scripts/wait-and-start.js) after the DB is reachable.
COPY scripts ./scripts

COPY src ./src

ENV NODE_ENV=production
CMD ["npm","run","start"]
