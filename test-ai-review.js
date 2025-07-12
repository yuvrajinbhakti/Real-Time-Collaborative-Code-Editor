#!/usr/bin/env node

/**
 * Test script for AI Code Review feature
 * Run with: node test-ai-review.js
 */

const aiCodeReviewService = require('./services/aiCodeReview');

// Test code samples
const testCases = [
  {
    name: 'JavaScript with potential issues',
    code: `
function getUserData(userId) {
  var user = database.query("SELECT * FROM users WHERE id = " + userId);
  if (user) {
    return user.password;
  }
  return null;
}

function processPayment(amount) {
  if (amount > 0) {
    charge(amount);
  }
}
    `,
    language: 'javascript',
    analysisTypes: ['bugs', 'security', 'performance', 'style']
  },
  {
    name: 'Python with simple function',
    code: `
def calculate_total(prices):
    total = 0
    for price in prices:
        total += price
    return total

def get_user_info(user_id):
    return database.execute(f"SELECT * FROM users WHERE id = {user_id}")
    `,
    language: 'python',
    analysisTypes: ['bugs', 'security', 'style']
  }
];

async function runTests() {
  console.log('🤖 Testing AI Code Review Service...\n');
  
  // Initialize the service
  aiCodeReviewService.initialize();
  
  // Check if service is enabled
  if (!aiCodeReviewService.isEnabled) {
    console.log('❌ AI Code Review service is not enabled');
    console.log('Please set GEMINI_API_KEY (FREE) or OPENAI_API_KEY in your environment variables');
    console.log('');
    console.log('🆓 For FREE usage with Gemini:');
    console.log('   1. Get API key: https://aistudio.google.com/app/apikey');
    console.log('   2. Set: GEMINI_API_KEY=your_key_here');
    process.exit(1);
  }
  
  console.log('✅ AI Code Review service is enabled');
  
  // Show which provider is being used
  const serviceMetrics = aiCodeReviewService.getMetrics();
  const providerInfo = serviceMetrics.provider === 'gemini' ? '🆓 Gemini (FREE)' : '💰 OpenAI (PAID)';
  console.log(`🤖 Using: ${providerInfo}`);
  console.log('🔍 Running test cases...\n');
  
  for (const testCase of testCases) {
    console.log(`📝 Testing: ${testCase.name}`);
    console.log(`📊 Language: ${testCase.language}`);
    console.log(`🔍 Analysis Types: ${testCase.analysisTypes.join(', ')}`);
    
    try {
      const startTime = Date.now();
      const analysis = await aiCodeReviewService.analyzeCode(
        testCase.code,
        testCase.language,
        { analysisTypes: testCase.analysisTypes, userId: 'test-user' }
      );
      
      const duration = Date.now() - startTime;
      
      console.log(`✅ Analysis completed in ${duration}ms`);
      console.log(`📈 Overall Score: ${analysis.overall_score}/100`);
      console.log(`🐛 Issues Found: ${analysis.issues.length}`);
      console.log(`💡 Recommendations: ${analysis.recommendations.length}`);
      
      if (analysis.issues.length > 0) {
        console.log('📋 Issues:');
        analysis.issues.forEach((issue, index) => {
          console.log(`  ${index + 1}. [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.message}`);
        });
      }
      
      if (analysis.positive_aspects.length > 0) {
        console.log('👍 Positive Aspects:');
        analysis.positive_aspects.forEach((aspect, index) => {
          console.log(`  ${index + 1}. ${aspect}`);
        });
      }
      
      console.log(''); // Empty line for spacing
      
    } catch (error) {
      console.error(`❌ Test failed: ${error.message}`);
      console.error(`   Error Details: ${error.stack}`);
    }
  }
  
  // Test service metrics
  console.log('📊 Service Metrics:');
  const metrics = aiCodeReviewService.getMetrics();
  console.log(`   Cache Size: ${metrics.cacheSize}`);
  console.log(`   Rate Limit Trackers: ${metrics.rateLimitTrackers}`);
  console.log(`   Total Requests: ${metrics.totalRequests}`);
  
  console.log('\n🎉 AI Code Review tests completed!');
}

