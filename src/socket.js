import { io } from 'socket.io-client';

export const initSocket = async () => {
    const options = {
        'force new connection': true,
        reconnectionAttempt: 'Infinity',
        timeout: 10000,
        transports: ['websocket'],
    };
    
    // In production, use the current URL (hostname) as the WebSocket server
    const backendURL = process.env.NODE_ENV === 'production' 
        ? window.location.origin 
        : process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';
    
    console.log('Connecting to Socket.IO at:', backendURL);
    return io(backendURL, options);
};
