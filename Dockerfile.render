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

# Copy the application. Listing paths individually is what broke this image
# twice: first a new top-level module (ot-rooms.js) was invisible because nobody
# added it here, then `COPY controllers/` failed the build outright because that
# directory does not exist. Both are the same mistake — a second, hand-maintained
# inventory of the repository that silently drifts from the repository.
#
# .dockerignore already excludes node_modules, build, .env files, .git and logs,
# so copying the tree is both smaller in intent and correct by default: a file
# added to the project is in the image without anyone remembering to say so.
COPY . .

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