# 🆓 **FREE AI Code Review with Google Gemini**

Get AI-powered code reviews **completely FREE** using Google's Gemini API!

## 🚀 **Quick Setup (2 minutes)**

### 1. **Get FREE Gemini API Key**
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the API key

### 2. **Configure Environment**
Create a `.env` file in your project root:

```env
# FREE Gemini API (Default)
GEMINI_API_KEY=your_gemini_api_key_here
AI_PROVIDER=gemini

# Redis (Required for real-time features)
REDIS_HOST=localhost
REDIS_PORT=6379

# Server Configuration  
PORT=5000
NODE_ENV=development
```

### 3. **Start Redis (Required)**
```bash
# Using Docker (Easiest)
docker run -d --name redis -p 6379:6379 redis:alpine

# Or install locally and start
redis-server
```

### 4. **Start the Application**
```bash
npm run start:enhanced
```

## 💰 **Cost Comparison**

### **Google Gemini (FREE)**
- ✅ **FREE**: 15 requests/minute, 1500 requests/day
- ✅ No credit card required
- ✅ High-quality AI analysis
- ✅ Multi-language support

### **OpenAI (Paid Alternative)**
- ❌ **Paid**: ~$0.0001-0.0005 per request
- ✅ Slightly more detailed responses
- ✅ Mature API

## 🔄 **Switch Between Providers**

You can easily switch or use both providers:

```env
# Use FREE Gemini (Default)
GEMINI_API_KEY=your_gemini_key
AI_PROVIDER=gemini

# Or use OpenAI (if you have credits)
OPENAI_API_KEY=your_openai_key  
AI_PROVIDER=openai

# Auto-detect (uses Gemini if available, falls back to OpenAI)
GEMINI_API_KEY=your_gemini_key
OPENAI_API_KEY=your_openai_key
# AI_PROVIDER not set = auto-detect
```

## 📈 **Gemini Free Tier Limits**
- **15 requests per minute** (more generous than our default rate limiting)
- **1,500 requests per day** (plenty for development and small teams)
- **No credit card required**
- **No billing setup needed**

## ✅ **Test Your Setup**
```bash
# Test the free Gemini integration
node test-ai-review.js --quick

# Check status
curl http://localhost:5000/api/ai-review/status
```

Expected response:
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "provider": "gemini",
    "isFree": true
  }
}
```

## 🎯 **Usage Tips for Free Tier**

1. **Batch Reviews**: Review larger code chunks instead of frequent small ones
2. **Smart Caching**: Our system caches results to minimize API calls
3. **Selective Analysis**: Choose only the analysis types you need
4. **Team Sharing**: One review benefits all room participants

## 🐛 **Troubleshooting**

### **"AI service not enabled"**
- ✅ Check `GEMINI_API_KEY` is set correctly
- ✅ Restart server after adding the key

### **"Rate limit exceeded"**
- ✅ You're hitting Google's 15 req/min limit
- ✅ Wait 1 minute and try again
- ✅ Consider batching smaller requests

### **API errors**
- ✅ Verify your API key at [Google AI Studio](https://aistudio.google.com/)
- ✅ Check internet connection
- ✅ Ensure the API key has proper permissions

## 🎉 **You're All Set!**

Your AI Code Review feature is now running **completely FREE** with Google Gemini! 

- Open your editor at `http://localhost:3000`
- Click "Show AI Review" 
- You'll see "🆓 Gemini" in the header
- Start getting intelligent code reviews at no cost!

## 💡 **Pro Tips**

1. **No Daily Worries**: 1,500 requests/day is generous for most use cases
2. **High Quality**: Gemini provides excellent code analysis comparable to paid services
3. **Future-Proof**: Google continues improving Gemini with better capabilities
4. **Team Friendly**: Perfect for student projects, open source, and small teams

---

**🆓 Happy FREE AI Code Reviews with Gemini! 🤖** 