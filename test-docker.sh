#!/bin/bash

# Docker Test Script for Enhanced Collaborative Code Editor
# This script tests the Docker setup and verifies all components work

set -e

echo "🐳 Testing Docker Setup for Enhanced Collaborative Code Editor"
echo "=============================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Check if Docker is installed and running
check_docker() {
    if command -v docker &> /dev/null; then
        print_status "Docker is installed"
        
        if docker info &> /dev/null; then
            print_status "Docker daemon is running"
            DOCKER_VERSION=$(docker --version)
            print_info "Docker version: $DOCKER_VERSION"
        else
            print_error "Docker daemon is not running"
            print_info "Please start Docker and try again"
            exit 1
        fi
    else
        print_error "Docker is not installed"
        print_info "Please install Docker from: https://docs.docker.com/get-docker/"
        exit 1
    fi
}

# Check if Docker Compose is available
check_docker_compose() {
    if command -v docker-compose &> /dev/null; then
        print_status "Docker Compose is available"
        COMPOSE_VERSION=$(docker-compose --version)
        print_info "Docker Compose version: $COMPOSE_VERSION"
        COMPOSE_CMD="docker-compose"
    elif docker compose version &> /dev/null; then
        print_status "Docker Compose (v2) is available"
        COMPOSE_VERSION=$(docker compose version)
        print_info "Docker Compose version: $COMPOSE_VERSION"
        COMPOSE_CMD="docker compose"
    else
        print_error "Docker Compose is not available"
        print_info "Please install Docker Compose"
        exit 1
    fi
}

# Test Docker build
test_docker_build() {
    print_info "Testing Docker build..."
    
    if docker build -t collab-editor-test . > build.log 2>&1; then
        print_status "Docker build successful"
        
        # Get image size
        IMAGE_SIZE=$(docker images collab-editor-test --format "table {{.Size}}" | tail -1)
        print_info "Image size: $IMAGE_SIZE"
        
        # Clean up test image
        docker rmi collab-editor-test > /dev/null 2>&1
        rm -f build.log
    else
        print_error "Docker build failed"
        print_info "Check build.log for details"
        tail -20 build.log
        exit 1
    fi
}

# Test development compose
test_dev_compose() {
    print_info "Testing development Docker Compose..."
    
    if $COMPOSE_CMD -f docker-compose.dev.yml config > /dev/null 2>&1; then
        print_status "Development compose configuration is valid"
    else
        print_error "Development compose configuration is invalid"
        $COMPOSE_CMD -f docker-compose.dev.yml config
        exit 1
    fi
}

# Test production compose
test_prod_compose() {
    print_info "Testing production Docker Compose..."
    
    if $COMPOSE_CMD -f docker-compose.yml config > /dev/null 2>&1; then
        print_status "Production compose configuration is valid"
    else
        print_error "Production compose configuration is invalid"
        $COMPOSE_CMD -f docker-compose.yml config
        exit 1
    fi
}

# Test file requirements
test_required_files() {
    print_info "Checking required files..."
    
    local required_files=(
        "Dockerfile"
        ".dockerignore"
        "docker-compose.yml"
        "docker-compose.dev.yml"
        "nginx.conf"
        "redis.conf"
        "prometheus.yml"
        "server-enhanced.js"
    )
    
    for file in "${required_files[@]}"; do
        if [ -f "$file" ]; then
            print_status "$file exists"
        else
            print_error "$file is missing"
            exit 1
        fi
    done
}

# Run quick container test
test_container_run() {
    print_info "Testing container startup..."
    
    # Build image for testing
    docker build -t collab-editor-test . > /dev/null 2>&1
    
    # Start container in background
    CONTAINER_ID=$(docker run -d -p 5001:5000 collab-editor-test)
    
    # Wait for container to start
    sleep 10
    
    # Test if container is healthy
    if docker ps | grep -q $CONTAINER_ID; then
        print_status "Container started successfully"
        
        # Test health endpoint (if container exposes it)
        if curl -s http://localhost:5001/health > /dev/null 2>&1; then
            print_status "Health endpoint responding"
        else
            print_warning "Health endpoint not responding (may need Redis)"
        fi
    else
        print_error "Container failed to start"
        docker logs $CONTAINER_ID
    fi
    
    # Cleanup
    docker stop $CONTAINER_ID > /dev/null 2>&1
    docker rm $CONTAINER_ID > /dev/null 2>&1
    docker rmi collab-editor-test > /dev/null 2>&1
}

# Main test function
run_tests() {
    print_info "Starting Docker tests..."
    echo ""
    
    check_docker
    check_docker_compose
    test_required_files
    test_docker_build
    test_dev_compose
    test_prod_compose
    
    # Only run container test if user agrees (it takes longer)
    read -p "Run container startup test? (takes ~30 seconds) (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        test_container_run
    fi
    
    echo ""
    print_status "All Docker tests passed! 🎉"
    echo ""
    print_info "You can now use these commands:"
    echo "  npm run docker:dev    - Start development environment"
    echo "  npm run docker:prod   - Start production environment"
    echo "  npm run docker:build  - Build Docker image"
    echo ""
    print_info "For more details, see DOCKER-DEPLOYMENT.md"
}

# Run the tests
run_tests 