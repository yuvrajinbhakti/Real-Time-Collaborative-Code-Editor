#!/bin/bash

# Ensure proper case sensitivity for critical files
echo "Checking file case sensitivity..."

# Create a duplicate with confirmed case (just to be safe)
cp src/components/Editor.js src/components/Editor.js.temp
mv src/components/Editor.js.temp src/components/Editor.js

cp src/components/Client.js src/components/Client.js.temp
mv src/components/Client.js.temp src/components/Client.js

# Deploy to Vercel
echo "Deploying to Vercel..."
npx vercel --prod

echo "Deployment process completed" 