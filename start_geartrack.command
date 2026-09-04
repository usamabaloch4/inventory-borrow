#!/usr/bin/env bash
cd "$(dirname "$0")"

echo "======================================================"
echo "          GEARTRACK LOCAL INVENTORY SYSTEM"
echo "======================================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not found on this system!"
    echo "Please download and install Node.js from: https://nodejs.org/"
    read -p "Press enter to exit..."
    exit 1
fi

# Auto install dependencies if missing
if [ ! -d "node_modules" ]; then
    echo "[INFO] First time setup: Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to install dependencies."
        read -p "Press enter to exit..."
        exit 1
    fi
fi

# Auto open browser
(sleep 1.5 && open "http://localhost:3000") &

# Start Server
echo "[INFO] Starting GearTrack Server..."
echo "[INFO] Press Ctrl+C to stop."
echo "======================================================"
node server/server.js
