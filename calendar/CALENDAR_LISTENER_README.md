# Google Calendar Event Listener System

## Overview
This system listens for a specific system event and runs the calendar checker script when triggered. If calendar events are found for today, it sends a reminder with specific items. If no events are found, it does nothing.

## Components

### 1. calendar_checker.js
- Main script that queries Google Calendar for today's events
- Uses the gog CLI tool to access Google Calendar
- Outputs calendar events or [NO_EVENTS_TODAY] if none found

### 2. calendar_listener.js
- Event listener that handles the system trigger
- Runs the calendar checker script when the event is received
- Processes the results and prepares appropriate responses

### 3. calendar_event_config.json
- Configuration file for OpenClaw's event system
- Defines the trigger phrase and associated actions
- Specifies conditions for when the listener operates

### 4. start_calendar_listener.sh
- Startup script to initialize the listener
- Sets up required environment variables

## How It Works

1. OpenClaw's event system listens for the trigger:
   "检查今天的Google日历事件。如果有事件，则发送包含具体事项的提醒；如果没有事件，则不做任何操作。"

2. When this event is received, the system runs `/Users/cospeyton/.openclaw/workspace/calendar_checker.js`

3. If the script returns calendar events (count > 0), a reminder with specific items is sent to the main session

4. If the script returns "[NO_EVENTS_TODAY]", no action is taken

## Trigger Conditions
- Minimum interval: 10 minutes between checks
- Only active between 6 AM and 10 PM
- Only responds to the exact trigger phrase

## Environment Variables
- GOG_ACCOUNT: jpd515327098@gmail.com

## Status
The system is fully configured and operational. Ready to respond to calendar check events.