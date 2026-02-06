---
name: ddg-search
description: Web search using DuckDuckGo - free, anonymous, no API key required
---

# DuckDuckGo Search (ddg-search)

Use DuckDuckGo for free web search without API keys. Perfect for research, fact-checking, and gathering information.

## When to Use

- User asks to search the web
- Need to find current information
- Research tasks requiring multiple sources
- Fact-checking claims
- Gathering documentation or examples

## Prerequisites

Install the DuckDuckGo search library:

```bash
pip install duckduckgo-search
```

Or use the CLI tool:

```bash
pip install ddgs
```

## Search Methods

### Method 1: Python (Recommended)

```python
from duckduckgo_search import DDGS

def search_ddg(query, max_results=10):
    """Search DuckDuckGo and return results"""
    with DDGS() as ddgs:
        results = []
        for r in ddgs.text(query, max_results=max_results):
            results.append({
                'title': r['title'],
                'href': r['href'],
                'body': r['body']
            })
    return results

# Usage
results = search_ddg("your search query", max_results=5)
for r in results:
    print(f"Title: {r['title']}")
    print(f"URL: {r['href']}")
    print(f"Snippet: {r['body']}")
    print("---")
```

### Method 2: CLI Tool

```bash
# Search and get JSON output
ddgs text -k "your query" -m 5

# Get results with full content
ddgs text -k "python asyncio" -m 10 -o json
```

### Method 3: Async Python

```python
import asyncio
from duckduckgo_search import AsyncDDGS

async def async_search(query, max_results=10):
    async with AsyncDDGS() as ddgs:
        results = []
        async for r in ddgs.text(query, max_results=max_results):
            results.append({
                'title': r['title'],
                'href': r['href'],
                'body': r['body']
            })
    return results

# Usage
results = asyncio.run(async_search("asyncio tutorial"))
```

## Advanced Features

### News Search

```python
from duckduckgo_search import DDGS

with DDGS() as ddgs:
    news_results = list(ddgs.news("AI breakthrough", max_results=5))
    for news in news_results:
        print(f"{news['title']} - {news['source']}")
        print(f"Date: {news['date']}")
        print(f"URL: {news['url']}")
```

### Image Search

```python
from duckduckgo_search import DDGS

with DDGS() as ddgs:
    images = list(ddgs.images("cat", max_results=5))
    for img in images:
        print(f"Image: {img['image']}")
        print(f"Title: {img['title']}")
```

### Chat/AI Answers

```python
from duckduckgo_search import DDGS

with DDGS() as ddgs:
    # Get AI-generated answer
    answer = ddgs.chat("What is quantum computing?")
    print(answer)
```

## Integration Example

```python
from duckduckgo_search import DDGS
import json

def research_topic(topic, num_results=5):
    """Research a topic and return structured results"""
    with DDGS() as ddgs:
        results = list(ddgs.text(topic, max_results=num_results))
        
    formatted = []
    for i, r in enumerate(results, 1):
        formatted.append({
            'index': i,
            'title': r['title'],
            'url': r['href'],
            'summary': r['body'][:200] + '...' if len(r['body']) > 200 else r['body']
        })
    
    return formatted

# Use in your agent workflow
topic = "latest developments in AI"
research = research_topic(topic, num_results=3)
print(json.dumps(research, indent=2, ensure_ascii=False))
```

## Error Handling

```python
from duckduckgo_search import DDGS
from duckduckgo_search.exceptions import DuckDuckGoSearchException

def safe_search(query, max_results=10):
    try:
        with DDGS() as ddgs:
            return list(ddgs.text(query, max_results=max_results))
    except DuckDuckGoSearchException as e:
        print(f"Search error: {e}")
        return []
    except Exception as e:
        print(f"Unexpected error: {e}")
        return []
```

## Rate Limits & Best Practices

- DuckDuckGo is free but has rate limits
- Add delays between searches: `time.sleep(1)`
- Cache results when possible
- Use specific queries for better results
- Respect robots.txt and terms of service

## Common Use Cases

1. **Quick Fact Check**: `search_ddg("Python 3.12 release date", 3)`
2. **Documentation**: `search_ddg("FastAPI documentation tutorial", 5)`
3. **Current Events**: `ddgs.news("technology", max_results=10)`
4. **Code Examples**: `search_ddg("python list comprehension examples", 5)`
5. **Research**: Multiple searches with different keywords

## Troubleshooting

If you get rate limited:
- Wait a few seconds between requests
- Use `time.sleep(2)` between searches
- Try a different network if blocked
- The library automatically retries on some errors

## Related Skills

- `web-search` (inference-sh) - API-based search with Tavily/Exa
- `browser-use` - For visiting and extracting content from URLs
