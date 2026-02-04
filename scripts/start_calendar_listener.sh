#!/bin/bash

# Calendar Event Listener Startup Script
# This script sets up and starts the calendar event listener

echo "Starting Google Calendar Event Listener..."

# Ensure required environment variables are set
export GOG_ACCOUNT="jpd515327098@gmail.com"

# Navigate to the workspace directory
cd /Users/cospeyton/.openclaw/workspace

# Check if the calendar checker script exists
if [ ! -f "calendar_checker.js" ]; then
    echo "Error: calendar_checker.js not found!"
    exit 1
fi

echo "Calendar checker script found at: $(pwd)/calendar_checker.js"

# The actual processing happens when OpenClaw receives the specific system event
# This listener is triggered by OpenClaw's event system when it receives:
# "检查今天的Google日历事件。如果有事件，则发送包含具体事项的提醒；如果没有事件，则不做任何操作。"

echo "Calendar event listener is configured and ready."
echo "When the system receives the trigger event, it will:"
echo "1. Run the calendar_checker.js script"
echo "2. If events are found (>0), send a reminder with specific items"
echo "3. If no events are found, do nothing"

# Keep the listener alive if running as a service
echo "Listener initialized successfully."