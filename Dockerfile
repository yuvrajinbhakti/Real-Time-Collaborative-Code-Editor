# Enhanced Real-Time Collaborative Code Editor Dockerfile
# Fixed for Render deployment - Node 18 with working dependencies

# Stage 1: Build stage
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Install necessary build dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    pkgconfig \
    vips-dev \
    libc6-compat

# Set environment variables to prevent build issues
ENV SKIP_PREFLIGHT_CHECK=true
ENV CI=false
ENV GENERATE_SOURCEMAP=false
ENV NODE_OPTIONS="--max-old-space-size=3072"
ENV TSC_COMPILE_ON_ERROR=true
ENV DISABLE_ESLINT_PLUGIN=true
ENV DISABLE_NEW_JSX_TRANSFORM=true

# Copy package files and fix them
COPY package*.json ./

# Fix package.json to use working versions and install dependencies
RUN npm cache clean --force && \
    rm -rf node_modules package-lock.json && \
    sed -i 's/"react-scripts": "5.0.0"/"react-scripts": "4.0.3"/g' package.json && \
    npm config set registry https://registry.npmjs.org/ && \
    npm install --legacy-peer-deps --no-audit --production=false && \
    npm cache clean --force

# Copy source code
COPY . .

# Build the React application
RUN npm run build || npm run build:render || SKIP_PREFLIGHT_CHECK=true npm run build

# Stage 2: Production stage
FROM node:18-alpine AS production

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Set working directory
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    dumb-init \
    libc6-compat

# Copy package files
COPY package*.json ./

# Install only production dependencies using npm install
RUN npm cache clean --force && \
    rm -rf node_modules package-lock.json && \
    npm config set registry https://registry.npmjs.org/ && \
    npm install --only=production --legacy-peer-deps --no-audit && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=nextjs:nodejs /app/build ./build
COPY --from=builder --chown=nextjs:nodejs /app/server-enhanced.js ./
COPY --from=builder --chown=nextjs:nodejs /app/config ./config
COPY --from=builder --chown=nextjs:nodejs /app/services ./services
COPY --from=builder --chown=nextjs:nodejs /app/src ./src

# Create logs directory
RUN mkdir -p logs && chown -R nextjs:nodejs logs

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000
ENV LOG_LEVEL=info
ENV SKIP_PREFLIGHT_CHECK=true
ENV CI=false
ENV NODE_OPTIONS="--max-old-space-size=3072"

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 5000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the enhanced server
CMD ["node", "server-enhanced.js"] 