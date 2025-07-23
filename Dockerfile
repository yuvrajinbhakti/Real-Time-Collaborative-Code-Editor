# Enhanced Real-Time Collaborative Code Editor Dockerfile
# Multi-stage build for production optimization

# Stage 1: Build stage
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Install necessary build dependencies
RUN apk add --no-cache python3 make g++ && \
    npm install -g npm@latest

# Copy package files
COPY package*.json ./

# Clear npm cache and install dependencies
RUN npm cache clean --force && \
    npm ci --silent --no-audit --ignore-scripts && \
    npm cache clean --force

# Copy source code
COPY . .

# Build the React application
RUN npm run build

# Stage 2: Production stage
FROM node:18-alpine AS production

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Set working directory
WORKDIR /app

# Install dumb-init for proper signal handling and update npm
RUN apk add --no-cache dumb-init && \
    npm install -g npm@latest

# Copy package files
COPY package*.json ./

# Install only production dependencies with better error handling
RUN npm cache clean --force && \
    npm ci --only=production --silent --no-audit --ignore-scripts && \
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