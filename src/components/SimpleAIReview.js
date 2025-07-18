import React, { useState } from 'react';
import toast from 'react-hot-toast';

const SimpleAIReview = ({ roomId, currentCode, language = 'javascript' }) => {
    const [review, setReview] = useState(null);
    const [loading, setLoading] = useState(false);

    // Simple: Click review → API call → Show results
    const reviewCode = async () => {
        if (!currentCode || currentCode.trim().length === 0) {
            toast.error('No code to review');
            return;
        }

        try {
            setLoading(true);
            setReview(null);

            const response = await fetch('/api/ai-review/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    roomId,
                    code: currentCode,
                    language,
                    analysisTypes: ['bugs', 'security', 'performance', 'style', 'maintainability']
                })
            });

            const data = await response.json();

            if (data.success) {
                setReview(data.data.analysis);
                toast.success('Code reviewed successfully!');
            } else {
                toast.error(data.message || 'Review failed');
            }
        } catch (error) {
            console.error('Review failed:', error);
            toast.error('Failed to review code');
        } finally {
            setLoading(false);
        }
    };

    const getSeverityColor = (severity) => {
        switch (severity) {
            case 'critical': return '#ff4757';
            case 'high': return '#ff6b6b';
            case 'medium': return '#ffa502';
            case 'low': return '#26de81';
            default: return '#747d8c';
        }
    };

    return (
        <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#1e1e1e',
            color: 'white',
            padding: '16px'
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                borderBottom: '1px solid #333',
                paddingBottom: '12px'
            }}>
                <h3 style={{ margin: 0, fontSize: '18px' }}>🤖 AI Code Review</h3>
                <button
                    onClick={reviewCode}
                    disabled={loading}
                    style={{
                        backgroundColor: loading ? '#555' : '#4CAF50',
                        color: 'white',
                        border: 'none',
                        padding: '8px 16px',
                        borderRadius: '4px',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        fontSize: '14px'
                    }}
                >
                    {loading ? '🔄 Analyzing...' : '🔍 Review Code'}
                </button>
            </div>

            {/* Results */}
            <div style={{ flex: 1, overflow: 'auto' }}>
                {loading && (
                    <div style={{
                        textAlign: 'center',
                        padding: '40px',
                        color: '#888'
                    }}>
                        <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔄</div>
                        <div>Analyzing your code...</div>
                    </div>
                )}

                {!loading && !review && (
                    <div style={{
                        textAlign: 'center',
                        padding: '40px',
                        color: '#888'
                    }}>
                        <div style={{ fontSize: '24px', marginBottom: '8px' }}>🤖</div>
                        <div>Click "Review Code" to get AI feedback</div>
                    </div>
                )}

                {review && (
                    <div>
                        {/* Score */}
                        <div style={{
                            backgroundColor: '#2a2a2a',
                            padding: '16px',
                            borderRadius: '8px',
                            marginBottom: '16px'
                        }}>
                            <div style={{
                                fontSize: '24px',
                                fontWeight: 'bold',
                                marginBottom: '8px'
                            }}>
                                Score: {review.overall_score}/100
                            </div>
                            <div style={{ color: '#bbb' }}>
                                {review.summary}
                            </div>
                        </div>

                        {/* Issues */}
                        {review.issues && review.issues.length > 0 && (
                            <div style={{ marginBottom: '16px' }}>
                                <h4 style={{
                                    fontSize: '16px',
                                    marginBottom: '12px',
                                    color: '#ff6b6b'
                                }}>
                                    🔍 Issues Found ({review.issues.length})
                                </h4>
                                {review.issues.map((issue, index) => (
                                    <div key={index} style={{
                                        backgroundColor: '#2a2a2a',
                                        padding: '12px',
                                        borderRadius: '6px',
                                        marginBottom: '8px',
                                        borderLeft: `4px solid ${getSeverityColor(issue.severity)}`
                                    }}>
                                        <div style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            marginBottom: '4px'
                                        }}>
                                            <span style={{ fontWeight: 'bold' }}>
                                                {issue.type}
                                            </span>
                                            <span style={{
                                                backgroundColor: getSeverityColor(issue.severity),
                                                color: 'white',
                                                padding: '2px 8px',
                                                borderRadius: '12px',
                                                fontSize: '12px'
                                            }}>
                                                {issue.severity}
                                            </span>
                                        </div>
                                        <div style={{ marginBottom: '4px' }}>
                                            Line {issue.line}: {issue.message}
                                        </div>
                                        {issue.suggestion && (
                                            <div style={{
                                                color: '#4CAF50',
                                                fontSize: '14px',
                                                fontStyle: 'italic'
                                            }}>
                                                💡 {issue.suggestion}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Positive Aspects */}
                        {review.positive_aspects && review.positive_aspects.length > 0 && (
                            <div style={{ marginBottom: '16px' }}>
                                <h4 style={{
                                    fontSize: '16px',
                                    marginBottom: '12px',
                                    color: '#4CAF50'
                                }}>
                                    ✅ What's Good
                                </h4>
                                <ul style={{ paddingLeft: '20px', color: '#bbb' }}>
                                    {review.positive_aspects.map((aspect, index) => (
                                        <li key={index} style={{ marginBottom: '4px' }}>
                                            {aspect}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Recommendations */}
                        {review.recommendations && review.recommendations.length > 0 && (
                            <div>
                                <h4 style={{
                                    fontSize: '16px',
                                    marginBottom: '12px',
                                    color: '#ffa502'
                                }}>
                                    💡 Recommendations
                                </h4>
                                <ul style={{ paddingLeft: '20px', color: '#bbb' }}>
                                    {review.recommendations.map((rec, index) => (
                                        <li key={index} style={{ marginBottom: '4px' }}>
                                            {rec}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SimpleAIReview; 