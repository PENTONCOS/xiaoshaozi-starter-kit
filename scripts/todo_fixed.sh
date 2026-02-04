#!/bin/bash

# Simple TODO manager for macOS

TODO_FILE="/Users/cospeyton/my-assistant/TODO.md"

# Initialize TODO file if it doesn't exist
init_todo_file() {
    if [ ! -f "$TODO_FILE" ]; then
        echo "# TODO - Scratch Pad

*Last updated: $(date +%Y-%m-%d)*

## 🔴 High Priority

## 🟡 Medium Priority

## 🟢 Low Priority

## ✅ Done
" > "$TODO_FILE"
    fi
}

# Add a new todo item
add_item() {
    local priority=$1
    local item=$2
    local priority_section
    
    case $priority in
        high) priority_section="High Priority" ;;
        medium) priority_section="Medium Priority" ;;
        low) priority_section="Low Priority" ;;
        *) priority_section="Medium Priority" ;;
    esac
    
    # Create a temporary file with the new content
    local temp_file=$(mktemp)
    
    # Copy the original file, inserting the new item in the correct section
    awk -v item="$item" -v date="$(date +%Y-%m-%d)" -v section="## $priority_section" '
    {
        print $0
        if ($0 ~ "^## " && $0 ~ priority_section) {
            # Find the line after the section header
            getline next_line
            while (next_line ~ /^$/) {
                print next_line
                getline next_line
            }
            # Insert the new item before the next section or at the end of section
            print "- [ ] " item " (added: " date ")"
            print next_line
            next
        }
    }' priority_section="$priority_section" "$TODO_FILE" > "$temp_file"
    
    # Move temp file to original location
    mv "$temp_file" "$TODO_FILE"
    
    echo "Added: $item [$priority priority]"
}

# Alternative add_item function for macOS using sed
add_item_macos() {
    local priority=$1
    local item=$2
    local priority_section
    
    case $priority in
        high) priority_section="High Priority" ;;
        medium) priority_section="Medium Priority" ;;
        low) priority_section="Low Priority" ;;
        *) priority_section="Medium Priority" ;;
    esac
    
    # For macOS, we need to add content differently
    local temp_file=$(mktemp)
    
    # Read the file and insert the new item in the correct section
    sed -e "/## 🔴 $priority_section/r /dev/stdin" "$TODO_FILE" <<<"- [ ] $item (added: $(date +%Y-%m-%d))" > "$temp_file" 2>/dev/null || {
        # Fallback approach: append to the correct section
        cp "$TODO_FILE" "$temp_file"
        
        # Find the section and append the item after it
        local section_pos=$(grep -n "## 🔴 $priority_section" "$temp_file" | cut -d: -f1)
        if [ -n "$section_pos" ]; then
            sed -i '' "${section_pos}a\\
- [ ] $item (added: $(date +%Y-%m-%d))
" "$temp_file"
        fi
    }
    
    mv "$temp_file" "$TODO_FILE"
    echo "Added: $item [$priority priority]"
}

# Mark an item as done
done_item() {
    local pattern=$1
    # Find and replace the first unchecked item matching the pattern
    sed -i '' "s/- \[ \] *$pattern/- [x] $pattern (done: $(date +%Y-%m-%d))/" "$TODO_FILE"
    echo "Marked as done: $pattern"
}

# Remove an item
remove_item() {
    local pattern=$1
    sed -i '' "/$pattern/d" "$TODO_FILE"
    echo "Removed: $pattern"
}

# List items by priority
list_items() {
    local priority=$1
    local priority_section
    
    case $priority in
        high) priority_section="High Priority" ;;
        medium) priority_section="Medium Priority" ;;
        low) priority_section="Low Priority" ;;
        *) priority_section="Priority" ;;
    esac
    
    sed -n "/## 🔴 $priority_section/,/^## /p" "$TODO_FILE" | head -n -1
}

# Show summary
summary() {
    local high_count=$(grep -c "## 🔴 High Priority" "$TODO_FILE")
    local medium_count=$(grep -c "## 🟡 Medium Priority" "$TODO_FILE") 
    local low_count=$(grep -c "## 🟢 Low Priority" "$TODO_FILE")
    echo "TODO Summary: $high_count high, $medium_count medium, $low_count low priority items"
}

# Main logic
init_todo_file

case "$1" in
    add)
        add_item_macos "$2" "$3"
        ;;
    done)
        done_item "$2"
        ;;
    remove)
        remove_item "$2"
        ;;
    list)
        list_items "$2"
        ;;
    summary)
        summary
        ;;
    *)
        echo "Usage: $0 {add|done|remove|list|summary} [priority/item]"
        ;;
esac