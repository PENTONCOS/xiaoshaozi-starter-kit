const { execSync } = require('child_process');
const fs = require('fs');

// 设置Google账户
process.env.GOG_ACCOUNT = 'jpd515327098@gmail.com';

function getTodaysEvents() {
  try {
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const startDate = startOfDay.toISOString();
    const endDate = endOfDay.toISOString();

    // Query Google Calendar for events today
    const result = execSync(`gog calendar events --from "${startDate}" --to "${endDate}" --json`, { 
      encoding: 'utf8',
      timeout: 15000
    });

    return JSON.parse(result);
  } catch (error) {
    console.error("Error fetching calendar events:", error.message);
    return null;
  }
}

function formatEventMessage(events) {
  if (!events || events.length === 0) {
    return null; // Return null if no events, so we don't send a notification
  }

  let message = "早上好！这是您今天的安排：\n\n";
  
  events.forEach((event, index) => {
    const startTime = event.start.dateTime ? 
      new Date(event.start.dateTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : 
      new Date(event.start.date).toLocaleDateString('zh-CN');
    
    const endTime = event.end.dateTime ? 
      new Date(event.end.dateTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : 
      new Date(event.end.date).toLocaleDateString('zh-CN');
    
    message += `${index + 1}. ${event.summary}\n`;
    message += `   时间: ${startTime} - ${endTime}\n`;
    
    if (event.location) {
      message += `   地点: ${event.location}\n`;
    }
    
    if (event.description) {
      message += `   描述: ${event.description.substring(0, 100)}${event.description.length > 100 ? '...' : ''}\n`;
    }
    
    message += "\n";
  });

  return message;
}

// Main execution
const events = getTodaysEvents();
const message = formatEventMessage(events);

if (message) {
  // Write the message to a temporary file that can be read by the system
  fs.writeFileSync('/tmp/todays_schedule.txt', message);
  console.log(message);
} else {
  console.log("今天没有任何日程安排"); // This will be our indicator that there are no events
}