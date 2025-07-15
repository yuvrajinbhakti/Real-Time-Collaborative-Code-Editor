# 🤖 AI Code Review API Documentation

## Overview
The AI Code Review feature provides intelligent code analysis using Google Gemini (FREE) or OpenAI APIs. It supports real-time collaborative reviews with comments and sharing.

## 🚀 Quick Setup

### 1. Get FREE API Key
1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with Google account
3. Click "Create API Key"
4. Copy the generated key

### 2. Environment Configuration
```env
# FREE Gemini API (Recommended)
GEMINI_API_KEY=your_gemini_api_key_here
AI_PROVIDER=gemini

# Alternative: Paid OpenAI API
OPENAI_API_KEY=your_openai_api_key_here
AI_PROVIDER=openai

# Redis (Required for enhanced features)
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 3. Start the Application
```bash
# Install dependencies
npm install

# Start Redis (if not running)
docker run -d --name redis -p 6379:6379 redis:alpine

# Start the application
npm start
```

## 📡 API Endpoints

### 1. Create AI Review
**POST** `/api/ai-review/create`

Creates a new collaborative AI code review.

**Request Body:**
```json
{
  "roomId": "room-123",
  "code": "function hello() { console.log('Hello World'); }",
  "language": "javascript",
  "analysisTypes": ["bugs", "security", "performance", "style", "maintainability"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "reviewId": "review_1234567890_abc123def",
    "summary": "Overall good code quality with minor style improvements needed",
    "overallScore": 85,
    "issueCount": 2,
    "analysis": {
      "overall_score": 85,
      "summary": "Well-structured function with clear intent",
      "issues": [...],
      "positive_aspects": [...],
      "recommendations": [...],
      "complexity_analysis": {...}
    }
  }
}
```

**Real-time Event Emitted:**
```javascript
socket.emit('ai_review_created', {
  reviewId: "review_1234567890_abc123def",
  authorId: "user123",
  summary: "Overall good code quality...",
  overallScore: 85,
  issueCount: 2,
  language: "javascript",
  created_at: "2024-01-15T10:30:00.000Z"
});
```

### 2. Get Specific Review
**GET** `/api/ai-review/:reviewId`

Retrieves a specific review with all comments.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "review_1234567890_abc123def",
    "roomId": "room-123",
    "authorId": "user123",
    "code": "function hello() { ... }",
    "language": "javascript",
    "analysis": {...},
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T10:35:00.000Z",
    "comments": [
      {
        "id": "comment_1234567890_xyz789",
        "reviewId": "review_1234567890_abc123def",
        "userId": "user456",
        "comment": "Great function structure!",
        "lineNumber": 1,
        "timestamp": "2024-01-15T10:32:00.000Z"
      }
    ]
  }
}
```

### 3. Get Room Reviews
**GET** `/api/ai-review/room/:roomId?limit=10`

Retrieves all reviews for a specific room.

**Query Parameters:**
- `limit` (optional): Maximum number of reviews to return (default: 10)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "review_1234567890_abc123def",
      "authorId": "user123",
      "summary": "Well-structured function...",
      "overallScore": 85,
      "issueCount": 2,
      "language": "javascript",
      "created_at": "2024-01-15T10:30:00.000Z",
      "commentCount": 3
    }
  ]
}
```

### 4. Add Comment to Review
**POST** `/api/ai-review/:reviewId/comment`

Adds a comment to a specific review.

**Request Body:**
```json
{
  "comment": "This function could be optimized further",
  "lineNumber": 5
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "comment_1234567890_xyz789",
    "reviewId": "review_1234567890_abc123def",
    "userId": "user456",
    "comment": "This function could be optimized further",
    "lineNumber": 5,
    "timestamp": "2024-01-15T10:35:00.000Z"
  }
}
```

**Real-time Event Emitted:**
```javascript
socket.emit('review_comment_added', {
  reviewId: "review_1234567890_abc123def",
  comment: {
    id: "comment_1234567890_xyz789",
    userId: "user456",
    comment: "This function could be optimized further",
    lineNumber: 5,
    timestamp: "2024-01-15T10:35:00.000Z"
  },
  authorId: "user456"
});
```

### 5. Quick Code Analysis
**POST** `/api/ai-review/analyze`

Performs quick code analysis without storing results.

**Request Body:**
```json
{
  "code": "const x = 5; console.log(x);",
  "language": "javascript",
  "analysisTypes": ["bugs", "style"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "overall_score": 90,
    "summary": "Simple variable declaration and logging",
    "issues": [],
    "positive_aspects": ["Clear variable naming", "Simple logic"],
    "recommendations": ["Consider using more descriptive variable names"],
    "complexity_analysis": {
      "cyclomatic_complexity": "1",
      "maintainability_index": "90",
      "technical_debt": "low"
    },
    "metadata": {
      "language": "javascript",
      "analyzed_at": "2024-01-15T10:30:00.000Z",
      "code_length": 29,
      "line_count": 1
    }
  }
}
```

### 6. Get Service Status
**GET** `/api/ai-review/status`

Returns the current status of the AI service.

**Response:**
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "provider": "gemini",
    "isFree": true,
    "cacheSize": 25,
    "activeUsers": 5,
    "totalRequests": 150,
    "collaborativeReviews": 12,
    "activeRooms": 3,
    "totalComments": 45
  }
}
```

