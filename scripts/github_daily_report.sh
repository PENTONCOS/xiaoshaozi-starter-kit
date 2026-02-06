#!/bin/bash

# 获取当前日期用于文件命名
DATE=$(date +%Y-%m-%d)
REPORT_PATH="/Users/cospeyton/Desktop/daily-briefs/独立开发者简报-$DATE.md"

# 创建报告目录（如果不存在）
mkdir -p /Users/cospeyton/Desktop/daily-briefs

echo "# 🇨🇳 中国独立开发者项目周报" > "$REPORT_PATH"
echo "" >> "$REPORT_PATH"
echo "**生成时间：** $(date)" >> "$REPORT_PATH"
echo "**数据来源：** https://github.com/1c7/chinese-independent-developer" >> "$REPORT_PATH"
echo "" >> "$REPORT_PATH"
echo "---" >> "$REPORT_PATH"
echo "" >> "$REPORT_PATH"

# 检查是否已克隆仓库
if [ -d "/tmp/chinese-independent-developer" ]; then
    echo "## 📊 项目概览" >> "$REPORT_PATH"
    echo "" >> "$REPORT_PATH"
    echo "这份报告整理了最近六个月（2025年8月至$(date +%Y年%m月)）中国独立开发者提交的项目。这些项目涵盖了AI工具、图像处理、视频生成、效率工具、游戏等多个领域。" >> "$REPORT_PATH"
    echo "" >> "$REPORT_PATH"

    # 提取2026年的项目
    if grep -q "2026 年" /tmp/chinese-independent-developer/README.md; then
        echo "## 📈 最新项目 (2026年2月)" >> "$REPORT_PATH"
        echo "" >> "$REPORT_PATH"
        
        # 提取2026年2月的项目
        if grep -q "### 2026 年 2 月" /tmp/chinese-independent-developer/README.md; then
            echo "### 🎯 本周亮点项目" >> "$REPORT_PATH"
            echo "" >> "$REPORT_PATH"
            echo "| 日期 | 开发者 | 项目名称 | 领域 | 简介 | 项目链接 | 更多信息 |" >> "$REPORT_PATH"
            echo "|------|--------|----------|------|------|----------|----------|" >> "$REPORT_PATH"
            
            # 使用grep和sed提取2026年2月的项目
            # 先提取包含项目信息的部分
            temp_file="/tmp/feb_projects.tmp"
            > "$temp_file"
            
            # 提取2月5日的项目
            awk '/^### 2026 年 2 月 5 号添加/,/^### 2026 年 2 月 [0-9]+ 号添加|## 2025|### 2026 年 1 月|### 2026 年 3 月|### 2026 年 4 月|### 2026 年 5 月|### 2026 年 6 月|### 2026 年 7 月|### 2026 年 8 月|### 2026 年 9 月|### 2026 年 10 月|### 2026 年 11 月|### 2026 年 12 月/' /tmp/chinese-independent-developer/README.md > "$temp_file"
            
            # 处理每个项目
            awk '
            BEGIN { current_date="2月5日"; developer="" }
            /^#### / {
                gsub(/^#### /, "")
                gsub(/ - \[.*\].*/, "")  # 移除 [Github]、[博客] 等链接
                gsub(/\(.*\)/, "")       # 移除括号内的内容
                gsub(/ $/, "")
                gsub(/^ */, "")
                developer = $0
                next;
            }
            /^\* :white_check_mark:/ {
                # 提取项目链接和名称
                if (match($0, /\[([^\]]+)\]\(([^)]+)\)/)) {
                    project_name = substr($0, RSTART+1, RLENGTH-2)
                    project_url = substr($0, RSTART+RLENGTH+1, index(substr($0, RSTART+RLENGTH+1), ")")-1)
                    
                    # 提取描述
                    desc_part = substr($0, RSTART + RLENGTH)
                    colon_pos = index(desc_part, "：")
                    if (colon_pos > 0) {
                        description = substr(desc_part, colon_pos + 2)
                    } else {
                        description = desc_part
                    }
                    
                    # 检查是否有更多信息链接
                    additional_info = ""
                    if (match(description, /-\ \[更多介绍\]\(([^)]+)\)/)) {
                        additional_info = substr(description, RSTART+1, index(description, ")")-RSTART-1)
                        description = substr(description, 1, RSTART-2)
                    }
                    
                    # 确定领域
                    category = "其他"
                    if (description ~ /AI|人工智能|智能|ai/ || project_name ~ /AI|ai|智能/) {
                        category = "AI"
                    } else if (description ~ /图片|图像|photo|image/ || project_name ~ /图片|图像|photo|image/) {
                        category = "图像处理"
                    } else if (description ~ /视频|video/ || project_name ~ /视频|video/) {
                        category = "视频"
                    } else if (description ~ /工具|tool|效率|效率/ || project_name ~ /工具|tool|效率/) {
                        category = "效率工具"
                    }
                    
                    printf("| %s | **%s** | [%s](%s) | %s | %s | [🔗](%s) | %s |\n", current_date, developer, project_name, project_url, category, description, project_url, (additional_info != "" ? "[🔗](" additional_info ")" : ""))
                }
            }
            ' "$temp_file" >> "$REPORT_PATH"
            
            # 提取2月3日的项目
            temp_file3="/tmp/feb3_projects.tmp"
            > "$temp_file3"
            awk '/^### 2026 年 2 月 3 号添加/,/^### 2026 年 2 月 [0-9]+ 号添加|## 2025|### 2026 年 1 月|### 2026 年 3 月|### 2026 年 4 月|### 2026 年 5 月|### 2026 年 6 月|### 2026 年 7 月|### 2026 年 8 月|### 2026 年 9 月|### 2026 年 10 月|### 2026 年 11 月|### 2026 年 12 月/' /tmp/chinese-independent-developer/README.md > "$temp_file3"
            
            awk '
            BEGIN { current_date="2月3日"; developer="" }
            /^#### / {
                gsub(/^#### /, "")
                gsub(/ - \[.*\].*/, "")  # 移除 [Github]、[博客] 等链接
                gsub(/\(.*\)/, "")       # 移除括号内的内容
                gsub(/ $/, "")
                gsub(/^ */, "")
                developer = $0
                next;
            }
            /^\* :white_check_mark:/ {
                # 提取项目链接和名称
                if (match($0, /\[([^\]]+)\]\(([^)]+)\)/)) {
                    project_name = substr($0, RSTART+1, RLENGTH-2)
                    project_url = substr($0, RSTART+RLENGTH+1, index(substr($0, RSTART+RLENGTH+1), ")")-1)
                    
                    # 提取描述
                    desc_part = substr($0, RSTART + RLENGTH)
                    colon_pos = index(desc_part, "：")
                    if (colon_pos > 0) {
                        description = substr(desc_part, colon_pos + 2)
                    } else {
                        description = desc_part
                    }
                    
                    # 检查是否有更多信息链接
                    additional_info = ""
                    if (match(description, /-\ \[更多介绍\]\(([^)]+)\)/)) {
                        additional_info = substr(description, RSTART+1, index(description, ")")-RSTART-1)
                        description = substr(description, 1, RSTART-2)
                    }
                    
                    # 确定领域
                    category = "其他"
                    if (description ~ /AI|人工智能|智能|ai/ || project_name ~ /AI|ai|智能/) {
                        category = "AI"
                    } else if (description ~ /图片|图像|photo|image/ || project_name ~ /图片|图像|photo|image/) {
                        category = "图像处理"
                    } else if (description ~ /视频|video/ || project_name ~ /视频|video/) {
                        category = "视频"
                    } else if (description ~ /工具|tool|效率|效率/ || project_name ~ /工具|tool|效率/) {
                        category = "效率工具"
                    }
                    
                    printf("| %s | **%s** | [%s](%s) | %s | %s | [🔗](%s) | %s |\n", current_date, developer, project_name, project_url, category, description, project_url, (additional_info != "" ? "[🔗](" additional_info ")" : ""))
                }
            }
            ' "$temp_file3" >> "$REPORT_PATH"
            
            # 提取2月2日的项目
            temp_file2="/tmp/feb2_projects.tmp"
            > "$temp_file2"
            awk '/^### 2026 年 2 月 2 号添加/,/^### 2026 年 2 月 [0-9]+ 号添加|## 2025|### 2026 年 1 月|### 2026 年 3 月|### 2026 年 4 月|### 2026 年 5 月|### 2026 年 6 月|### 2026 年 7 月|### 2026 年 8 月|### 2026 年 9 月|### 2026 年 10 月|### 2026 年 11 月|### 2026 年 12 月/' /tmp/chinese-independent-developer/README.md > "$temp_file2"
            
            awk '
            BEGIN { current_date="2月2日"; developer="" }
            /^#### / {
                gsub(/^#### /, "")
                gsub(/ - \[.*\].*/, "")  # 移除 [Github]、[博客] 等链接
                gsub(/\(.*\)/, "")       # 移除括号内的内容
                gsub(/ $/, "")
                gsub(/^ */, "")
                developer = $0
                next;
            }
            /^\* :white_check_mark:/ {
                # 提取项目链接和名称
                if (match($0, /\[([^\]]+)\]\(([^)]+)\)/)) {
                    project_name = substr($0, RSTART+1, RLENGTH-2)
                    project_url = substr($0, RSTART+RLENGTH+1, index(substr($0, RSTART+RLENGTH+1), ")")-1)
                    
                    # 提取描述
                    desc_part = substr($0, RSTART + RLENGTH)
                    colon_pos = index(desc_part, "：")
                    if (colon_pos > 0) {
                        description = substr(desc_part, colon_pos + 2)
                    } else {
                        description = desc_part
                    }
                    
                    # 检查是否有更多信息链接
                    additional_info = ""
                    if (match(description, /-\ \[更多介绍\]\(([^)]+)\)/)) {
                        additional_info = substr(description, RSTART+1, index(description, ")")-RSTART-1)
                        description = substr(description, 1, RSTART-2)
                    }
                    
                    # 确定领域
                    category = "其他"
                    if (description ~ /AI|人工智能|智能|ai/ || project_name ~ /AI|ai|智能/) {
                        category = "AI"
                    } else if (description ~ /图片|图像|photo|image/ || project_name ~ /图片|图像|photo|image/) {
                        category = "图像处理"
                    } else if (description ~ /视频|video/ || project_name ~ /视频|video/) {
                        category = "视频"
                    } else if (description ~ /工具|tool|效率|效率/ || project_name ~ /工具|tool|效率/) {
                        category = "效率工具"
                    }
                    
                    printf("| %s | **%s** | [%s](%s) | %s | %s | [🔗](%s) | %s |\n", current_date, developer, project_name, project_url, category, description, project_url, (additional_info != "" ? "[🔗](" additional_info ")" : ""))
                }
            }
            ' "$temp_file2" >> "$REPORT_PATH"
            
            # 清理临时文件
            rm -f "$temp_file" "$temp_file2" "$temp_file3"
        fi
        
        # 提取其他2026年项目（1月）
        if grep -q "### 2026 年 1 月" /tmp/chinese-independent-developer/README.md; then
            echo "### 2026年1月新增项目" >> "$REPORT_PATH"
            echo "" >> "$REPORT_PATH"
            
            # 提取1月的项目
            awk '
            BEGIN { in_section=0; current_date=""; developer="" }
            /^### 2026 年 1 月/ { 
                in_section=1;
                next 
            }
            /^### 2026 年/ && !/^### 2026 年 1 月/ { in_section=0; exit }
            /^### 2025 年/ { in_section=0; exit }
            in_section { 
                if (/^#### /) {
                    gsub(/^#### /, "")
                    gsub(/ - \[.*\].*/, "")
                    gsub(/\(.*\)/, "")
                    gsub(/ $/, "")
                    gsub(/^ */, "")
                    developer = $0
                } else if (/^\* :white_check_mark:/) {
                    if (match($0, /\[([^\]]+)\]\(([^)]+)\)/)) {
                        project_name = substr($0, RSTART+1, RLENGTH-2)
                        project_url = substr($0, RSTART+RLENGTH+1, index(substr($0, RSTART+RLENGTH+1), ")")-1)
                        
                        desc_part = substr($0, RSTART + RLENGTH)
                        colon_pos = index(desc_part, "：")
                        if (colon_pos > 0) {
                            description = substr(desc_part, colon_pos + 2)
                        } else {
                            description = desc_part
                        }
                        
                        print "* **" developer "** - [" project_name "](" project_url ")： " description
                    }
                } else if ($0 ~ /^[^*#]/ && $0 != "" && $0 !~ /^#### /) {
                    print $0
                }
            }
            ' /tmp/chinese-independent-developer/README.md >> "$REPORT_PATH"
            echo "" >> "$REPORT_PATH"
        fi
    fi

    # 提取2025年项目
    for month in {12..8}; do  # From December to August 2025
        if grep -q "### 2025 年 $month 月" /tmp/chinese-independent-developer/README.md; then
            echo "## 2025年$month 月新增项目" >> "$REPORT_PATH"
            echo "" >> "$REPORT_PATH"
            
            # 使用awk提取特定月份的内容
            awk -v m="$month" '
            BEGIN { in_section=0; developer="" }
            /^### 2025 年 '"$month"' 月/ { 
                in_section=1; 
                next 
            }
            /^### 2025 年/ && !/^### 2025 年 '"$month"' 月/ { in_section=0; exit }
            /^### 2026 年/ { in_section=0; exit }
            in_section { 
                if (/^#### /) {
                    gsub(/^#### /, "")
                    gsub(/ - \[.*\].*/, "")
                    gsub(/\(.*\)/, "")
                    gsub(/ $/, "")
                    gsub(/^ */, "")
                    developer = $0
                } else if (/^\* :white_check_mark:/) {
                    if (match($0, /\[([^\]]+)\]\(([^)]+)\)/)) {
                        project_name = substr($0, RSTART+1, RLENGTH-2)
                        project_url = substr($0, RSTART+RLENGTH+1, index(substr($0, RSTART+RLENGTH+1), ")")-1)
                        
                        desc_part = substr($0, RSTART + RLENGTH)
                        colon_pos = index(desc_part, "：")
                        if (colon_pos > 0) {
                            description = substr(desc_part, colon_pos + 2)
                        } else {
                            description = desc_part
                        }
                        
                        print "* **" developer "** - [" project_name "](" project_url ")： " description
                    }
                } else if ($0 ~ /^[^*#]/ && $0 != "" && $0 !~ /^#### /) {
                    print $0
                }
            }
            ' /tmp/chinese-independent-developer/README.md >> "$REPORT_PATH"
            echo "" >> "$REPORT_PATH"
        fi
    done
    
    # 添加项目特点分析
    echo "## 🔥 热门技术领域" >> "$REPORT_PATH"
    echo "" >> "$REPORT_PATH"
    echo "### 🤖 AI 图像与视频生成" >> "$REPORT_PATH"
    echo "- **Nano Banana系列**：多家公司推出基于该模型的图像生成工具" >> "$REPORT_PATH"
    echo "- **Sora2相关**：多个视频生成平台涌现" >> "$REPORT_PATH"
    echo "- **AI图片编辑**：图像转绘、风格化、去水印等工具" >> "$REPORT_PATH"
    echo "" >> "$REPORT_PATH"
    
    echo "### ⚡ 效率工具" >> "$REPORT_PATH"
    echo "- **截图与格式转换**：页面截图、格式转换等便捷工具" >> "$REPORT_PATH"
    echo "- **文件传输**：P2P文件传输、云端存储等" >> "$REPORT_PATH"
    echo "- **开发辅助**：代码转换、文档生成等" >> "$REPORT_PATH"
    echo "" >> "$REPORT_PATH"
    
    echo "### 🎵 AI 语音" >> "$REPORT_PATH"
    echo "- **声音克隆**：高度仿真的语音克隆服务" >> "$REPORT_PATH"
    echo "- **文本转语音**：多语种、多音色的TTS服务" >> "$REPORT_PATH"
    echo "- **语音助手**：集成化的语音交互解决方案" >> "$REPORT_PATH"
    echo "" >> "$REPORT_PATH"

else
    # 如果没有克隆仓库，使用之前的方案
    echo "## 状态" >> "$REPORT_PATH"
    echo "" >> "$REPORT_PATH"
    echo "仓库尚未克隆，无法获取最新项目信息。" >> "$REPORT_PATH"
    echo "" >> "$REPORT_PATH"
    echo "Repository appears to be the '中国独立开发者项目列表' (Chinese Independent Developer Project List)" >> "$REPORT_PATH"
    echo "Purpose: Sharing what Chinese developers are working on" >> "$REPORT_PATH"
fi

echo "---" >> "$REPORT_PATH"
echo "**报告生成时间：** $(date)" >> "$REPORT_PATH"
echo "**数据来源：** https://github.com/1c7/chinese-independent-developer" >> "$REPORT_PATH"

echo "报告已生成到: $REPORT_PATH"