# Daily Google Calendar Checker

This project consists of a script and a scheduled task that check Google Calendar for events each day and send notifications if any events exist.

## Components

1. **check_calendar_events.sh** - A bash script that:
   - Uses the GOG tool to access Google Calendar
   - Checks for events on the current day
   - Sends a desktop notification if events exist
   - Does nothing if no events exist

2. **Cron job** - Scheduled to run daily at 7:00 AM that executes the script

## How it works

- The script queries Google Calendar for events today using the account `jpd515327098@gmail.com`
- If events are found, it extracts the summary and time for each event
- It displays a notification showing all events for the day
- If no events exist, no notification is shown
- All runs are logged to `calendar_check.log`

## Cron Schedule

The task runs at 7:00 AM every day according to this schedule:
```
0 7 * * * /Users/cospeyton/.openclaw/workspace/check_calendar_events.sh >> /Users/cospeyton/.openclaw/workspace/calendar_check.log 2>&1
```

## Logging

All output from the script is appended to `calendar_check.log`, including any errors.