### 7. Batch Analysis (Authenticated Users Only)
**POST** `/api/ai-review/batch-analyze`

Analyzes multiple code snippets in a single request.

**Request Body:**
```json
{
  "codeSnippets": [
    {
      "id": "snippet1",
      "code": "function add(a, b) { return a + b; }",
      "language": "javascript",
      "analysisTypes": ["bugs", "style"]
    },
    {
      "id": "snippet2", 
      "code": "def multiply(x, y): return x * y",
      "language": "python",
      "analysisTypes": ["style", "maintainability"]
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "snippet1",
      "analysis": {
        "summary": "Well-structured function",
        "overallScore": 95,
        "issueCount": 0,
        "criticalIssues": 0
      }
    },
    {
      "id": "snippet2",
      "analysis": {
        "summary": "Simple function with good structure", 
        "overallScore": 90,
        "issueCount": 1,
        "criticalIssues": 0
      }
    }
  ]
}
```

## 🎯 Analysis Types

| Type | Description | Examples |
|------|-------------|----------|
| `bugs` | Code errors and potential bugs | Null pointer exceptions, logic errors |
| `security` | Security vulnerabilities | SQL injection, XSS, unsafe operations |
| `performance` | Performance improvements | Algorithm efficiency, memory usage |
| `style` | Code style and formatting | Naming conventions, indentation |
| `maintainability` | Code maintainability | Complexity, readability, modularity |
| `complexity` | Code complexity analysis | Cyclomatic complexity, nesting depth |
| `documentation` | Documentation quality | Comments, function descriptions |

## 🔒 Rate Limits

| Provider | Requests per Minute | Daily Limit | Cost |
|----------|-------------------|-------------|------|
| Gemini (FREE) | 15 | 1,500 | FREE |
| OpenAI (PAID) | 10 | Unlimited* | ~$0.0001-0.0005 per request |

*Subject to your OpenAI billing limits

## 🌐 Real-time Events

The AI Review feature emits the following Socket.io events:

### `ai_review_created`
Emitted when a new review is created in a room.
```javascript
socket.on('ai_review_created', (data) => {
  console.log('New review:', data.reviewId);
  // Refresh reviews list
});
```

### `review_comment_added`
Emitted when a comment is added to a review.
```javascript
socket.on('review_comment_added', (data) => {
  console.log('New comment on review:', data.reviewId);
  // Update review display
});
```

## 🛠️ Error Handling

### Common Error Responses

**Rate Limit Exceeded (429):**
```json
{
  "success": false,
  "message": "Rate limit exceeded for Gemini (FREE). Please wait before requesting another review."
}
```

**Service Unavailable (503):**
```json
{
  "success": false, 
  "message": "AI Code Review service is currently unavailable"
}
```

**Code Too Large (400):**
```json
{
  "success": false,
  "message": "Code too large. Maximum 50,000 characters allowed."
}
```

**Review Not Found (404):**
```json
{
  "success": false,
  "message": "Review not found"
}
```

## 🧪 Testing

Run the comprehensive test suite:
```bash
# Full test suite
node test-ai-review.js

# Quick tests only
node test-ai-review.js --quick

# Check test help
node test-ai-review.js --help
```

## 📈 Monitoring

The service includes automatic cleanup and monitoring:
- Reviews older than 24 hours are automatically cleaned up
- Rate limiting prevents abuse
- Comprehensive metrics available via `/api/ai-review/status`
- Memory usage is monitored and optimized

## 💡 Best Practices

1. **Code Size**: Keep code snippets under 10KB for optimal performance
2. **Analysis Types**: Select specific analysis types for faster results
3. **Caching**: Identical code analysis results are cached for 1 hour
4. **Real-time**: Use Socket.io events for collaborative features
5. **Error Handling**: Always handle rate limiting and service unavailability

---

🎯 **Your AI-powered collaborative code review system is now fully functional!** 🚀 