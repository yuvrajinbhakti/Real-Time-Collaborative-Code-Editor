#!/bin/bash

echo "🤖 Setting up AI Code Review Feature..."
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOL
# AI Configuration (Choose one)
# FREE Gemini API (Recommended)
GEMINI_API_KEY=your_gemini_api_key_here
AI_PROVIDER=gemini

# OR Paid OpenAI API
# OPENAI_API_KEY=your_openai_api_key_here
# AI_PROVIDER=openai

# Redis Configuration (Required for real-time features)
REDIS_HOST=localhost
REDIS_PORT=6379

# Server Configuration
PORT=5000
NODE_ENV=development

# Feature Flags
ENABLE_AI_CODE_REVIEW=true
EOL
    echo "✅ Created .env file"
    echo "⚠️  Please edit .env and add your actual API key!"
else
    echo "✅ .env file already exists"
fi

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Check if Redis is running
echo ""
echo "🔍 Checking Redis..."
if redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis is running"
else
    echo "❌ Redis is not running"
    echo "🚀 Starting Redis with Docker..."
    docker run -d --name redis-ai -p 6379:6379 redis:alpine
    sleep 2
    if redis-cli ping > /dev/null 2>&1; then
        echo "✅ Redis started successfully"
    else
        echo "❌ Failed to start Redis"
        echo "Please install Redis manually:"
        echo "  macOS: brew install redis && brew services start redis"
        echo "  Ubuntu: sudo apt-get install redis-server"
        echo "  Or use Docker: docker run -d -p 6379:6379 redis:alpine"
    fi
fi

# Build the project
echo ""
echo "🔨 Building the project..."
npm run build

# Test the setup
echo ""
echo "🧪 Testing AI service..."
if [ -f test-ai-review.js ]; then
    node test-ai-review.js --quick
else
    echo "⚠️ Test file not found, skipping test"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Edit .env file and add your API key:"
echo "   - FREE: Get Gemini key from https://aistudio.google.com/app/apikey"
echo "   - PAID: Get OpenAI key from https://platform.openai.com/api-keys"
echo ""
echo "2. Start the server:"
echo "   npm start"
echo ""
echo "3. Open your browser:"
echo "   http://localhost:3000"
echo ""
echo "4. Look for 'Show AI Review' button in the sidebar!"
echo "" 