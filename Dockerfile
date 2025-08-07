# Render-Optimized Dockerfile for Real-Time Collaborative Code Editor
# Single-stage build optimized for Render deployment platform

FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    dumb-init

# Set working directory FIRST
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Set all environment variables for Render
ENV NODE_ENV=production \
    PORT=10000 \
    SKIP_PREFLIGHT_CHECK=true \
    CI=false \
    GENERATE_SOURCEMAP=false \
    INLINE_RUNTIME_CHUNK=false \
    DISABLE_ESLINT_PLUGIN=true \
    NODE_OPTIONS="--max-old-space-size=2048" \
    LOG_LEVEL=info

# Copy package files first for better caching
COPY package.json package-lock.json ./

# Install dependencies with compatibility flags
RUN npm ci --legacy-peer-deps --no-audit --prefer-offline && \
    npm cache clean --force

# Copy source files explicitly to prevent directory read errors
COPY src/ ./src/
COPY public/ ./public/
COPY server.js server-simple.js server-enhanced.js ./
COPY services/ ./services/
COPY routes/ ./routes/
COPY models/ ./models/
COPY controllers/ ./controllers/
COPY middleware/ ./middleware/
COPY config/ ./config/

# Remove conflicting files and build React app
RUN rm -f .env.local .env.development.local .env.test.local && \
    npm run build:render

# Create required directories and set permissions
RUN mkdir -p logs && \
    chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 10000

# Health check for Render
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:10000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the application with full AI server
CMD ["node", "server.js"] 