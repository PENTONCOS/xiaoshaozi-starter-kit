#!/bin/bash

# Simple TODO manager

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
    
    # Update the TODO file
    sed -i.bak "/## 🔴 $priority_section/a\\
- [ ] $item (added: $(date +%Y-%m-%d))" "$TODO_FILE" && rm -f "$TODO_FILE.bak"
    
    echo "Added: $item [$priority priority]"
}

# Mark an item as done
done_item() {
    local pattern=$1
    # Find and replace the first unchecked item matching the pattern
    sed -i.bak "s/- \[ \] $pattern/- [x] $pattern (done: $(date +%Y-%m-%d))/" "$TODO_FILE" && rm -f "$TODO_FILE.bak"
    echo "Marked as done: $pattern"
}

# Remove an item
remove_item() {
    local pattern=$1
    sed -i.bak "/$pattern/d" "$TODO_FILE" && rm -f "$TODO_FILE.bak"
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
    
    grep -A 100 "## 🔴 $priority_section" "$TODO_FILE" | grep -m 10 "## 🔴" | grep -v "## 🔴 $priority_section"
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
        add_item "$2" "$3"
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