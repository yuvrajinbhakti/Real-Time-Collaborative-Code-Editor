#!/bin/bash

# Debug Docker Build Script
# This script helps diagnose Docker build issues with verbose output

echo "🔍 Starting Docker build with debug output..."
echo "📁 Working directory: $(pwd)"
echo "🐳 Docker version: $(docker --version)"
echo "📦 Node version in container will be: node:20-alpine"

echo ""
echo "🧹 Cleaning up any previous builds..."
docker system prune -f > /dev/null 2>&1

echo ""
echo "🏗️ Building Docker image with verbose output..."
echo "   Image name: collab-editor-debug"
echo "   Build context: ."

# Build with progress output and no cache to see all steps
docker build \
    --no-cache \
    --progress=plain \
    --tag collab-editor-debug \
    . 2>&1 | tee docker-build.log

# Check build result
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Docker build completed successfully!"
    echo "🏷️  Image: collab-editor-debug"
    echo "📊 Image size: $(docker images collab-editor-debug --format "table {{.Size}}" | tail -n1)"
    echo ""
    echo "🚀 To run the container:"
    echo "   docker run -p 5000:5000 collab-editor-debug"
else
    echo ""
    echo "❌ Docker build failed!"
    echo "📄 Check docker-build.log for detailed error information"
    echo "🔍 Last 20 lines of build log:"
    tail -20 docker-build.log
fi 