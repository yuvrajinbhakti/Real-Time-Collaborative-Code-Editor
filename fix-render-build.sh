#!/bin/bash

# Render Build Fixer Script
# This script provides multiple approaches to fix the ajv-keywords build issue

set -e

echo "🔧 Render Build Fixer - Real-Time Collaborative Code Editor"
echo "============================================================="

# Function to print colored output
print_status() {
    echo -e "\033[32m✅ $1\033[0m"
}

print_info() {
    echo -e "\033[34mℹ️  $1\033[0m"
}

print_warning() {
    echo -e "\033[33m⚠️  $1\033[0m"
}

print_error() {
    echo -e "\033[31m❌ $1\033[0m"
}

# Function to backup and restore package.json
backup_package_json() {
    if [ -f "package.json" ]; then
        cp package.json package.json.backup
        print_status "Backed up package.json"
    fi
}

restore_package_json() {
    if [ -f "package.json.backup" ]; then
        cp package.json.backup package.json
        print_status "Restored package.json from backup"
    fi
}

# Approach 1: Force dependency resolution
approach_1() {
    print_info "Approach 1: Aggressive dependency resolution"
    
    backup_package_json
    
    # Clean everything
    rm -rf node_modules package-lock.json
    npm cache clean --force
    
    # Install with maximum compatibility flags
    npm install --legacy-peer-deps --force --no-audit
    
    # Try to remove the problematic package
    npm uninstall fork-ts-checker-webpack-plugin || true
    
    # Try build
    if npm run build:no-check; then
        print_status "Approach 1 succeeded!"
        return 0
    else
        print_warning "Approach 1 failed"
        restore_package_json
        return 1
    fi
}

# Approach 2: Downgrade react-scripts
approach_2() {
    print_info "Approach 2: Downgrade react-scripts to 4.0.3"
    
    backup_package_json
    
    # Modify package.json to use older react-scripts
    sed -i.bak 's/"react-scripts": "5.0.0"/"react-scripts": "4.0.3"/g' package.json
    
    # Clean and reinstall
    rm -rf node_modules package-lock.json
    npm cache clean --force
    npm install --legacy-peer-deps --no-audit
    
    # Try build
    if npm run build; then
        print_status "Approach 2 succeeded!"
        return 0
    else
        print_warning "Approach 2 failed"
        restore_package_json
        return 1
    fi
}

# Approach 3: Use Node 18
approach_3() {
    print_info "Approach 3: Recommending Node 18 and minimal Dockerfile"
    
    echo "For this approach, use Dockerfile.minimal with Node 18:"
    echo "1. Update render.yaml to use dockerfilePath: ./Dockerfile.minimal"
    echo "2. Or manually set Dockerfile path in Render dashboard"
    
    return 0
}

# Approach 4: Eject from create-react-app (last resort)
approach_4() {
    print_info "Approach 4: Eject from create-react-app (DESTRUCTIVE - backup first!)"
    
    read -p "⚠️ This will eject your app and cannot be undone. Continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Skipping eject approach"
        return 1
    fi
    
    backup_package_json
    
    # Eject the app
    npm run eject
    
    # Remove problematic webpack plugin
    sed -i.bak '/fork-ts-checker-webpack-plugin/d' config/webpack.config.js
    
    # Try build
    if npm run build; then
        print_status "Approach 4 succeeded!"
        return 0
    else
        print_warning "Approach 4 failed"
        return 1
    fi
}

# Test current setup
test_current_setup() {
    print_info "Testing current setup..."
    
    if npm run build:no-check 2>/dev/null; then
        print_status "Current setup works! No changes needed."
        return 0
    else
        print_warning "Current setup has issues. Trying fixes..."
        return 1
    fi
}

# Main execution
main() {
    echo ""
    print_info "Starting build fix attempts..."
    echo ""
    
    # Test current setup first
    if test_current_setup; then
        print_status "Build successful! Your app is ready for Render deployment."
        echo ""
        echo "🚀 Next steps:"
        echo "1. git add . && git commit -m 'Fix build issues' && git push"
        echo "2. Deploy on Render using Dockerfile.render"
        echo "3. Set health check path to /health"
        exit 0
    fi
    
    # Try approaches in order
    if approach_1; then
        print_status "✅ Fixed with Approach 1 (Aggressive dependency resolution)"
    elif approach_2; then
        print_status "✅ Fixed with Approach 2 (Downgraded react-scripts)"
    else
        print_warning "Standard approaches failed. Consider these options:"
        echo ""
        approach_3
        echo ""
        echo "📝 Alternative Dockerfiles available:"
        echo "   - Dockerfile.render (recommended)"
        echo "   - Dockerfile.minimal (Node 18 + react-scripts 4.x)"
        echo "   - Dockerfile (multi-stage)"
        echo ""
        echo "🔧 Manual fixes you can try:"
        echo "   1. Use Node 18 instead of Node 20"
        echo "   2. Remove typescript from your project"
        echo "   3. Use a different build tool (Vite, etc.)"
        echo ""
        
        read -p "❓ Would you like to try the destructive eject approach? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            approach_4
        fi
    fi
    
    echo ""
    print_info "🚀 Deployment files available:"
    echo "   - render.yaml (automatic configuration)"
    echo "   - Dockerfile.render (optimized for Render)"
    echo "   - Dockerfile.minimal (fallback option)"
    echo ""
    print_info "📖 Check RENDER-DEPLOYMENT-GUIDE.md for detailed instructions"
}

# Run main function
main

# Cleanup
if [ -f "package.json.backup" ]; then
    rm package.json.backup
fi

echo ""
print_status "Script completed!" 