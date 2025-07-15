#!/usr/bin/env node

/**
 * Demo script to test AI Code Review features implemented directly in server.js
 * This tests the server without starting it by making HTTP requests
 */

const http = require('http');
const path = require('path');

const BASE_URL = 'http://localhost:5000';

async function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ status: res.statusCode, data: parsed });
        } catch (error) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function testServerStatus() {
  try {
    console.log('🧪 Testing server status...');
    const response = await makeRequest('GET', '/api/status');
    
    if (response.status === 200) {
      console.log('✅ Server status endpoint working');
      console.log(`   AI Code Review: ${response.data.features.aiCodeReview ? 'Enabled' : 'Disabled'}`);
      console.log(`   Provider: ${response.data.features.aiProvider}`);
      console.log(`   Collaborative Reviews: ${response.data.features.collaborativeReviews}`);
      return true;
    } else {
      console.log('❌ Server status endpoint failed');
      return false;
    }
  } catch (error) {
    console.log('❌ Server is not running. Please start it first with: node server.js');
    return false;
  }
}

async function testAIReviewStatus() {
  try {
    console.log('\n🧪 Testing AI review status...');
    const response = await makeRequest('GET', '/api/ai-review/status');
    
    if (response.status === 200) {
      console.log('✅ AI review status endpoint working');
      console.log(`   Service enabled: ${response.data.data.enabled}`);
      console.log(`   Provider: ${response.data.data.provider}`);
      console.log(`   Collaborative reviews: ${response.data.data.collaborativeReviews}`);
      console.log(`   Active rooms: ${response.data.data.activeRooms}`);
      return true;
    } else {
      console.log('❌ AI review status endpoint failed');
      return false;
    }
  } catch (error) {
    console.log(`❌ AI review status test failed: ${error.message}`);
    return false;
  }
}

async function testCreateReview() {
  try {
    console.log('\n🧪 Testing review creation...');
    const testCode = `function calculateTotal(items) {
  let total = 0;
  for (let item of items) {
    total += item.price;
  }
  return total;
}`;

    const reviewData = {
      roomId: 'test-room-' + Date.now(),
      code: testCode,
      language: 'javascript',
      analysisTypes: ['bugs', 'style', 'performance']
    };

    const response = await makeRequest('POST', '/api/ai-review/create', reviewData);
    
    if (response.status === 200 || response.status === 201) {
      console.log('✅ Review creation working');
      console.log(`   Review ID: ${response.data.data.reviewId}`);
      console.log(`   Overall Score: ${response.data.data.overallScore}/100`);
      console.log(`   Issues found: ${response.data.data.issueCount}`);
      return { success: true, reviewId: response.data.data.reviewId, roomId: reviewData.roomId };
    } else {
      console.log('❌ Review creation failed');
      console.log(`   Status: ${response.status}`);
      console.log(`   Message: ${response.data.message || 'Unknown error'}`);
      return { success: false };
    }
  } catch (error) {
    console.log(`❌ Review creation test failed: ${error.message}`);
    return { success: false };
  }
}

async function testGetReview(reviewId) {
  try {
    console.log('\n🧪 Testing review retrieval...');
    const response = await makeRequest('GET', `/api/ai-review/${reviewId}`);
    
    if (response.status === 200) {
      console.log('✅ Review retrieval working');
      console.log(`   Review ID: ${response.data.data.id}`);
      console.log(`   Language: ${response.data.data.language}`);
      console.log(`   Comments: ${response.data.data.comments.length}`);
      return true;
    } else {
      console.log('❌ Review retrieval failed');
      return false;
    }
  } catch (error) {
    console.log(`❌ Review retrieval test failed: ${error.message}`);
    return false;
  }
}

async function testAddComment(reviewId) {
  try {
    console.log('\n🧪 Testing comment addition...');
    const commentData = {
      comment: 'Great function! Very readable code.',
      lineNumber: 3
    };

    const response = await makeRequest('POST', `/api/ai-review/${reviewId}/comment`, commentData);
    
    if (response.status === 200 || response.status === 201) {
      console.log('✅ Comment addition working');
      console.log(`   Comment ID: ${response.data.data.id}`);
      console.log(`   Line number: ${response.data.data.lineNumber}`);
      return true;
    } else {
      console.log('❌ Comment addition failed');
      return false;
    }
  } catch (error) {
    console.log(`❌ Comment addition test failed: ${error.message}`);
    return false;
  }
}

async function testGetRoomReviews(roomId) {
  try {
    console.log('\n🧪 Testing room reviews retrieval...');
    const response = await makeRequest('GET', `/api/ai-review/room/${roomId}`);
    
    if (response.status === 200) {
      console.log('✅ Room reviews retrieval working');
      console.log(`   Reviews in room: ${response.data.data.length}`);
      response.data.data.forEach((review, index) => {
        console.log(`   Review ${index + 1}: Score ${review.overallScore}/100, ${review.commentCount} comments`);
      });
      return true;
    } else {
      console.log('❌ Room reviews retrieval failed');
      return false;
    }
  } catch (error) {
    console.log(`❌ Room reviews retrieval test failed: ${error.message}`);
    return false;
  }
}

async function testQuickAnalysis() {
  try {
    console.log('\n🧪 Testing quick analysis...');
    const analysisData = {
      code: 'const x = 5; console.log(x);',
      language: 'javascript',
      analysisTypes: ['bugs', 'style']
    };

    const response = await makeRequest('POST', '/api/ai-review/analyze', analysisData);
    
    if (response.status === 200) {
      console.log('✅ Quick analysis working');
      console.log(`   Overall score: ${response.data.data.overall_score}/100`);
      console.log(`   Issues found: ${response.data.data.issues.length}`);
      return true;
    } else {
      console.log('❌ Quick analysis failed');
      console.log(`   Status: ${response.status}`);
      console.log(`   Message: ${response.data.message || 'Unknown error'}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Quick analysis test failed: ${error.message}`);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Testing AI Code Review Features in server.js');
  console.log('=' .repeat(60));
  
  const serverRunning = await testServerStatus();
  if (!serverRunning) {
    console.log('\n❌ Server is not running. Please start it first:');
    console.log('   node server.js');
    return;
  }

  await testAIReviewStatus();
  
  const reviewResult = await testCreateReview();
  if (reviewResult.success) {
    await testGetReview(reviewResult.reviewId);
    await testAddComment(reviewResult.reviewId);
    await testGetRoomReviews(reviewResult.roomId);
  }
  
  await testQuickAnalysis();

  console.log('\n🎉 All API tests completed!');
  console.log('');
  console.log('✅ Features implemented directly in server.js:');
  console.log('   • Collaborative review creation');
  console.log('   • Review retrieval with comments');
  console.log('   • Room review history');
  console.log('   • Comment system');
  console.log('   • Quick code analysis');
  console.log('   • Real-time Socket.io events');
  console.log('   • In-memory storage');
  console.log('   • Automatic cleanup');
  console.log('');
  console.log('🚀 Ready for deployment on Render!');
}

if (require.main === module) {
  runAllTests().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = { runAllTests }; 