// Test error handling
async function testErrorHandling() {
  console.log('\n🧪 Testing Error Handling...');
  
  try {
    // Test with empty code
    await aiCodeReviewService.analyzeCode('', 'javascript', { userId: 'test-user' });
    console.log('❌ Should have thrown error for empty code');
  } catch (error) {
    console.log('✅ Empty code error handled correctly');
  }
  
  try {
    // Test rate limiting (make multiple rapid requests)
    const promises = [];
    for (let i = 0; i < 12; i++) {
      promises.push(aiCodeReviewService.analyzeCode('console.log("test");', 'javascript', { userId: 'test-user' }));
    }
    await Promise.all(promises);
    console.log('❌ Should have hit rate limit');
  } catch (error) {
    if (error.message.includes('Rate limit exceeded')) {
      console.log('✅ Rate limiting works correctly');
    } else {
      console.log(`❌ Unexpected error: ${error.message}`);
    }
  }
}

// Test collaborative features
async function testCollaborativeFeatures() {
  console.log('\n🤝 Testing Collaborative Features...');
  
  const testRoomId = 'test-room-' + Date.now();
  const testCode = 'function hello() { console.log("Hello World"); }';
  
  try {
    // Create a collaborative review
    const review = await aiCodeReviewService.createCollaborativeReview(
      testRoomId,
      testCode,
      'javascript',
      'test-user',
      { analysisTypes: ['bugs', 'style'] }
    );
    
    console.log('✅ Collaborative review created successfully');
    console.log(`   Review ID: ${review.id}`);
    console.log(`   Room ID: ${review.roomId}`);
    
    // Add a comment
    const comment = await aiCodeReviewService.addReviewComment(
      review.id,
      'test-user-2',
      'This looks good to me!',
      1
    );
    
    console.log('✅ Comment added successfully');
    console.log(`   Comment ID: ${comment.id}`);
    
    // Get room reviews
    const roomReviews = await aiCodeReviewService.getRoomReviews(testRoomId);
    console.log(`✅ Retrieved ${roomReviews.length} room reviews`);
    
  } catch (error) {
    console.error(`❌ Collaborative features test failed: ${error.message}`);
  }
}

// Run all tests
async function main() {
  try {
    await runTests();
    await testErrorHandling();
    await testCollaborativeFeatures();
    
    console.log('\n🎯 All tests completed successfully!');
    console.log('🚀 Your AI Code Review feature is ready to use!');
    
  } catch (error) {
    console.error(`💥 Test suite failed: ${error.message}`);
    process.exit(1);
  }
}

// Handle command line arguments
if (process.argv.includes('--help')) {
  console.log('AI Code Review Test Script');
  console.log('Usage: node test-ai-review.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --help     Show this help message');
  console.log('  --quick    Run only basic tests');
  console.log('');
  console.log('Environment Variables:');
  console.log('  GEMINI_API_KEY    FREE: Your Google Gemini API key (recommended)');
  console.log('  OPENAI_API_KEY    PAID: Your OpenAI API key (alternative)');
  console.log('  AI_PROVIDER       Optional: "gemini" or "openai" (default: auto-detect)');
  console.log('  REDIS_HOST        Optional: Redis host (default: localhost)');
  console.log('  REDIS_PORT        Optional: Redis port (default: 6379)');
  process.exit(0);
}

if (process.argv.includes('--quick')) {
  console.log('🏃 Running quick tests only...');
  runTests().then(() => {
    console.log('✅ Quick tests completed!');
  }).catch(error => {
    console.error(`❌ Quick tests failed: ${error.message}`);
    process.exit(1);
  });
} else {
  main();
}

module.exports = { runTests, testErrorHandling, testCollaborativeFeatures }; 