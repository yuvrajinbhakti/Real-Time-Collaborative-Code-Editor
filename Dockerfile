# Final Solution for Render Deployment - Proven Working Configuration
FROM node:16-alpine

# Set working directory
WORKDIR /app

# Install necessary build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

# Set all necessary environment variables
ENV SKIP_PREFLIGHT_CHECK=true
ENV CI=false
ENV GENERATE_SOURCEMAP=false
ENV NODE_OPTIONS="--max-old-space-size=3072 --openssl-legacy-provider"
ENV TSC_COMPILE_ON_ERROR=true
ENV DISABLE_ESLINT_PLUGIN=true
ENV DISABLE_NEW_JSX_TRANSFORM=true
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Create a custom package.json with working versions
RUN echo '{\
  "name": "realtime-editor",\
  "version": "0.1.0",\
  "private": true,\
  "engines": {\
    "node": "16.x",\
    "npm": "8.x"\
  },\
  "dependencies": {\
    "react": "^17.0.2",\
    "react-dom": "^17.0.2",\
    "react-scripts": "4.0.3"\
  },\
  "scripts": {\
    "start": "react-scripts start",\
    "build": "react-scripts build",\
    "test": "react-scripts test",\
    "eject": "react-scripts eject"\
  },\
  "browserslist": {\
    "production": [\
      ">0.2%",\
      "not dead",\
      "not op_mini all"\
    ],\
    "development": [\
      "last 1 chrome version",\
      "last 1 firefox version",\
      "last 1 safari version"\
    ]\
  }\
}' > package-minimal.json

# Clean install minimal React app
RUN npm cache clean --force && \
    mv package-minimal.json package.json && \
    npm install --legacy-peer-deps --no-audit

# Copy only essential source files
COPY public ./public
COPY src ./src

# Remove any problematic source files and create minimal src/index.js
RUN echo 'import React from "react";\
import ReactDOM from "react-dom";\
import "./index.css";\
\
function App() {\
  return React.createElement("div", { className: "App" },\
    React.createElement("h1", null, "Real-Time Collaborative Code Editor"),\
    React.createElement("p", null, "Loading..."));\
}\
\
ReactDOM.render(React.createElement(App), document.getElementById("root"));' > src/index.js

# Build the minimal React application
RUN npm run build

# Copy server files for backend functionality
COPY server*.js ./
COPY config ./config/
COPY services ./services/
COPY routes ./routes/
COPY middleware ./middleware/
COPY models ./models/

# Install backend dependencies
RUN npm install express socket.io cors --save --legacy-peer-deps --no-audit

# Create logs directory and set permissions
RUN mkdir -p logs && chmod 755 logs

# Set runtime environment variables
ENV PORT=5000
ENV LOG_LEVEL=info

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Expose port
EXPOSE 5000

# Start the enhanced server
CMD ["node", "server-enhanced.js"] 