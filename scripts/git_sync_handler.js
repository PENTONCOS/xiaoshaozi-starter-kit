const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function handleGitSync() {
  try {
    const repoDir = '/Users/cospeyton/my-assistant';
    
    // 切换到仓库目录
    process.chdir(repoDir);
    
    // 检查是否有git初始化
    if (!fs.existsSync(path.join(repoDir, '.git'))) {
      console.log('目录未初始化为Git仓库，正在初始化...');
      execSync('git init', { stdio: 'pipe' });
      execSync('git remote add origin https://github.com/cospeyton/my-assistant.git || true', { stdio: 'pipe' }); // 假设远程仓库URL
      execSync('git checkout -b main || true', { stdio: 'pipe' });
    }
    
    // 检查是否有更改
    const statusResult = execSync('git status --porcelain', { encoding: 'utf8' });
    
    if (statusResult.trim() !== '') {
      console.log('检测到更改，正在同步到Git...');
      
      // 添加所有更改
      execSync('git add .', { stdio: 'pipe' });
      
      // 设置git配置（如果尚未设置）
      try {
        execSync('git config user.name', { stdio: 'pipe' });
      } catch (e) {
        execSync('git config user.name "OpenClaw Assistant"', { stdio: 'pipe' });
      }
      
      try {
        execSync('git config user.email', { stdio: 'pipe' });
      } catch (e) {
        execSync('git config user.email "opencalw@example.com"', { stdio: 'pipe' });
      }
      
      // 提交更改
      const commitMessage = `自动同步: ${new Date().toISOString().replace('T', ' ').substring(0, 19)}`;
      execSync(`git commit -m "${commitMessage}"`, { stdio: 'pipe' });
      
      // 推送更改（如果远程存在）
      try {
        execSync('git push origin main', { stdio: 'pipe' });
        console.log('同步完成');
      } catch (pushErr) {
        console.log('推送失败，可能是远程仓库未设置或无权访问');
        console.log('本地提交已保存');
      }
    } else {
      console.log('没有更改需要同步');
    }
  } catch (error) {
    console.error('Git同步过程中出现错误:', error.message);
  }
}

// 执行同步
handleGitSync();