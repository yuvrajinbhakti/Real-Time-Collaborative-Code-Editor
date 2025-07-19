#!/usr/bin/env node

require('dotenv').config();

// Simple test for Gemini API with realistic code review
async function testGeminiAPI() {
    const API_KEY = process.env.GEMINI_API_KEY;

    if (!API_KEY) {
        console.error('❌ GEMINI_API_KEY not found in .env file');
        return;
    }

    console.log('🔍 Testing Gemini API...');
    console.log('API Key (first 10 chars):', API_KEY.substring(0, 10));

    const testCode = `
function buggyFunction(items) {
  var total = 0;
  for (var i = 0; i <= items.length; i++) {  // Bug: should be < not <=
    total += items[i].price;
  }
  eval("console.log('total: ' + total)");  // Security issue: eval
  return total;
}`;

    const prompt = `
You are an expert code reviewer. Please analyze this JavaScript code and provide a JSON response with issues found:

\`\`\`javascript
${testCode}
\`\`\`

Return your response in this exact JSON format:
{
  "overall_score": 45,
  "summary": "Code has critical bugs and security issues",
  "issues": [
    {
      "type": "bug",
      "severity": "high", 
      "line": 3,
      "message": "Array index out of bounds error",
      "suggestion": "Change <= to < in loop condition"
    },
    {
      "type": "security",
      "severity": "critical",
      "line": 6,
      "message": "Use of eval() is dangerous",
      "suggestion": "Use console.log directly instead of eval"
    }
  ],
  "positive_aspects": ["Function returns a value"],
  "recommendations": ["Avoid eval()", "Fix loop bounds", "Use const/let instead of var"]
}`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.1,
                    topK: 1,
                    topP: 1,
                    maxOutputTokens: 2048,
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('❌ Gemini API error:', error);
            return;
        }

        const data = await response.json();

        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
            console.error('❌ Invalid response structure:', data);
            return;
        }

        const aiResponse = data.candidates[0].content.parts[0].text;
        console.log('✅ Gemini API Response:');
        console.log('---RAW RESPONSE---');
        console.log(aiResponse);
        console.log('---END RESPONSE---');

        // Test our parsing logic
        let cleanedResponse = aiResponse;
        cleanedResponse = cleanedResponse.replace(/```json\s*/g, '');
        cleanedResponse = cleanedResponse.replace(/```\s*/g, '');

        const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            cleanedResponse = jsonMatch[0];
        }

        console.log('\n🔧 Cleaned Response:');
        console.log(cleanedResponse.substring(0, 300) + '...');

        try {
            const parsed = JSON.parse(cleanedResponse);
            console.log('\n✅ Successfully parsed JSON!');
            console.log('Issues found:', parsed.issues?.length || 0);
            console.log('Overall score:', parsed.overall_score);

            if (parsed.issues && parsed.issues.length > 0) {
                console.log('\n🐛 Issues detected:');
                parsed.issues.forEach((issue, i) => {
                    console.log(`${i + 1}. ${issue.type} (${issue.severity}): ${issue.message}`);
                });
                console.log('\n🎉 AI REVIEW IS WORKING! Issues are being detected properly.');
            } else {
                console.log('\n⚠️ No issues detected - this might indicate a problem');
            }

        } catch (parseError) {
            console.error('\n❌ JSON parsing failed:', parseError.message);
            console.log('This means our parsing logic needs improvement');
        }

    } catch (error) {
        console.error('❌ Network error:', error.message);
    }
}

// Add node-fetch if not available
try {
    global.fetch = require('node-fetch');
} catch (e) {
    console.log('Installing node-fetch...');
    require('child_process').execSync('npm install node-fetch@2', { stdio: 'inherit' });
    global.fetch = require('node-fetch');
}

testGeminiAPI(); 