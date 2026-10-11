# Real-Time Collaborative Code Editor - Project Documentation

## 1. Project Overview
The **Real-Time Collaborative Code Editor** is an advanced, production-ready full-stack application that allows multiple users to join a room and collaboratively edit code in real-time. The project extends beyond a simple WebSocket proxy by integrating Artificial Intelligence (AI) Code Review, horizontal scalability, conflict resolution mechanisms, and enterprise-grade observability and security features.

---

## 2. Technology Stack

### Frontend
- **React.js (v18.2.0)**: UI framework.
- **React Router (v6.2.1)**: Client-side routing for navigating between the home screen and editor rooms.
- **CodeMirror (v5.65.2)**: Lightweight, powerful code editor component.
- **Socket.io-client**: For persistent, real-time bidirectional communication with the backend.
- **React-Avatar & React-Hot-Toast**: For user presence visualization and elegant notifications.
- **Axios & DOMPurify**: Used for safe external API fetching and XSS sanitization.

### Backend
- **Node.js (>=18.0.0) & Express.js**: REST API and static file serving.
- **Socket.IO (v4.4.1)**: WebSockets implementation for real-time code changes and user presence events.
- **Redis & ioredis**: Used for Pub/Sub messaging across multiple Node instances, caching, and rate limiting.
- **Bull (v4.10.4)**: Redis-based job queue for processing heavy workloads (e.g., AI Code Reviews) sequentially.
- **MongoDB (Mongoose)**: Document database for persistence (where configured).
- **Security**: Helmet, CORS, Express Rate Limit, bcryptjs, XSS protection.
- **Monitoring & Logging**: Winston (structured logging, daily rotation), Prom-client (Prometheus metrics configuration).

### Quality Assurance & Deployment
- **Docker**: `Dockerfile` and `docker-compose.yml` for containerized environments.
- **Jest & React Testing Library**: Unit and component testing.
- **Artillery**: Load-testing (`load-test.yml`).

---

## 3. Core Features

### 3.1 Real-Time Code Collaboration
Users create or join specific "Rooms" via unique IDs. CodeMirror instances broadcast changes down to individual keystrokes using Socket.IO.
- **Operational Transformation (OT)**: Used to handle race conditions where two users edit the exact same line simultaneously to ensure document consistency.

