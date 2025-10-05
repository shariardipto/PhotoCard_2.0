FROM node:20-slim
WORKDIR /app

# system deps for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src

ENV NODE_ENV=production
CMD ["npm","run","start"]
