FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ENV NODE_ENV=development
CMD ["npm","run","dev"]
