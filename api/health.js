export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  res.status(200).json({ 
    status: 'healthy',
    message: 'Socket.IO API is ready',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    socketPath: '/api/socket',
    transport: 'polling-only'
  });
} 