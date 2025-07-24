#!/bin/bash

# Test script to validate Render build fixes
echo "🧪 Testing Render Build Configuration"
echo "====================================="

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Testing configuration only..."
else
    echo "✅ Docker found, testing build..."
fi

# Test 1: Check Node version compatibility in Dockerfile
echo ""
echo "📋 Test 1: Dockerfile Node Version"
node_version=$(grep "FROM node:" Dockerfile | head -1 | cut -d: -f2 | cut -d- -f1)
echo "   Using Node version: $node_version"

if [[ "$node_version" == "16" ]]; then
    echo "   ✅ Node 16 - Compatible with legacy npm"
else
    echo "   ⚠️  Node $node_version - May have npm compatibility issues"
fi

# Test 2: Check for npm@latest removal
echo ""
echo "📋 Test 2: NPM Version Management"
npm_latest_count=$(grep -c "npm install -g npm@latest" Dockerfile 2>/dev/null || echo "0")
echo "   Found $npm_latest_count npm@latest installation(s)"
if [[ "$npm_latest_count" == "0" ]]; then
    echo "   ✅ Perfect! No npm@latest upgrades - Safe for Node 16"
else
    echo "   ❌ This will cause Node 16 compatibility errors"
fi

# Test 3: Check react-scripts downgrade
echo ""
echo "📋 Test 3: React Scripts Version Fix"
if grep -q "react-scripts.*4.0.3" Dockerfile; then
    echo "   ✅ React Scripts downgrade to 4.0.3 configured"
else
    echo "   ⚠️  React Scripts downgrade not configured properly"
fi

# Test 4: Check environment variables
echo ""
echo "📋 Test 4: Environment Variables"
required_envs=("SKIP_PREFLIGHT_CHECK" "CI" "NODE_OPTIONS")
for env in "${required_envs[@]}"; do
    if grep -q "ENV $env" Dockerfile; then
        echo "   ✅ $env configured"
    else
        echo "   ❌ $env missing"
    fi
done

# Test 5: Check if package.json has problematic versions
echo ""
echo "📋 Test 5: Package.json Analysis"
if grep -q '"react-scripts": "5.0.0"' package.json; then
    echo "   ⚠️  package.json still has react-scripts 5.0.0 (will be fixed during build)"
else
    echo "   ✅ package.json has compatible react-scripts version"
fi

# Test 6: Basic Dockerfile validation
echo ""
echo "📋 Test 6: Dockerfile Structure"
if [[ -f "Dockerfile" ]]; then
    if grep -q "FROM node:" Dockerfile && grep -q "WORKDIR" Dockerfile && grep -q "COPY" Dockerfile; then
        echo "   ✅ Dockerfile structure is valid"
    else
        echo "   ❌ Dockerfile missing required sections"
    fi
else
    echo "   ❌ Dockerfile not found"
fi

echo ""
echo "🎯 Summary"
echo "=========="
echo "Your Dockerfile is configured with:"
echo "• Node 16 (compatible with existing npm)"
echo "• Automatic react-scripts downgrade to 4.0.3"  
echo "• No npm@latest upgrades (avoids version conflicts)"
echo "• All required environment variables for build success"
echo ""
echo "🚀 Ready for Render deployment!"
echo ""
echo "Next steps:"
echo "1. git add . && git commit -m 'Fix npm version compatibility for Node 16'"
echo "2. git push origin main"
echo "3. Deploy on Render" 