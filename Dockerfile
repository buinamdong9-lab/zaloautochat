# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Install build dependencies for compiling the C++ cryptography addon
RUN apk add --no-cache python3 make g++ gcc libc-dev

# Copy package files and compilation configuration
COPY package*.json ./
COPY binding.gyp ./

# Copy C/C++ native source file for node-gyp compilation
COPY src/native/ ./src/native/

# Install dependencies (including devDependencies for TypeScript compilation)
RUN npm ci

# Copy source code and assets
COPY tsconfig.json ./
COPY src/ ./src
COPY public/ ./public

# Build TypeScript and compile C++ native addon
RUN npm run build

# Remove development dependencies to keep the image light
RUN npm prune --production

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app

# Copy built outputs and production node_modules from builder stage
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/build ./build

# Create directory to store persistent SQLite database
RUN mkdir -p /app/data

ENV PORT=5100
EXPOSE 5100

CMD ["node", "dist/server.js"]
