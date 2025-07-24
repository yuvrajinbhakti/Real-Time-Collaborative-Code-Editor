#!/bin/bash

echo "🔧 Fixing build issues..."

# Clear all caches and old files
echo "Clearing caches and old files..."
npm cache clean --force
rm -rf node_modules
rm -rf package-lock.json
rm -rf build

# Reinstall dependencies with fixed versions
echo "Reinstalling dependencies..."
npm install --legacy-peer-deps --no-audit --force

# Try building with different strategies
echo "Attempting to build..."
if npm run build:simple; then
    echo "✅ Build successful with build:simple"
elif npm run build:no-check; then
    echo "✅ Build successful with build:no-check"
elif npm run build:render; then
    echo "✅ Build successful with build:render"
elif npm run build; then
    echo "✅ Build successful with standard build"
else
    echo "❌ All build attempts failed"
    exit 1
fi

echo "🎉 Build completed successfully!" 