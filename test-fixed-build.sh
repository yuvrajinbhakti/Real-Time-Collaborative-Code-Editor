#!/bin/bash

# Test script for the fixed Docker build
echo "🔧 Testing Fixed Docker Build for Real-Time Collaborative Code Editor"
echo "======================================================================"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    echo "   On macOS: Start Docker Desktop"
    echo "   On Linux: sudo systemctl start docker"
    exit 1
fi

echo "✅ Docker is running"

# Test the main fixed Dockerfile
echo ""
echo "🚀 Testing main Dockerfile..."
if docker build -t collab-editor-fixed .; then
    echo "✅ Main Dockerfile build: SUCCESS"
    MAIN_SUCCESS=true
else
    echo "❌ Main Dockerfile build: FAILED"
    MAIN_SUCCESS=false
fi

# Test the backup Dockerfile
echo ""
echo "🚀 Testing backup Dockerfile..."
if docker build -f Dockerfile.backup -t collab-editor-backup .; then
    echo "✅ Backup Dockerfile build: SUCCESS"
    BACKUP_SUCCESS=true
else
    echo "❌ Backup Dockerfile build: FAILED"
    BACKUP_SUCCESS=false
fi

# Summary
echo ""
echo "📊 BUILD SUMMARY"
echo "=================="
if [ "$MAIN_SUCCESS" = true ]; then
    echo "✅ Main Dockerfile: Ready for production"
    echo "   Command: docker build -t collab-editor ."
elif [ "$BACKUP_SUCCESS" = true ]; then
    echo "✅ Backup Dockerfile: Ready for production"
    echo "   Command: docker build -f Dockerfile.backup -t collab-editor ."
    echo "   ⚠️  Note: This uses a minimal frontend (server only)"
else
    echo "❌ Both builds failed. Please check the error messages above."
    exit 1
fi

echo ""
echo "🚀 To run the container:"
echo "   docker run -p 5000:5000 collab-editor-fixed"
echo "   Then visit: http://localhost:5000"

echo ""
echo "🧹 To clean up test images:"
echo "   docker rmi collab-editor-fixed collab-editor-backup" 