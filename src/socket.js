import { io } from 'socket.io-client';

/**
 * Where the Socket.IO server is.
 *
 * This used to fall back to `http://localhost:5000` whenever
 * REACT_APP_BACKEND_URL was unset at build time — and under a Docker runtime it
 * is unset, because Render's environment variables are not available inside
 * `docker build` unless the Dockerfile declares them. So the deployed bundle
 * told every visitor's browser to open a socket to *their own* machine, which
 * refused it. The server was fine the whole time; nothing could reach it.
 *
 * Same origin is the right default rather than a patch: this application is
 * served by the very process that runs the socket, so the page's own origin is
 * the answer in production and in a local production build alike. It needs no
 * build-time configuration, which is the property that was missing.
 *
 * The one case where they differ is the CRA dev server, which serves the page
 * from port 3000 while the API listens on 5000.
 */
function backendOrigin() {
    if (process.env.REACT_APP_BACKEND_URL) return process.env.REACT_APP_BACKEND_URL;
    const { origin, hostname, port } = window.location;
    const isDevServer = (hostname === 'localhost' || hostname === '127.0.0.1') && port === '3000';
    return isDevServer ? 'http://localhost:5000' : origin;
}

export const initSocket = async () => {
    const options = {
        'force new connection': true,
        reconnectionAttempts: Infinity,
        timeout: 10000,
        transports: ['websocket', 'polling']
    };
    
    const backendUrl = backendOrigin();
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
