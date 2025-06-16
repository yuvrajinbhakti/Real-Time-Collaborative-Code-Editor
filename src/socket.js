import { io } from 'socket.io-client';

export const initSocket = async () => {
    const options = {
        'force new connection': true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        transports: ['polling'], // Force polling only initially
        path: '/api/socket',
        forceNew: true,
        upgrade: false, // Disable automatic upgrade to websocket
        rememberUpgrade: false
    };
    
    // In production, use the current URL (hostname) as the WebSocket server
    const backendURL = window.location.origin;
    
    console.log('Connecting to Socket.IO at:', backendURL, 'with options:', options);
    console.log('Using polling transport only to avoid Vercel WebSocket issues');
    
    const socket = io(backendURL, options);
    
    // Add additional error handling
    socket.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error);
        console.error('Error details:', error.message, error.description, error.context);
    });

    socket.on('connect', () => {
        console.log('Socket.IO connected successfully via polling transport');
    });

    socket.on('disconnect', (reason) => {
        console.log('Socket.IO disconnected:', reason);
    });
    
    return socket;
};
