# 🚀 **How to Run Your Project with AI Code Review**

## 🎯 **Quick Start (3 steps)**

### **Step 1: Get FREE API Key (1 minute)**
1. Go to: https://aistudio.google.com/app/apikey
2. Sign in with Google
3. Click "Create API Key"
4. Copy the key

### **Step 2: Run Setup Script**
```bash
# Make script executable and run it
chmod +x setup-ai.sh
./setup-ai.sh
```

### **Step 3: Add Your API Key**
Edit the `.env` file that was created:
```env
# Replace with your actual key
GEMINI_API_KEY=your_actual_gemini_key_here
```

### **Step 4: Start the Project**
```bash
# Start everything (builds frontend + starts server)
npm start
```

## 🎉 **That's it!**

1. Open: `http://localhost:3000`
2. Create/join a room
3. Look for **"Show AI Review"** button in sidebar
4. Click it to see the AI panel
5. Write code and click **"🔍 Review Code"**

## 🐛 **If Something Goes Wrong**

### **"Show AI Review" button missing?**
```bash
# Check if AI service loaded
curl http://localhost:5000/api/status

# Should show: "aiCodeReview": true
```

### **Redis errors?**
```bash
# Start Redis with Docker
docker run -d --name redis -p 6379:6379 redis:alpine

# Or install locally:
# macOS: brew install redis && brew services start redis
# Ubuntu: sudo apt install redis-server
```

### **API errors?**
- ✅ Make sure you have a valid Gemini API key
- ✅ Check internet connection
- ✅ Verify the key at: https://aistudio.google.com/

## 📋 **Manual Setup (if script doesn't work)**

```bash
# 1. Install dependencies
npm install

# 2. Create .env file
echo "GEMINI_API_KEY=your_key_here" > .env

# 3. Start Redis
docker run -d -p 6379:6379 redis:alpine

# 4. Build and start
npm run build
npm start
```

## 🔧 **Development Mode**

```bash
# Start with auto-reload
npm run start:dev

# This starts:
# - Redis server
# - Node.js with auto-reload on file changes
```

## ✅ **Success Indicators**

When working correctly, you should see:

**Console output:**
```
✅ AI Code Review service loaded
🤖 Initializing AI Code Review service...
✅ AI Code Review routes loaded
🚀 Server running on port 5000
```

**Browser UI:**
- "Show AI Review" button in sidebar (green)
- When clicked: AI panel opens on right
- Panel header shows: "🆓 Gemini" or "🤖 AI Code Review"
- "🔍 Review Code" button works

## 🆓 **Why Gemini?**

- **Completely FREE**: 15 requests/minute, 1500/day
- **No credit card**: No billing setup needed
- **High quality**: Excellent code analysis
- **Easy setup**: Just get API key and go

## 💡 **Pro Tips**

1. **Test locally first** before deploying
2. **Use larger code blocks** for better analysis
3. **Try different analysis types** (bugs, security, style, etc.)
4. **Share reviews** with team members in real-time
5. **Comments system** for collaborative feedback

---

**🎯 Your AI-powered collaborative code editor is ready! Happy coding! 🤖** 