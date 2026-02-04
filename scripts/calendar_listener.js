const { execSync } = require('child_process');
const fs = require('fs');

/**
 * Calendar Event Listener
 * Listens for system events to check Google Calendar and sends reminders if events exist
 */

class CalendarListener {
  constructor() {
    this.scriptPath = '/Users/cospeyton/.openclaw/workspace/calendar_checker.js';
    this.eventTrigger = '检查今天的Google日历事件。如果有事件，则发送包含具体事项的提醒；如果没有事件，则不做任何操作。';
  }

  /**
   * Runs the calendar checker script and processes the results
   */
  runCalendarCheck() {
    try {
      console.log('Running calendar check...');
      
      // Execute the calendar checker script
      const result = execSync(`node ${this.scriptPath}`, { 
        encoding: 'utf8',
        timeout: 20000
      });

      console.log('Script executed successfully');
      
      // Check if the result indicates no events
      if (result.includes('[NO_EVENTS_TODAY]')) {
        console.log('No calendar events found for today. No action taken.');
        return null;
      }
      
      // Process and return the calendar events message
      return result.trim();
    } catch (error) {
      console.error('Error running calendar checker:', error.message);
      throw error;
    }
  }

  /**
   * Handles the incoming system event
   * @param {string} event - The system event message
   */
  handleEvent(event) {
    if (event === this.eventTrigger) {
      console.log('Calendar check event received. Processing...');
      
      try {
        const calendarResult = this.runCalendarCheck();
        
        if (calendarResult && !calendarResult.includes('[NO_EVENTS_TODAY]')) {
          // Send the calendar events as a reminder
          console.log('Sending calendar reminder:');
          console.log(calendarResult);
          
          // In a real implementation, this would send the message to the main session
          // For now, we'll just return the message so it can be handled by OpenClaw
          return {
            success: true,
            message: calendarResult,
            eventType: 'calendar_reminder'
          };
        } else {
          console.log('No events to send. Skipping notification.');
          return {
            success: true,
            message: null,
            eventType: 'calendar_no_events'
          };
        }
      } catch (error) {
        console.error('Error handling calendar event:', error.message);
        return {
          success: false,
          error: error.message,
          eventType: 'calendar_error'
        };
      }
    } else {
      return {
        success: false,
        message: 'Event not recognized',
        eventType: 'unknown_event'
      };
    }
  }

  /**
   * Starts listening for events (would integrate with OpenClaw's event system)
   */
  startListening() {
    console.log('Calendar listener started. Waiting for events...');
    
    // This would typically connect to OpenClaw's event system
    // For now, we'll just simulate the functionality
    
    // If arguments are passed, treat them as an event to process
    if (process.argv.length > 2) {
      const event = process.argv.slice(2).join(' ');
      const result = this.handleEvent(event);
      
      if (result.success && result.message) {
        console.log('REMINDER_SENT:', result.message);
      } else if (result.success && result.message === null) {
        console.log('NO_EVENTS_TO_SEND');
      } else {
        console.log('ERROR:', result.error || 'Unknown error');
      }
    }
  }
}

// Create instance and start listening if this script is run directly
if (require.main === module) {
  const listener = new CalendarListener();
  listener.startListening();
}

module.exports = CalendarListener;