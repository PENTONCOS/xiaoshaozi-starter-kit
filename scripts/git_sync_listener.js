const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

class GitSyncListener {
  constructor() {
    this.handlerScript = '/Users/cospeyton/my-assistant/scripts/git_sync_handler.js';
    this.gitSyncScript = '/Users/cospeyton/my-assistant/scripts/git-sync.sh';
    this.repoDir = '/Users/cospeyton/my-assistant';
    this.logFile = '/Users/cospeyton/my-assistant/logs/git_sync_listener.log';
    this.watcher = null;
    this.shouldExit = false;

    // 确保日志目录存在
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.setupGracefulShutdown();
  }

  setupGracefulShutdown() {
    process.on('SIGINT', () => {
      console.log('Received SIGINT, shutting down gracefully...');
      this.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('Received SIGTERM, shutting down gracefully...');
      this.stop();
      process.exit(0);
    });
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(this.logFile, logMessage);
    console.log(logMessage.trim());
  }

  executeHandler() {
    this.log('Executing git sync handler script...');
    
    const startTime = Date.now();
    
    exec(`node "${this.handlerScript}"`, (error, stdout, stderr) => {
      const duration = Date.now() - startTime;
      
      if (error) {
        this.log(`Error executing handler: ${error.message} (took ${duration}ms)`);
        return;
      }
      
      this.log(`Handler executed successfully (took ${duration}ms)`);
      if (stdout) this.log(`STDOUT: ${stdout}`);
      if (stderr) this.log(`STDERR: ${stderr}`);
    });
  }

  async start() {
    this.log('Starting Git Sync Listener...');

    // 检查必要的文件是否存在
    if (!fs.existsSync(this.handlerScript)) {
      this.log(`ERROR: Handler script does not exist at ${this.handlerScript}`);
      return;
    }

    if (!fs.existsSync(this.gitSyncScript)) {
      this.log(`ERROR: Git sync script does not exist at ${this.gitSyncScript}`);
      return;
    }

    // 使用 fs.watch 来监听目录变化
    // 这样可以监听到对 git-sync.sh 脚本的执行或其他文件的更改
    try {
      this.watcher = fs.watch(this.repoDir, { recursive: true }, (eventType, filename) => {
        // 监听文件系统变化，特别是可能触发同步的情况
        if (eventType === 'change' || eventType === 'rename') {
          // 检查是否是重要的文件变化
          if (filename && (
            filename.endsWith('.md') || 
            filename.endsWith('.js') || 
            filename.endsWith('.sh') || 
            filename.endsWith('.json') ||
            filename === 'git-sync.sh'
          )) {
            this.log(`Detected change in: ${filename}, triggering sync handler...`);
            
            // 延迟执行以避免频繁触发
            setTimeout(() => {
              this.executeHandler();
            }, 1000);
          }
        }
      });

      this.log(`Now watching directory: ${this.repoDir}`);

      // 监听系统日志中的相关事件，或者监听脚本的执行
      // 我们可以通过监控脚本的时间戳变化来检测其执行
      let lastGitSyncScriptModTime = 0;
      if (fs.existsSync(this.gitSyncScript)) {
        const stats = fs.statSync(this.gitSyncScript);
        lastGitSyncScriptModTime = stats.mtime.getTime();
      }

      // 定期检查 git-sync.sh 脚本的修改时间以及进程
      setInterval(() => {
        if (this.shouldExit) return;
        
        // 检查 git-sync.sh 文件的修改时间
        if (fs.existsSync(this.gitSyncScript)) {
          const stats = fs.statSync(this.gitSyncScript);
          const currentModTime = stats.mtime.getTime();
          
          if (currentModTime > lastGitSyncScriptModTime) {
            this.log(`Detected execution/modification of ${this.gitSyncScript}, triggering sync handler...`);
            lastGitSyncScriptModTime = currentModTime;
            this.executeHandler();
          }
        }
        
        // 同时也检查进程列表中是否有git-sync.sh脚本在运行
        exec('ps aux', (error, stdout, stderr) => {
          if (error) {
            return;
          }

          // 检查是否有git-sync.sh脚本正在运行
          if (stdout.includes(this.gitSyncScript)) {
            this.log(`Detected execution of ${this.gitSyncScript}, triggering sync handler...`);
            this.executeHandler();
          }
        });
      }, 3000); // 每3秒检查一次

      this.log('Git Sync Listener started successfully!');
    } catch (err) {
      this.log(`Error setting up watcher: ${err.message}`);
    }
  }

  stop() {
    this.shouldExit = true;
    
    if (this.watcher) {
      this.watcher.close();
      this.log('File watcher closed.');
    }
    
    this.log('Git Sync Listener stopped.');
  }
}

// 创建并启动监听器
const listener = new GitSyncListener();

// 启动监听器
listener.start();

module.exports = GitSyncListener;