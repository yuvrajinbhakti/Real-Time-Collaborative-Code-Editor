import { io } from 'socket.io-client';

export const initSocket = async () => {
    const options = {
        'force new connection': true,
        reconnectionAttempt: 'Infinity',
        timeout: 10000,
        transports: ['websocket'],
        path: '/socket.io/'
    };
    
    // In production, use the current URL (hostname) as the WebSocket server
    const backendURL = window.location.origin;
    
    console.log('Connecting to Socket.IO at:', backendURL);
    return io(backendURL, options);
};