### 3.2 AI Code Review & Collaboration
The editor features a built-in AI assistant module (integrated heavily with Google's Gemini API).
- Users can request code reviews within the editor. The code is sent to the backend, which proxies the request to the AI service.
- **Collaborative Reviews**: Reviews are stored in-memory (in `server.js`) mapped by `reviewId` and broadcast to the room. Users in the room can add specific **line comments** on the AI feedback.

### 3.3 Scalability Architecture
The backend is designed for horizontal scaling across Load Balancers.
- **Redis Pub/Sub**: Inter-server communication ensures that events in a room are broadcast to all relevant users even if they are connected to different Node instances.
- **Message Queues**: Heavy background tasks are pipelined using Bull queues to prevent the main event loop from blocking.

### 3.4 Telemetry and Monitoring
- Endpoints like `/health` and `/health/detailed` report on memory usage, active Redis connections, active rooms, etc.
- Prometheus scraping metrics are exposed at `/metrics` so tools like Grafana can monitor performance.

---

## 4. Project Directory Structure

```text
Real-Time-Collaborative-Code-Editor/
├── config/                  # Configuration files and environment loader
├── middleware/              # Express middlewares (auth.js, validation.js)
├── models/                  # Database schemas 
├── public/                  # React public resources (index.html, logos)
├── routes/                  # Express routing controllers
├── services/               
│   ├── aiCodeReview.js      # Gemini AI integration and review logic
│   ├── encryption.js        # Data encryption utilities 
│   ├── healthCheck.js       # System parameter checking logic
│   ├── logger.js            # Winston configuration for daily rotated logs
│   ├── messageQueue.js      # Bull queue definitions
│   ├── monitoring.js        # Prometheus metrics configurations
│   ├── operationalTransform.js # OT code resolution logic
│   └── redis.js             # Redis connection manager and cache APIs
├── src/                     # React Frontend Source Code
│   ├── components/          # Reusable UI components
│   │   ├── AIReviewPanel.js # Slide-out UI for AI feedback
│   │   ├── SimpleAIReview.js# Compact AI feedback component
│   │   ├── Editor.js        # CodeMirror wrapper logic
│   │   └── Client.js        # Avatar display component
│   ├── pages/               
│   │   ├── Home.js          # Landing page to create/join rooms
│   │   └── EditorPage.js    # Main workspace with editor and sidebar
│   ├── Actions.js           # Shared constants for Socket events
│   ├── App.js               # React Router configuration
│   ├── index.js             # Entry point
│   └── socket.js            # Socket.io client bootstrapper
├── package.json             # NPM dependencies & scripts
├── server.js                # Core standalone Node server
├── server-enhanced.js       # Enterprise server with Redis & Rate Limiting
├── server-simple.js         # Basic lightweight version
└── Dockerfile               # Containerization strategy
```

---

## 5. Details of Frontend Implementation

### 5.1 `Home.js` (Landing Page)
- Takes `roomId` and `username` input.
- Connects to the React Router to forward state to the `EditorPage`.
- Capable of generating a random UUID for quick room generation.

### 5.2 `EditorPage.js` (Main Workspace)
- Holds the global Socket instance connection.
- Listens for `ACTIONS.JOINED` to update the list of connected clients and display their Avatars on the sidebar.
- Manages the AI Side panel toggling.
- Reacts to `ACTIONS.DISCONNECTED` to show toast notifications when a user leaves.
 
### 5.3 `Editor.js` (CodeMirror instance)
- Attached specifically to a `<textarea>` upon mounting.
- Instantiates `CodeMirror.fromTextArea`.
- Whenever a local content change happens (`change` event, but not triggered by socket `setValue`), it emits `ACTIONS.CODE_CHANGE` via socket.

### 5.4 `AIReviewPanel.js`
- Contains tabs for viewing the "Prompt, Summary, and Issues" provided by AI.
- Interfaces directly with endpoints like `/api/ai-review/create`.
- Polls or listens via sockets for `review_comment_added` so teammates can see comments in real-time.

---

## 6. Details of Backend API & WebSockets

### 6.1 REST API Endpoints
- **GET `/health` & `/health/detailed`**: Provides memory heap limits, dependency status, versioning, and environment variables. Required by deployment platforms like Render.
- **GET `/api/status` & `/api/ai-review/status`**: Provides info on active rooms, enabled AI functionalities, active users, and cache hits.
- **POST `/api/ai-review/create`**: Payload: `code`, `language`. Submits code to AI review (via `aiCodeReviewService`) and maps the generated result to the `roomId`.
- **GET `/api/ai-review/:reviewId`**: Fetches review contents and specific collaborative comments.
- **POST `/api/ai-review/:reviewId/comment`**: Allows users to attach a comment (e.g. "I agree with this AI suggestion") to a specific code review.

### 6.2 Socket.IO Events (`Actions.js`)
- `JOIN`: Sent by client when entering an EditorPage.
- `JOINED`: Broadcasted by Server to all clients in the room to indicate new user.
- `DISCONNECTED`: Notifies clients that a user has exited the room.
- `CODE_CHANGE`: Bi-directional event. Client sends on keypress; Server forwards to everyone else in the room.
- `SYNC_CODE`: Server asks for the current state of the document from an existing user to synchronize a brand-new user who just joined the room.

---

## 7. Available Scripts & Workflows
The `package.json` contains a robust suite of scripts to start the app in different lifecycle modes.
- `npm run start:dev`: Starts the React app, Redis, and Node via `nodemon`.
- `npm run start:simple`: Fires up `server-simple.js` strictly using WS, avoiding AI or Redis overhead locally.
- `npm run start:enhanced`: Starts production-ready architecture (`server-enhanced.js`) utilizing advanced middlewares, Operational Transform, and Health Metrics.
- `npm run test:load`: Uses artillery running `load-test.yml` to benchmark server concurrency performance.
- `npm run build:render` & `npm run build:simple`: Specific build tasks optimized for different hosting providers (Render, Railway).

---

## 8. Deployment & CI/CD
- **Nginx configuration**: Includes an `nginx.conf` designed for reverse proxying traffic and mapping `/health`.
- **Render**: `render.yaml` is the authoritative configuration — runtime, build and start commands, the pinned Node version and the path filter that decides when a push rebuilds. It is commented where a setting is not self-explanatory. The prose guides that used to sit beside it described a Docker-based setup the service no longer uses, and were removed rather than corrected.
- **Docker**: `DOCKER-DEPLOYMENT.md`, alongside `Dockerfile`, `Dockerfile.render` and the two compose files.
- **Verification**: `npm run chaos` (see `chaos/README.md`) asserts that every replica agrees with the server after a run of induced disconnections, and exits non-zero when it does not, so it belongs in CI. `npm run test:convergence` is the smaller two-client version. A set of ad-hoc deployment shell scripts used to sit here as well; they tested Dockerfiles that no longer exist and nothing invoked them, so they were removed.
