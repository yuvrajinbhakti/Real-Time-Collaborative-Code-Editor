import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import './AIReviewPanel.css';

const AIReviewPanel = ({ roomId, socketRef, currentCode, language }) => {
  const [reviews, setReviews] = useState([]);
  const [currentReview, setCurrentReview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedAnalysisTypes, setSelectedAnalysisTypes] = useState([
    'bugs', 'security', 'performance', 'style', 'maintainability'
  ]);
  const [showSettings, setShowSettings] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commentingOnLine, setCommentingOnLine] = useState(null);
  const [aiProvider, setAiProvider] = useState('gemini');

  // Analysis types configuration
  const analysisTypes = [
    { id: 'bugs', label: 'Bug Detection', color: '#ff4757', icon: '🐛' },
    { id: 'security', label: 'Security Issues', color: '#ff6b6b', icon: '🔒' },
    { id: 'performance', label: 'Performance', color: '#ffa502', icon: '⚡' },
    { id: 'style', label: 'Code Style', color: '#3742fa', icon: '🎨' },
    { id: 'maintainability', label: 'Maintainability', color: '#2ed573', icon: '🔧' },
    { id: 'complexity', label: 'Complexity', color: '#a55eea', icon: '🧮' },
    { id: 'documentation', label: 'Documentation', color: '#26de81', icon: '📝' }
  ];

  // Load room reviews on mount
  useEffect(() => {
    loadRoomReviews();
    checkAIProviderStatus();
  }, [roomId]);

  // Check AI provider status
  const checkAIProviderStatus = async () => {
    try {
      const response = await fetch('/api/ai-review/status');
      const data = await response.json();
      if (data.success && data.data.enabled) {
        setAiProvider(data.data.provider || 'gemini');
      }
    } catch (error) {
      console.error('Failed to check AI provider status:', error);
    }
  };

  // Socket listeners for real-time updates
  useEffect(() => {
    if (!socketRef.current) return;

    const handleReviewCreated = (data) => {
      toast.success(`New AI review created by ${data.authorId}`);
      loadRoomReviews();
    };

    const handleReviewCommentAdded = (data) => {
      if (currentReview && currentReview.id === data.reviewId) {
        setCurrentReview(prev => ({
          ...prev,
          comments: [...prev.comments, data.comment]
        }));
      }
      toast.success('New comment added to review');
    };

    socketRef.current.on('ai_review_created', handleReviewCreated);
    socketRef.current.on('review_comment_added', handleReviewCommentAdded);

    return () => {
      socketRef.current?.off('ai_review_created', handleReviewCreated);
      socketRef.current?.off('review_comment_added', handleReviewCommentAdded);
    };
  }, [socketRef, currentReview]);

  // Load room reviews
  const loadRoomReviews = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/ai-review/room/${roomId}`);
      const data = await response.json();
      
      if (data.success) {
        setReviews(data.data);
      }
    } catch (error) {
      console.error('Failed to load reviews:', error);
      toast.error('Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  // Create new AI review
  const createReview = async () => {
    if (!currentCode || currentCode.trim().length === 0) {
      toast.error('No code to review');
      return;
    }

    try {
      setAnalyzing(true);
      const response = await fetch('/api/ai-review/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomId,
          code: currentCode,
          language,
          analysisTypes: selectedAnalysisTypes
        })
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success('AI review created successfully!');
        setCurrentReview({
          id: data.data.reviewId,
          analysis: data.data.analysis,
          code: currentCode,
          language,
          comments: []
        });
        loadRoomReviews();
      } else {
        toast.error(data.message || 'Failed to create review');
      }
    } catch (error) {
      console.error('Failed to create review:', error);
      toast.error('Failed to create review');
    } finally {
      setAnalyzing(false);
    }
  };

  // Load specific review
  const loadReview = async (reviewId) => {
    try {
      const response = await fetch(`/api/ai-review/${reviewId}`);
      const data = await response.json();
      
      if (data.success) {
        setCurrentReview(data.data);
      }
    } catch (error) {
      console.error('Failed to load review:', error);
      toast.error('Failed to load review');
    }
  };

  // Add comment to review
  const addComment = async () => {
    if (!currentReview || !newComment.trim()) return;

    try {
      const response = await fetch(`/api/ai-review/${currentReview.id}/comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          comment: newComment.trim(),
          lineNumber: commentingOnLine
        })
      });

      const data = await response.json();
      
      if (data.success) {
        setCurrentReview(prev => ({
          ...prev,
          comments: [...prev.comments, data.data]
        }));
        setNewComment('');
        setCommentingOnLine(null);
        toast.success('Comment added successfully!');
      } else {
        toast.error(data.message || 'Failed to add comment');
      }
    } catch (error) {
      console.error('Failed to add comment:', error);
      toast.error('Failed to add comment');
    }
  };

  // Get severity color
  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return '#ff4757';
      case 'high': return '#ff6b6b';
      case 'medium': return '#ffa502';
      case 'low': return '#26de81';
      default: return '#747d8c';
    }
  };

  // Get issue type config
  const getIssueTypeConfig = (type) => {
    return analysisTypes.find(at => at.id === type) || { color: '#747d8c', icon: '📝' };
  };

  // Render issue item
  const renderIssue = (issue, index) => {
    const typeConfig = getIssueTypeConfig(issue.type);
    
    return (
      <div key={issue.id || index} className="issue-item">
        <div className="issue-header">
          <span className="issue-type" style={{ color: typeConfig.color }}>
            {typeConfig.icon} {issue.type}
          </span>
          <span 
            className="issue-severity"
            style={{ backgroundColor: getSeverityColor(issue.severity) }}
          >
            {issue.severity}
          </span>
        </div>
        
        <div className="issue-location">
          Line {issue.line}{issue.column > 0 ? `, Column ${issue.column}` : ''}
        </div>
        
        <div className="issue-message">
          {issue.message}
        </div>
        
        {issue.suggestion && (
          <div className="issue-suggestion">
            <strong>Suggestion:</strong> {issue.suggestion}
          </div>
        )}
        
        {issue.code_snippet && (
          <div className="issue-code-snippet">
            <pre><code>{issue.code_snippet}</code></pre>
          </div>
        )}
        
        <button 
          className="comment-on-line-btn"
          onClick={() => setCommentingOnLine(issue.line)}
        >
          💬 Comment on this line
        </button>
      </div>
    );
  };

  // Render review summary
  const renderReviewSummary = (review) => {
    if (!review.analysis) return null;

    const { analysis } = review;
    
    return (
      <div className="review-summary">
        <div className="score-section">
          <div className="overall-score">
            <div 
              className="score-circle"
              style={{ 
                background: `conic-gradient(#2ed573 ${analysis.overall_score * 3.6}deg, #e1e8ed 0deg)`
              }}
            >
              <span className="score-text">{analysis.overall_score}</span>
            </div>
            <span className="score-label">Overall Score</span>
          </div>
          
          <div className="metrics">
            <div className="metric">
              <span className="metric-value">{analysis.issues.length}</span>
              <span className="metric-label">Issues Found</span>
            </div>
            <div className="metric">
              <span className="metric-value">
                {analysis.issues.filter(i => i.severity === 'critical').length}
              </span>
              <span className="metric-label">Critical</span>
            </div>
            <div className="metric">
              <span className="metric-value">
                {analysis.complexity_analysis.maintainability_index}
              </span>
              <span className="metric-label">Maintainability</span>
            </div>
          </div>
        </div>
        
        <div className="summary-text">
          <h4>Summary</h4>
          <p>{analysis.summary}</p>
        </div>
        
        {analysis.positive_aspects.length > 0 && (
          <div className="positive-aspects">
            <h4>✅ Positive Aspects</h4>
            <ul>
              {analysis.positive_aspects.map((aspect, index) => (
                <li key={index}>{aspect}</li>
              ))}
            </ul>
          </div>
        )}
        
        {analysis.recommendations.length > 0 && (
          <div className="recommendations">
            <h4>💡 Recommendations</h4>
            <ul>
              {analysis.recommendations.map((rec, index) => (
                <li key={index}>{rec}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ai-review-panel">
      <div className="review-header">
        <div className="header-title">
          <h3>🤖 AI Code Review</h3>
          <span className="ai-provider-badge">
            {aiProvider === 'gemini' ? '🆓 Gemini' : '💰 OpenAI'}
          </span>
        </div>
        <div className="review-actions">
          <button 
            className="settings-btn"
            onClick={() => setShowSettings(!showSettings)}
          >
            ⚙️
          </button>
          <button 
            className="new-review-btn"
            onClick={createReview}
            disabled={analyzing}
          >
            {analyzing ? '🔄 Analyzing...' : '🔍 Review Code'}
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="analysis-settings">
          <h4>Analysis Types</h4>
          <div className="analysis-types">
            {analysisTypes.map(type => (
              <label key={type.id} className="analysis-type">
                <input
                  type="checkbox"
                  checked={selectedAnalysisTypes.includes(type.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedAnalysisTypes([...selectedAnalysisTypes, type.id]);
                    } else {
                      setSelectedAnalysisTypes(selectedAnalysisTypes.filter(id => id !== type.id));
                    }
                  }}
                />
                <span style={{ color: type.color }}>
                  {type.icon} {type.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="review-content">
        <div className="review-tabs">
          <button 
            className={`tab ${!currentReview ? 'active' : ''}`}
            onClick={() => setCurrentReview(null)}
          >
            📋 Recent Reviews ({reviews.length})
          </button>
          {currentReview && (
            <button className="tab active">
              🔍 Current Review
            </button>
          )}
        </div>

        {!currentReview ? (
          <div className="reviews-list">
            {loading ? (
              <div className="loading">Loading reviews...</div>
            ) : reviews.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🤖</div>
                <p>No reviews yet. Click "Review Code" to get started!</p>
              </div>
            ) : (
              reviews.map(review => (
                <div 
                  key={review.id} 
                  className="review-item"
                  onClick={() => loadReview(review.id)}
                >
                  <div className="review-item-header">
                    <span className="review-language">{review.language}</span>
                    <span className="review-score">{review.overallScore}/100</span>
                  </div>
                  <div className="review-item-summary">
                    {review.summary}
                  </div>
                  <div className="review-item-meta">
                    <span className="issue-count">
                      {review.issueCount} issues
                    </span>
                    <span className="comment-count">
                      {review.commentCount} comments
                    </span>
                    <span className="review-date">
                      {new Date(review.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="current-review">
            {renderReviewSummary(currentReview)}
            
            <div className="issues-section">
              <h4>🔍 Issues Found ({currentReview.analysis.issues.length})</h4>
              {currentReview.analysis.issues.length === 0 ? (
                <div className="no-issues">
                  <div className="success-icon">✅</div>
                  <p>No issues found! Your code looks great!</p>
                </div>
              ) : (
                <div className="issues-list">
                  {currentReview.analysis.issues.map(renderIssue)}
                </div>
              )}
            </div>

            <div className="comments-section">
              <h4>💬 Comments ({currentReview.comments.length})</h4>
              
              <div className="add-comment">
                {commentingOnLine && (
                  <div className="commenting-line">
                    Commenting on line {commentingOnLine}
                    <button onClick={() => setCommentingOnLine(null)}>✕</button>
                  </div>
                )}
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add a comment..."
                  className="comment-input"
                />
                <button 
                  className="add-comment-btn"
                  onClick={addComment}
                  disabled={!newComment.trim()}
                >
                  Add Comment
                </button>
              </div>

              <div className="comments-list">
                {currentReview.comments.map(comment => (
                  <div key={comment.id} className="comment-item">
                    <div className="comment-header">
                      <span className="comment-author">{comment.userId}</span>
                      {comment.lineNumber && (
                        <span className="comment-line">Line {comment.lineNumber}</span>
                      )}
                      <span className="comment-date">
                        {new Date(comment.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="comment-text">
                      {comment.comment}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIReviewPanel; 