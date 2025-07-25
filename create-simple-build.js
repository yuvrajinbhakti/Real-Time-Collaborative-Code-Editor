const fs = require('fs');
const path = require('path');

console.log('🔨 Creating simple build for deployment...');

// Create build directory
const buildDir = path.join(__dirname, 'build');
if (fs.existsSync(buildDir)) {
  fs.rmSync(buildDir, { recursive: true });
}
fs.mkdirSync(buildDir, { recursive: true });

// Create minimal HTML application
const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Real-Time Collaborative Code Editor</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            padding: 2rem;
            max-width: 500px;
            width: 90%;
            text-align: center;
        }
        .logo { font-size: 2.5rem; margin-bottom: 1rem; color: #667eea; }
        h1 { color: #333; margin-bottom: 0.5rem; font-size: 1.8rem; }
        .subtitle { color: #666; margin-bottom: 2rem; }
        .input-group { margin-bottom: 1.5rem; }
        input {
            width: 100%;
            padding: 12px;
            border: 2px solid #e1e5e9;
            border-radius: 8px;
            font-size: 16px;
        }
        input:focus { outline: none; border-color: #667eea; }
        .button-group { display: flex; gap: 1rem; flex-wrap: wrap; }
        button {
            flex: 1;
            min-width: 120px;
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        .btn-primary { background: #667eea; color: white; }
        .btn-primary:hover { background: #5a67d8; transform: translateY(-2px); }
        .btn-secondary { background: #f7fafc; color: #4a5568; border: 2px solid #e2e8f0; }
        .btn-secondary:hover { background: #edf2f7; transform: translateY(-2px); }
        .status {
            margin-top: 1rem;
            padding: 10px;
            border-radius: 6px;
            font-size: 14px;
            display: none;
        }
        .status.connecting { background: #ffd93d; color: #744210; }
        .status.connected { background: #68d391; color: #22543d; }
        .status.error { background: #fc8181; color: #742a2a; }
        
        .editor-container {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: #1e1e1e;
            color: #d4d4d4;
        }
        .editor-header {
            background: #2d2d30;
            padding: 10px 20px;
            border-bottom: 1px solid #3e3e42;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .editor-title { font-size: 14px; color: #cccccc; }
        .users-list { display: flex; gap: 10px; }
        .user-badge {
            background: #667eea;
            color: white;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
        }
        .editor-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            height: calc(100vh - 60px);
        }
        .code-editor {
            flex: 1;
            background: #1e1e1e;
            color: #d4d4d4;
            border: none;
            outline: none;
            padding: 20px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 14px;
            line-height: 1.5;
            resize: none;
        }
        @media (max-width: 600px) {
            .button-group { flex-direction: column; }
            button { min-width: auto; }
        }
    </style>
</head>
<body>
    <div class="container" id="homeContainer">
        <div class="logo">⚡</div>
        <h1>Real-Time Collaborative Code Editor</h1>
        <p class="subtitle">Code together in real-time with your team</p>
        
        <div class="input-group">
            <input type="text" id="usernameInput" placeholder="Enter your username" maxlength="20" />
        </div>
        
        <div class="input-group">
            <input type="text" id="roomIdInput" placeholder="Room ID (leave empty to create new room)" />
        </div>
        
        <div class="button-group">
            <button class="btn-primary" onclick="joinRoom()">Join Room</button>
            <button class="btn-secondary" onclick="createRoom()">Create Room</button>
        </div>
        
        <div id="status" class="status"></div>
    </div>
    
    <div class="editor-container" id="editorContainer">
        <div class="editor-header">
            <div class="editor-title">Room: <span id="currentRoomId"></span></div>
            <div class="users-list" id="usersList"></div>
        </div>
        <div class="editor-content">
            <textarea class="code-editor" id="codeEditor" placeholder="Start typing your code here..."></textarea>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        let socket = null;
        let currentRoom = null;
        let currentUser = null;
        let users = [];
        let isUpdatingCode = false;

        const homeContainer = document.getElementById('homeContainer');
        const editorContainer = document.getElementById('editorContainer');
        const usernameInput = document.getElementById('usernameInput');
        const roomIdInput = document.getElementById('roomIdInput');
        const statusDiv = document.getElementById('status');
        const codeEditor = document.getElementById('codeEditor');
        const currentRoomIdSpan = document.getElementById('currentRoomId');
        const usersList = document.getElementById('usersList');

        const ACTIONS = {
            JOIN: 'join',
            JOINED: 'joined',
            DISCONNECTED: 'disconnected',
            CODE_CHANGE: 'code-change',
            SYNC_CODE: 'sync-code'
        };

        function generateRoomId() {
            return Math.random().toString(36).substring(2, 8).toUpperCase();
        }

        function showStatus(message, type = 'connecting') {
            statusDiv.textContent = message;
            statusDiv.className = 'status ' + type;
            statusDiv.style.display = 'block';
        }

        function hideStatus() {
            statusDiv.style.display = 'none';
        }

        function validateInput() {
            const username = usernameInput.value.trim();
            if (!username) {
                showStatus('Please enter a username', 'error');
                return false;
            }
            if (username.length < 2) {
                showStatus('Username must be at least 2 characters', 'error');
                return false;
            }
            return true;
        }

        function createRoom() {
            if (!validateInput()) return;
            const roomId = generateRoomId();
            roomIdInput.value = roomId;
            joinRoom();
        }

        function joinRoom() {
            if (!validateInput()) return;
            const username = usernameInput.value.trim();
            const roomId = roomIdInput.value.trim() || generateRoomId();
            currentUser = username;
            currentRoom = roomId;
            showStatus('Connecting to room...', 'connecting');
            initSocket(roomId, username);
        }

        function initSocket(roomId, username) {
            try {
                socket = io('/', { transports: ['websocket', 'polling'] });

                socket.on('connect', () => {
                    showStatus('Connected! Joining room...', 'connecting');
                    socket.emit(ACTIONS.JOIN, { roomId, username });
                });

                socket.on(ACTIONS.JOINED, ({ clients, username: joinedUser, socketId }) => {
                    users = clients;
                    updateUsersList();
                    if (joinedUser === currentUser) {
                        showEditor();
                        showStatus('Connected successfully!', 'connected');
                        setTimeout(hideStatus, 2000);
                    }
                });

                socket.on(ACTIONS.CODE_CHANGE, ({ code }) => {
                    if (!isUpdatingCode) {
                        codeEditor.value = code;
                    }
                });

                socket.on(ACTIONS.DISCONNECTED, ({ socketId, username }) => {
                    users = users.filter(user => user.socketId !== socketId);
                    updateUsersList();
                });

                socket.on('disconnect', () => {
                    showStatus('Disconnected from server', 'error');
                });

                socket.on('connect_error', (error) => {
                    showStatus('Failed to connect to server', 'error');
                });
            } catch (error) {
                showStatus('Failed to initialize connection', 'error');
            }
        }

        function showEditor() {
            homeContainer.style.display = 'none';
            editorContainer.style.display = 'flex';
            currentRoomIdSpan.textContent = currentRoom;
            codeEditor.focus();
        }

        function updateUsersList() {
            usersList.innerHTML = '';
            users.forEach(user => {
                const badge = document.createElement('div');
                badge.className = 'user-badge';
                badge.textContent = user.username;
                usersList.appendChild(badge);
            });
        }

        let codeChangeTimeout;
        codeEditor.addEventListener('input', () => {
            if (socket && currentRoom) {
                isUpdatingCode = true;
                clearTimeout(codeChangeTimeout);
                codeChangeTimeout = setTimeout(() => {
                    socket.emit(ACTIONS.CODE_CHANGE, { roomId: currentRoom, code: codeEditor.value });
                    isUpdatingCode = false;
                }, 300);
            }
        });

        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                showStatus('Code synchronized!', 'connected');
                setTimeout(hideStatus, 1000);
            }
            if (e.key === 'Escape' && editorContainer.style.display === 'flex') {
                if (confirm('Are you sure you want to leave the room?')) {
                    location.reload();
                }
            }
            if (e.key === 'Enter' && homeContainer.style.display !== 'none') {
                joinRoom();
            }
        });

        usernameInput.focus();
    </script>
</body>
</html>`;

// Write HTML file
fs.writeFileSync(path.join(buildDir, 'index.html'), htmlContent);

// Create asset-manifest.json for compatibility
const assetManifest = {
  "files": {
    "main.js": "/static/js/main.js",
    "main.css": "/static/css/main.css",
    "index.html": "/index.html"
  },
  "entrypoints": [
    "static/css/main.css",
    "static/js/main.js"
  ]
};

fs.writeFileSync(path.join(buildDir, 'asset-manifest.json'), JSON.stringify(assetManifest, null, 2));

// Create static directories and files for compatibility
const staticDir = path.join(buildDir, 'static');
const cssDir = path.join(staticDir, 'css');
const jsDir = path.join(staticDir, 'js');

fs.mkdirSync(cssDir, { recursive: true });
fs.mkdirSync(jsDir, { recursive: true });

fs.writeFileSync(path.join(cssDir, 'main.css'), '/* Styles embedded in HTML */');
fs.writeFileSync(path.join(jsDir, 'main.js'), '// JavaScript embedded in HTML');

console.log('✅ Simple build created successfully!');
console.log('📁 Build directory:', buildDir);
console.log('🚀 Ready for deployment!'); 