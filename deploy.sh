#!/bin/bash

# Make sure Vercel CLI is installed
if ! command -v vercel &> /dev/null
then
    echo "Vercel CLI not found, installing it globally..."
    npm install -g vercel
fi

# Build the project
npm run build

# Deploy to Vercel
echo "Deploying to Vercel..."
vercel --prod

echo "Deployment complete!" 