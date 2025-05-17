#!/bin/bash

echo "Starting Vercel build process..."

# Print environment info
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# List directory contents for debugging
echo "==== Directory Structure ===="
ls -la
echo "==== src directory ===="
ls -la src/
echo "==== components directory ===="
ls -la src/components/

# Fix potential case sensitivity issues
echo "Fixing potential case sensitivity issues..."
if [ -f "src/components/editor.js" ] && [ ! -f "src/components/Editor.js" ]; then
  echo "Renaming editor.js to Editor.js"
  cp src/components/editor.js src/components/Editor.js
fi

if [ -f "src/components/client.js" ] && [ ! -f "src/components/Client.js" ]; then
  echo "Renaming client.js to Client.js"
  cp src/components/client.js src/components/Client.js
fi

# Run the build
echo "Running npm build..."
npm run build

echo "Build process completed" 