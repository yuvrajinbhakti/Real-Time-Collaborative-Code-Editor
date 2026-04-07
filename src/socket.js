import { io } from 'socket.io-client';

export const initSocket = async () => {
    const options = {
        'force new connection': true,
        reconnectionAttempts: Infinity,
        timeout: 10000,
        transports: ['websocket', 'polling']
    };
    
    const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';
    console.log(`🔗 Connecting to Socket.IO server at ${backendUrl}...`);
    const socket = io(backendUrl, options);
    
    socket.on('connect', () => {
        console.log('✅ Socket connected successfully:', socket.id);
    });
    
    socket.on('connect_error', (error) => {
        console.error('❌ Socket connection error:', error);
    });
    
    socket.on('disconnect', (reason) => {
        console.log('🔌 Socket disconnected:', reason);
    });
    
    return socket;
};
