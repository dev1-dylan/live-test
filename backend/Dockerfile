# ---------- Dependencies Stage ----------
FROM node:22-alpine AS deps

WORKDIR /usr/src/app

COPY package*.json ./

# Install all deps (including dev) for build
RUN npm ci


# ---------- Build Stage ----------
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Copy node_modules from deps
COPY --from=deps /usr/src/app/node_modules ./node_modules

# Copy all source
COPY . .

# Build TypeScript -> build folder
RUN npm run build


# ---------- Runtime Stage ----------
FROM node:22-alpine AS runner

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# npm install production deps
RUN npm ci --omit=dev --ignore-scripts

# Copy build output & public from builder
COPY --from=builder /usr/src/app/build ./build
# Create public directory if it doesn't exist (for uploads)
RUN mkdir -p ./public


# Environment
ENV NODE_ENV=production

# Expose port
EXPOSE 3002

CMD ["node", "build/index.js"]
