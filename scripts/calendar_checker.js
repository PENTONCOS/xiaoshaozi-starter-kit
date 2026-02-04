const { execSync } = require('child_process');

// 当收到系统事件时执行此脚本
function checkAndRemind() {
  try {
    // 设置Google账户
    process.env.GOG_ACCOUNT = 'jpd515327098@gmail.com';
    
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const startDate = startOfDay.toISOString();
    const endDate = endOfDay.toISOString();

    // 查询今天的日历事件
    const result = execSync(`gog calendar events --from "${startDate}" --to "${endDate}" --json`, { 
      encoding: 'utf8',
      timeout: 15000
    });

    const events = JSON.parse(result);

    if (events && Array.isArray(events) && events.length > 0) {
      let message = "早上好！这是您今天的安排：\n\n";
      
      events.forEach((event, index) => {
        const startTime = event.start.dateTime ? 
          new Date(event.start.dateTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : 
          new Date(event.start.date).toLocaleDateString('zh-CN');
        
        const endTime = event.end.dateTime ? 
          new Date(event.end.dateTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : 
          new Date(event.end.date).toLocaleDateString('zh-CN');
        
        message += `${index + 1}. 【${startTime}】 ${event.summary}\n`;
        
        if (event.location) {
          message += `   📍 ${event.location}\n`;
        }
        
        message += "\n";
      });

      // 输出消息供OpenClaw处理
      console.log(message);
      return message;
    } else {
      // 如果没有事件，输出特殊标记
      console.log("[NO_EVENTS_TODAY]");
      return null;
    }
  } catch (error) {
    console.error("检查日历时出错:", error.message);
    console.log(`今日提醒检查失败: ${error.message}`);
    return null;
  }
}

// 执行检查
checkAndRemind();