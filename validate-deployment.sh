#!/bin/bash

# Deployment Validation Script for Real-Time Collaborative Code Editor
# This script validates the project is ready for production deployment

set -e

echo "🔍 DEPLOYMENT VALIDATION - Real-Time Collaborative Code Editor"
echo "=============================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }
print_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }

validation_errors=0

echo
echo "📋 CHECKING PROJECT STRUCTURE"
echo "=============================="

# Check required files
required_files=(
    "package.json"
    "server.js"
    "server-simple.js"
    "Dockerfile"
    "Dockerfile.render"
    "render.yaml"
    "src/App.js"
    "public/index.html"
)

for file in "${required_files[@]}"; do
    if [[ -f "$file" ]]; then
        print_success "Found $file"
    else
        print_error "Missing $file"
        ((validation_errors++))
    fi
done

echo
echo "📦 CHECKING DEPENDENCIES"
echo "========================"

# Check if node_modules exists
if [[ -d "node_modules" ]]; then
    print_success "Dependencies installed"
else
    print_warning "Dependencies not installed - running npm install"
    npm install --legacy-peer-deps
fi

# Check for critical dependencies
critical_deps=("react" "react-dom" "socket.io" "express" "codemirror")
for dep in "${critical_deps[@]}"; do
    if npm list "$dep" &>/dev/null; then
        print_success "$dep dependency found"
    else
        print_error "$dep dependency missing"
        ((validation_errors++))
    fi
done

echo
echo "🏗️  TESTING BUILD PROCESS"
echo "=========================="

# Test build
print_info "Testing production build..."
if npm run build:render; then
    print_success "Build successful"
    
    # Check if build directory exists and has content
    if [[ -d "build" ]] && [[ "$(ls -A build)" ]]; then
        print_success "Build directory created with content"
        build_size=$(du -sh build | cut -f1)
        print_info "Build size: $build_size"
    else
        print_error "Build directory empty or missing"
        ((validation_errors++))
    fi
else
    print_error "Build failed"
    ((validation_errors++))
fi

echo
echo "🔧 VALIDATING CONFIGURATION"
echo "==========================="

# Check render.yaml
if [[ -f "render.yaml" ]]; then
    if grep -q "dockerfilePath: ./Dockerfile.render" render.yaml; then
        print_success "render.yaml uses Dockerfile.render"
    else
        print_warning "render.yaml might not use Dockerfile.render"
    fi
    
    if grep -q "healthCheckPath: /health" render.yaml; then
        print_success "Health check configured"
    else
        print_error "Health check not configured"
        ((validation_errors++))
    fi
else
    print_error "render.yaml missing"
    ((validation_errors++))
fi

# Check Dockerfile.render
if [[ -f "Dockerfile.render" ]]; then
    if grep -q "PORT=10000" Dockerfile.render; then
        print_success "Dockerfile.render has correct port"
    else
        print_warning "Port might not be configured correctly"
    fi
    
    if grep -q "SKIP_PREFLIGHT_CHECK=true" Dockerfile.render; then
        print_success "Build optimizations configured"
    else
        print_error "Build optimizations missing"
        ((validation_errors++))
    fi
fi

echo
echo "🩺 TESTING HEALTH ENDPOINTS"
echo "==========================="

# Start server in background for testing
print_info "Starting server for health check testing..."
npm run start:simple &
server_pid=$!

# Wait for server to start
sleep 5

# Test health endpoint
if curl -f -s http://localhost:5000/health > /dev/null; then
    print_success "Health endpoint responding"
else
    print_error "Health endpoint not responding"
    ((validation_errors++))
fi

# Test detailed health endpoint
if curl -f -s http://localhost:5000/health/detailed > /dev/null; then
    print_success "Detailed health endpoint responding"
else
    print_warning "Detailed health endpoint not responding"
fi

# Stop the server
kill $server_pid 2>/dev/null || true
sleep 2

echo
echo "🐳 DOCKER VALIDATION"
echo "===================="

if command -v docker &> /dev/null; then
    print_info "Testing Docker build..."
    if docker build -f Dockerfile.render -t realtime-editor-test . &>/dev/null; then
        print_success "Docker build successful"
        
        # Clean up test image
        docker rmi realtime-editor-test &>/dev/null || true
    else
        print_error "Docker build failed"
        ((validation_errors++))
    fi
else
    print_warning "Docker not available for testing"
fi

echo
echo "🔐 SECURITY VALIDATION"
echo "======================"

# Check for sensitive files
sensitive_files=(".env" "*.pem" "*.key" "*secret*")
found_sensitive=false
for pattern in "${sensitive_files[@]}"; do
    if ls $pattern 2>/dev/null | grep -v ".env.example" | grep -q .; then
        print_warning "Found potentially sensitive file: $pattern"
        found_sensitive=true
    fi
done

if ! $found_sensitive; then
    print_success "No sensitive files found in repository"
fi

# Check gitignore
if [[ -f ".gitignore" ]]; then
    if grep -q ".env" .gitignore && grep -q "node_modules" .gitignore; then
        print_success ".gitignore properly configured"
    else
        print_warning ".gitignore might be missing important entries"
    fi
else
    print_error ".gitignore missing"
    ((validation_errors++))
fi

echo
echo "📊 VALIDATION SUMMARY"
echo "===================="

if [[ $validation_errors -eq 0 ]]; then
    print_success "ALL VALIDATIONS PASSED! 🎉"
    echo
    print_info "Your project is ready for deployment!"
    echo
    echo "🚀 NEXT STEPS:"
    echo "1. Commit your changes: git add . && git commit -m 'Prepare for deployment'"
    echo "2. Push to GitHub: git push origin main"
    echo "3. Deploy on Render using the render.yaml configuration"
    echo "4. Add AI API keys in Render environment variables (optional)"
    echo
    echo "📚 DEPLOYMENT COMMANDS:"
    echo "git add ."
    echo "git commit -m 'Ready for production deployment'"
    echo "git push origin main"
    echo
else
    print_error "VALIDATION FAILED with $validation_errors error(s)"
    echo
    print_info "Please fix the errors above before deploying"
    exit 1
fi

echo "✨ Validation completed successfully!" 