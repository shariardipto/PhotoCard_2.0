FROM mcr.microsoft.com/playwright:v1.47.2-jammy
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY src ./src
ENV NODE_ENV=production
CMD ["npm","run","start"]
