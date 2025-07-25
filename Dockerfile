# Production-Ready Dockerfile for Real-Time Collaborative Code Editor
# Optimized for all deployment platforms (Render, Vercel, Railway, etc.)

FROM node:18-alpine AS base

# Install system dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat \
    dumb-init

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Build stage
FROM base AS builder

# Set environment variables for build
ENV NODE_ENV=production \
    SKIP_PREFLIGHT_CHECK=true \
    GENERATE_SOURCEMAP=false \
    INLINE_RUNTIME_CHUNK=false \
    NODE_OPTIONS="--max-old-space-size=4096"

# Copy package files
COPY package*.json ./

# Clean install dependencies with proper flags
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# Copy source code
COPY . .

# Remove conflicting files if they exist
RUN rm -f .env.local .env.development.local .env.test.local

# Build the React application
RUN npm run build:production

# Production stage
FROM base AS production

# Set production environment
ENV NODE_ENV=production \
    PORT=5000 \
    LOG_LEVEL=info

# Copy built application from builder stage
COPY --from=builder --chown=nextjs:nodejs /app/build ./build
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package*.json ./

# Copy server files
COPY --chown=nextjs:nodejs server*.js ./
COPY --chown=nextjs:nodejs src/Actions.js ./src/
COPY --chown=nextjs:nodejs config ./config/
COPY --chown=nextjs:nodejs services ./services/
COPY --chown=nextjs:nodejs routes ./routes/
COPY --chown=nextjs:nodejs middleware ./middleware/
COPY --chown=nextjs:nodejs models ./models/

# Create required directories
RUN mkdir -p logs && chown -R nextjs:nodejs logs

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "server-simple.js"] 