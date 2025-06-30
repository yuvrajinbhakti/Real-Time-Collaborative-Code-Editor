#!/bin/bash

# Enhanced Real-Time Collaborative Code Editor Setup Script
# This script sets up the production-ready version with Redis, monitoring, and all features

set -e

echo "🚀 Setting up Enhanced Real-Time Collaborative Code Editor..."
echo "================================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if Node.js is installed
check_nodejs() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        print_status "Node.js detected: $NODE_VERSION"
        
        # Check if version is 14 or higher
        NODE_MAJOR=$(echo $NODE_VERSION | cut -d. -f1 | sed 's/v//')
        if [ "$NODE_MAJOR" -lt 14 ]; then
            print_error "Node.js version 14 or higher required. Current: $NODE_VERSION"
            exit 1
        fi
    else
        print_error "Node.js not found. Please install Node.js 14+ first."
        print_info "Visit: https://nodejs.org/"
        exit 1
    fi
}

# Check if Redis is available
check_redis() {
    if command -v redis-server &> /dev/null; then
        print_status "Redis server found"
        REDIS_AVAILABLE=true
    elif command -v docker &> /dev/null; then
        print_warning "Redis not found locally, but Docker is available"
        print_info "Will offer to start Redis in Docker"
        REDIS_AVAILABLE=false
    else
        print_warning "Redis not found and Docker not available"
        print_info "You can install Redis or use a cloud Redis service"
        REDIS_AVAILABLE=false
    fi
}

# Install npm dependencies
install_dependencies() {
    print_info "Installing enhanced dependencies..."
    
    if [ -f "package.json" ]; then
        npm install
        print_status "Dependencies installed successfully"
    else
        print_error "package.json not found. Are you in the correct directory?"
        exit 1
    fi
}

# Create environment configuration
setup_environment() {
    print_info "Setting up environment configuration..."
    
    if [ ! -f ".env" ]; then
        cat > .env << EOF
# Enhanced Collaborative Code Editor Configuration
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:3000

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Performance Configuration
MAX_CONCURRENT_USERS=1000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
DEBOUNCE_DELAY_MS=50

# Monitoring Configuration
METRICS_PORT=9090
ENABLE_METRICS=true
LOG_LEVEL=info
ENABLE_HEALTH_CHECKS=true
HEALTH_CHECK_INTERVAL=30000

# Operational Transform Configuration
ENABLE_OT=true
OT_CONFLICT_RESOLUTION=true
MAX_OPERATION_QUEUE_SIZE=1000

# Security Configuration
CORS_ORIGIN=http://localhost:3000
HELMET_ENABLED=true
RATE_LIMITING_ENABLED=true
EOF
        print_status "Environment configuration created (.env)"
    else
        print_status "Environment configuration already exists"
    fi
}

# Setup Redis
setup_redis() {
    if [ "$REDIS_AVAILABLE" = true ]; then
        print_info "Starting Redis server..."
        
        # Check if Redis is already running
        if redis-cli ping &> /dev/null; then
            print_status "Redis is already running"
        else
            # Start Redis in background
            redis-server --daemonize yes --port 6379
            sleep 2
            
            if redis-cli ping &> /dev/null; then
                print_status "Redis server started successfully"
            else
                print_error "Failed to start Redis server"
                exit 1
            fi
        fi
    else
        read -p "Do you want to start Redis using Docker? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_info "Starting Redis container..."
            docker run -d --name redis-collab-editor -p 6379:6379 redis:7-alpine
            
            # Wait for Redis to be ready
            print_info "Waiting for Redis to be ready..."
            sleep 5
            
            if docker exec redis-collab-editor redis-cli ping &> /dev/null; then
                print_status "Redis container started successfully"
            else
                print_error "Failed to start Redis container"
                exit 1
            fi
        else
            print_warning "Skipping Redis setup. You'll need to configure Redis manually."
            print_info "Update REDIS_URL in .env file with your Redis connection string"
        fi
    fi
}

# Create logs directory
setup_logging() {
    if [ ! -d "logs" ]; then
        mkdir -p logs
        print_status "Logs directory created"
    fi
}

# Build the application
build_application() {
    print_info "Building React application..."
    npm run build
    print_status "Application built successfully"
}

# Verify setup
verify_setup() {
    print_info "Verifying setup..."
    
    # Check if all required files exist
    local required_files=(
        "server-enhanced.js"
        "config/environment.js"
        "services/redis.js"
        "services/operationalTransform.js"
        "services/messageQueue.js"
        "services/healthCheck.js"
        "services/logger.js"
        "load-test.yml"
    )
    
    for file in "${required_files[@]}"; do
        if [ -f "$file" ]; then
            print_status "$file exists"
        else
            print_error "$file is missing"
            exit 1
        fi
    done
    
    # Test Redis connection
    if redis-cli ping &> /dev/null; then
        print_status "Redis connection successful"
    else
        print_warning "Redis connection failed - server may not be running"
    fi
}

# Start the enhanced server
start_server() {
    read -p "Do you want to start the enhanced server now? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Starting enhanced server..."
        echo ""
        echo "🚀 Server will start on http://localhost:5000"
        echo "📊 Health check: http://localhost:5000/health"
        echo "📈 Metrics: http://localhost:5000/metrics"
        echo "🔍 Queue status: http://localhost:5000/api/queue/status"
        echo ""
        echo "Press Ctrl+C to stop the server"
        echo ""
        
        # Start the enhanced server
        node server-enhanced.js
    else
        print_info "Setup complete! You can start the server manually with:"
        echo "  node server-enhanced.js"
        echo ""
        print_info "Or start in development mode with:"
        echo "  npm run start:dev"
    fi
}

# Print usage instructions
print_usage() {
    echo ""
    echo "🎯 Enhanced Features Available:"
    echo "================================"
    echo "✅ Redis Pub/Sub for horizontal scaling"
    echo "✅ Operational Transformation for conflict resolution"
    echo "✅ Message Queue processing with Bull"
    echo "✅ Comprehensive health checks and monitoring"
    echo "✅ Prometheus metrics integration"
    echo "✅ Rate limiting and security features"
    echo "✅ Structured logging with Winston"
    echo "✅ Load testing with Artillery"
    echo ""
    echo "🔧 Available Commands:"
    echo "====================="
    echo "npm run start:dev    - Start development server with Redis"
    echo "npm run build        - Build production application"
    echo "npm start           - Start production server"
    echo "npm run test:load   - Run load tests with Artillery"
    echo "npm run monitoring  - Start metrics server"
    echo ""
    echo "📊 Monitoring Endpoints:"
    echo "========================"
    echo "http://localhost:5000/health          - Simple health check"
    echo "http://localhost:5000/health/detailed - Detailed health report"
    echo "http://localhost:5000/metrics         - Prometheus metrics"
    echo "http://localhost:5000/api/status      - Server status"
    echo "http://localhost:5000/api/queue/status - Queue status"
    echo "http://localhost:5000/api/rooms/stats  - Room statistics"
    echo ""
    echo "🚀 Ready for production deployment!"
}

# Main setup process
main() {
    echo "Starting enhanced setup process..."
    echo ""
    
    check_nodejs
    check_redis
    install_dependencies
    setup_environment
    setup_redis
    setup_logging
    build_application
    verify_setup
    
    print_status "Enhanced setup completed successfully!"
    print_usage
    
    start_server
}

# Run main function
main

echo ""
echo "🎉 Setup complete! Your enhanced collaborative code editor is ready."
echo "📚 Check README-ENHANCED.md for detailed documentation."
echo "" 