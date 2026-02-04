#!/bin/bash

# Script to check Google Calendar for today's events and send notification if any exist

ACCOUNT="jpd515327098@gmail.com"

# Get today's events from Google Calendar
EVENTS=$(gog calendar events --account="$ACCOUNT" --today --json)

# Extract the events array from the JSON response
EVENT_ARRAY=$(echo "$EVENTS" | jq '.events')

# Check if there are any events (not just empty array)
EVENT_COUNT=$(echo "$EVENT_ARRAY" | jq 'length')

if [ "$EVENT_COUNT" -gt 0 ]; then
    # Prepare message with event details
    MESSAGE="📅 Daily Calendar Reminder\n\nToday's Events:\n"
    
    # Loop through events and extract summary and time
    for i in $(seq 0 $((EVENT_COUNT - 1))); do
        SUMMARY=$(echo "$EVENT_ARRAY" | jq -r ".[$i].summary // \"(No Title)\"")
        START_TIME=$(echo "$EVENT_ARRAY" | jq -r ".[$i].start?.dateTime // .[$i].start?.date // \"Unknown Time\"")
        
        # Format the start time to show only the time part if it's a dateTime
        if [[ "$START_TIME" == *T* ]]; then
            FORMATTED_TIME=$(date -jf "%Y-%m-%dT%H:%M:%S%z" "$START_TIME" +"%H:%M" 2>/dev/null || echo "$START_TIME")
        else
            FORMATTED_TIME="All Day"
        fi
        
        MESSAGE="$MESSAGE• $SUMMARY ($FORMATTED_TIME)\n"
    done
    
    # Send notification using terminal-notifier if available
    if command -v terminal-notifier &> /dev/null; then
        terminal-notifier -title "📅 Daily Calendar Reminder" -message "$(echo -e "$MESSAGE")" -timeout 10
    else
        # Fallback: print to console and use osascript for macOS notification
        echo -e "$MESSAGE"
        osascript -e "display notification \"$MESSAGE\" with title \"Daily Calendar Reminder\""
    fi
else
    # No events found, don't send any notification
    echo "No events found for today."
fi