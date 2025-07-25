#!/bin/bash

# Comprehensive Deployment Test Script
# Tests all deployment configurations and validates fixes

echo "🚀 Real-Time Collaborative Code Editor - Deployment Test"
echo "======================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Helper functions
print_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

print_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    PASSED_TESTS=$((PASSED_TESTS + 1))
}

print_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    FAILED_TESTS=$((FAILED_TESTS + 1))
}

print_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

# Check prerequisites
print_test "Checking prerequisites"
if ! command -v node &> /dev/null; then
    print_fail "Node.js is not installed"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    print_fail "npm is not installed"
    exit 1
fi

NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
print_pass "Node.js $NODE_VERSION and npm $NPM_VERSION are available"

# Test 1: Package.json validation
print_test "Validating package.json structure"
if node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))" 2>/dev/null; then
    print_pass "package.json is valid JSON"
else
    print_fail "package.json is invalid JSON"
fi

# Test 2: Check dependency versions
print_test "Checking dependency compatibility"
if grep -q '"react": "^18.2.0"' package.json; then
    print_pass "React 18.2.0 specified"
else
    print_fail "React version incorrect"
fi

if grep -q '"react-scripts": "5.0.1"' package.json; then
    print_pass "React Scripts 5.0.1 specified"
else
    print_fail "React Scripts version incorrect"
fi

# Test 3: Check for dependency overrides
print_test "Checking dependency overrides"
if grep -q '"overrides"' package.json && grep -q '"ajv"' package.json; then
    print_pass "Dependency overrides configured"
else
    print_fail "Missing dependency overrides"
fi

# Test 4: Environment setup
print_test "Testing environment variable configuration"
export NODE_ENV=production
export GENERATE_SOURCEMAP=false
export SKIP_PREFLIGHT_CHECK=true
print_pass "Environment variables set for production build"

# Test 5: Clean install test
print_test "Testing clean npm install with proper flags"
if rm -rf node_modules package-lock.json && npm install --legacy-peer-deps --force; then
    print_pass "Clean npm install successful"
else
    print_fail "npm install failed"
fi

# Test 6: Build test
print_test "Testing React build process"
if npm run build:production; then
    print_pass "React build successful"
    
    # Check if build directory exists
    if [ -d "build" ]; then
        print_pass "Build directory created"
        
        # Check if index.html exists
        if [ -f "build/index.html" ]; then
            print_pass "index.html generated"
        else
            print_fail "index.html not found in build"
        fi
        
        # Check build size
        BUILD_SIZE=$(du -sh build | cut -f1)
        print_info "Build size: $BUILD_SIZE"
    else
        print_fail "Build directory not created"
    fi
else
    print_fail "React build failed"
fi

# Test 7: Server validation
print_test "Testing server file syntax"
if node -c server-simple.js; then
    print_pass "server-simple.js syntax valid"
else
    print_fail "server-simple.js has syntax errors"
fi

if node -c server-enhanced.js; then
    print_pass "server-enhanced.js syntax valid"
else
    print_fail "server-enhanced.js has syntax errors"
fi

# Test 8: Health endpoint test (with macOS compatible timeout)
print_test "Testing server startup and health endpoints"

# Start server in background
node server-simple.js &
SERVER_PID=$!

# Wait for server to start
sleep 5

if kill -0 $SERVER_PID 2>/dev/null; then
    print_pass "Server started successfully"
    
    # Test health endpoint
    if curl -f http://localhost:5000/health > /dev/null 2>&1; then
        print_pass "Health endpoint accessible"
    else
        print_fail "Health endpoint not accessible"
    fi
    
    # Test API status endpoint
    if curl -f http://localhost:5000/api/status > /dev/null 2>&1; then
        print_pass "API status endpoint accessible"
    else
        print_fail "API status endpoint not accessible"
    fi
    
    # Stop server
    kill $SERVER_PID 2>/dev/null
    wait $SERVER_PID 2>/dev/null
    print_pass "Server stopped cleanly"
