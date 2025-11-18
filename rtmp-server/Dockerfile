# ---------- Dependencies Stage ----------
FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci


# ---------- Build Stage ----------
FROM node:22-alpine AS builder


WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build


# ---------- Runtime Stage ----------
FROM node:22-alpine AS runner

WORKDIR /app

# Install ffmpeg only for runtime
RUN apk add --no-cache ffmpeg

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/build ./build

RUN mkdir -p ./media/recordings ./media/temp

ENV NODE_ENV=production

EXPOSE 1935 8002 8888
CMD ["node", "build/index.js"]
