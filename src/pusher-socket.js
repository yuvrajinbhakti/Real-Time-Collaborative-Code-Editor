import Pusher from 'pusher-js';

// Enable pusher logging for development
if (process.env.NODE_ENV === 'development') {
  Pusher.logToConsole = true;
}

let pusher = null;
let channel = null;

export const initSocket = async () => {
  // Initialize Pusher
  pusher = new Pusher(process.env.REACT_APP_PUSHER_KEY, {
    cluster: process.env.REACT_APP_PUSHER_CLUSTER,
    encrypted: true,
  });

  console.log('✅ Pusher initialized successfully');
  
  // Return a Socket.IO-like interface
  return {
    emit: (event, data) => {
      // Send data to your API endpoint, which will trigger Pusher
      fetch('/api/pusher-emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, data })
      });
    },
    
    on: (event, callback) => {
      if (!channel) return;
      channel.bind(event, callback);
    },
    
    off: (event, callback) => {
      if (!channel) return;
      channel.unbind(event, callback);
    },
    
    join: (roomId) => {
      channel = pusher.subscribe(`room-${roomId}`);
      console.log(`📡 Joined room: ${roomId}`);
    },
    
    disconnect: () => {
      if (channel) {
        pusher.unsubscribe(channel.name);
        channel = null;
      }
      if (pusher) {
        pusher.disconnect();
      }
    }
  };
}; 