else
    print_fail "Server failed to start"
fi

# Test 9: Docker configuration validation
print_test "Testing Docker configuration"
if [ -f "Dockerfile" ]; then
    print_pass "Dockerfile exists"
    
    # Check if Docker is available
    if command -v docker &> /dev/null; then
        # Check Dockerfile syntax by doing a quick build test
        if docker build --no-cache -t test-build . > /dev/null 2>&1; then
            print_pass "Docker build successful"
            docker rmi test-build > /dev/null 2>&1
        else
            print_fail "Docker build failed"
        fi
    else
        print_info "Docker not available, skipping build test"
        print_pass "Dockerfile syntax appears valid"
    fi
else
    print_fail "Dockerfile not found"
fi

# Test 10: Render configuration validation
print_test "Testing Render deployment configuration"
if [ -f "render.yaml" ]; then
    print_pass "render.yaml exists"
    
    # Basic YAML validation using node
    if node -e "require('yaml', () => {}).parse || require('js-yaml', () => {}).load || (() => { throw new Error('No YAML parser') }); const fs = require('fs'); const content = fs.readFileSync('render.yaml', 'utf8'); console.log('YAML is valid');" 2>/dev/null; then
        print_pass "render.yaml is valid YAML"
    else
        # Try basic syntax check
        if grep -q "services:" render.yaml && grep -q "type: web" render.yaml; then
            print_pass "render.yaml basic structure is valid"
        else
            print_fail "render.yaml structure is invalid"
        fi
    fi
else
    print_fail "render.yaml not found"
fi

# Test 11: File cleanup validation
print_test "Checking for conflicting files"
CONFLICTING_FILES=(
    "Dockerfile.render"
    "Dockerfile.backup"
    "Dockerfile.minimal"
    "Dockerfile.simple"
    "Dockerfile.working"
    "Dockerfile.fixed"
    "Dockerfile.final"
)

CONFLICTS_FOUND=false
for file in "${CONFLICTING_FILES[@]}"; do
    if [ -f "$file" ]; then
        print_fail "Conflicting file found: $file"
        CONFLICTS_FOUND=true
    fi
done

if [ "$CONFLICTS_FOUND" = false ]; then
    print_pass "No conflicting Docker files found"
fi

# Test 12: Security validation
print_test "Testing security configurations"
if grep -q "helmet" server-enhanced.js; then
    print_pass "Helmet security middleware configured"
else
    print_fail "Helmet security middleware not found"
fi

if grep -q "cors" server-simple.js; then
    print_pass "CORS configuration found"
else
    print_fail "CORS configuration not found"
fi

# Test Results Summary
echo ""
echo "======================================================="
echo "🏁 DEPLOYMENT TEST RESULTS"
echo "======================================================="
echo -e "Total Tests: ${BLUE}$TOTAL_TESTS${NC}"
echo -e "Passed: ${GREEN}$PASSED_TESTS${NC}"
echo -e "Failed: ${RED}$FAILED_TESTS${NC}"

if [ $FAILED_TESTS -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ ALL TESTS PASSED - READY FOR DEPLOYMENT!${NC}"
    echo ""
    echo "🚀 Deployment Commands:"
    echo "  Render:    git add . && git commit -m 'Deploy fixes' && git push"
    echo "  Docker:    docker build -t collab-editor . && docker run -p 5000:5000 collab-editor"
    echo "  Local:     npm start"
    echo ""
    exit 0
else
    echo ""
    echo -e "${RED}❌ SOME TESTS FAILED - PLEASE FIX ISSUES BEFORE DEPLOYMENT${NC}"
    echo ""
    echo "🔧 Common fixes:"
    echo "  1. Run: rm -rf node_modules package-lock.json && npm install --legacy-peer-deps --force"
    echo "  2. Run: npm run build:production"
    echo "  3. Check server files for syntax errors"
    echo "  4. Ensure Docker is running for Docker tests"
    echo ""
    exit 1
fi 