#!/usr/bin/env node

// Script to check Google Calendar for today's events and send reminder if any exist

const { execSync } = require('child_process');
const { format } = require('date-fns');
const { zhCN } = require('date-fns/locale');

// Set the account to use
process.env.GOG_ACCOUNT = 'jpd515327098@gmail.com';

try {
  // Get today's date in ISO format
  const today = new Date();
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const endOfDay = new Date(today.setHours(23, 59, 59, 999));
  
  const startDate = startOfDay.toISOString();
  const endDate = endOfDay.toISOString();

  // Query Google Calendar for events today
  const calendarOutput = execSync(`gog calendar events --from "${startDate}" --to "${endDate}" --json`, { 
    encoding: 'utf8',
    timeout: 10000
  });

  const events = JSON.parse(calendarOutput);

  if (events && events.length > 0) {
    console.log("早上好！您今天有以下安排：");
    events.forEach((event, index) => {
      const startTime = new Date(event.start.dateTime || event.start.date);
      const endTime = new Date(event.end.dateTime || event.end.date);
      
      const startFormatted = format(startTime, 'HH:mm', { locale: zhCN });
      const endFormatted = format(endTime, 'HH:mm', { locale: zhCN });
      
      console.log(`${index + 1}. [${startFormatted}-${endFormatted}] ${event.summary}`);
      
      if (event.location) {
        console.log(`   地点: ${event.location}`);
      }
    });
  } else {
    console.log("今天没有安排任何事件，祝您有美好的一天！");
  }
} catch (error) {
  console.error("检查日历失败:", error.message);
}