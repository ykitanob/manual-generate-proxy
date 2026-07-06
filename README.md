# Web Guide Auto-Generator

**BH26-6 (BioHackathon Japan 2026-06) Deliverable**  
Authors: Nakatani & Kitano

---

## Overview

This tool **automatically generates operation guides** for complex Web tools using LLMs and displays them directly on the page.

By browsing the target URL through a proxy server, it injects the guide UI without modifying the original page.  
For unknown websites, it automatically crawls the pages, feeds the results to an LLM (Ollama), and generates the guide.  
**[Driver.js](https://driverjs.com/)** is used to display the guides.

```
Browser → Proxy Server → Target Website
                ↓
        Inject Guide UI into HTML
                ↓
        Display steps with Driver.js
```

---

## Quick Start

### 1. Install Dependencies

```bash
cd proxy-server
npm install
```

Python side (for crawling):

```bash
pip install -r requirements.txt
playwright install chromium
```

### 2. Start the Server

```bash
PORT=18080 node proxy-server/server.js
```

### 3. Access via Browser

```
http://localhost:18080
```

Enter the URL, Ollama endpoint, and prompt, then click "Open" to access the page via the proxy.

---

## Features

| Feature | Description |
|---|---|
| Proxy Delivery | Delivers target URLs via HTTP proxy and injects Driver.js guides into HTML |
| Guide Selection for Known Sites | Passes user prompts to an LLM to automatically select the best existing guide |
| Auto-Generation for Unknown Sites | Crawls → Generates guide JSON with LLM → Saves as `guides/{domain}/guide-patterns.json` |
| Session Management | Maintains session state with cookies on the proxy side, allowing browsing while logged in |

---

## System Architecture

```
20260629-navitest/
├── proxy-server/
│   ├── server.js               # Proxy server core (Node.js)
│   ├── package.json            # Deps: ajv, ajv-formats, driver.js
│   ├── guide-selection-prompt.json   # LLM prompt template & home screen UI
│   ├── validate-guide.js       # Schema validation for guide JSON
│   └── static/
│       ├── inject.js           # Guide UI script injected into pages
│       ├── inject.css          # Styles for the guide menu
│       └── interceptor.js      # Redirects fetch / XHR through the proxy
├── guides/
│   ├── nbrc/
│   │   └── guide-patterns.json # Guide definitions for NBRC Microbe List
│   ├── togodx/
│   │   └── guide-patterns.json # Guide definitions for TogoDX
│   ├── nanbyodata/
│   │   └── guide-patterns.json # Guide definitions for Nanbyo Data
│   └── {domain}/              # Auto-generated when opening unknown sites
│       └── guide-patterns.json
├── crawl_pages.py              # Page crawling script using Playwright
├── GUIDE_AUTHORING.md          # Guide JSON authoring specifications
├── guide-package.schema.json   # Guide JSON schema definition
└── requirements.txt            # Python dependencies
```

---

## Auto-Generation Flow (Unknown Sites)

```
1. User enters unknown URL and clicks "Open"
        ↓
2. POST /api/bootstrap-site
        ↓
3. crawl_pages.py --url {URL} --output-dir guides/{domain}/
   Crawls the top page + 1 level of links using Playwright
   → Saves selector_info.json (CSS selector info) and Markdown text
        ↓
4. Construct prompt for LLM (Gemini/Ollama)
   - GUIDE_AUTHORING.md (Specification)
   - Examples of existing guide-patterns.json
   - Crawl results (selector_info.json + .md)
   - User prompt ("What you want to do")
        ↓
5. LLM generates guide-patterns.json (JSON array)
        ↓
6. Saved as guides/{domain}/guide-patterns.json
        ↓
7. Navigate to target URL via proxy and display guide
```

---

## Guide JSON Format

```jsonc
[
  {
    "guideId": "example-first-use",   // Unique identifier (kebab-case)
    "version": 1,
    "locale": "en-US",
    "title": "First Use",
    "description": "Overview of basic operations",
    "steps": [
      {
        "id": "step-1",
        "selector": "#search-input",  // CSS Selector
        "action": "highlight",        // "highlight" | "tooltip" | "complete"
        "title": "Search Box",
        "description": "Enter search terms here."
      }
    ]
  }
]
```

See [GUIDE_AUTHORING.md](GUIDE_AUTHORING.md) for details.

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Home screen (URL input + LLM settings) |
| `/proxy?url={URL}` | GET | Display page via proxy |
| `/api/bootstrap-site` | POST | Crawl unknown site + generate guide |
| `/api/generate-guide` | POST | Select guide via LLM based on user prompt |
| `/api/guides?url={URL}` | GET | Returns list of guides for the target URL |
| `/api/guides/{guideId}` | GET | Returns guide detail JSON |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Server port |
| `GEMINI_API_KEY` | None | Only required if using Gemini API |

When using Ollama, input the URI / model name directly in the browser UI (no environment variables required).

---

## System Requirements

| Item | Requirement |
|---|---|
| Node.js | v18+ |
| Python | 3.9+ |
| Playwright | `playwright install chromium` executed |
| Ollama | Required for auto-generating guides for unknown sites |
| OS | WSL2 (Ubuntu) recommended. Also runs natively on Windows. |

---

## How to Add Registered Sites

1. Create `guides/{site-name}/guide-patterns.json` (manually or via LLM according to the spec)
2. Add the hostname to `SITE_GUIDE_MAP` in `proxy-server/server.js`:

```js
const SITE_GUIDE_MAP = {
  'example.com': 'example',   // ← Add here
};
```

Alternatively, it will be automatically registered when you open the target URL from the browser (Auto-Generation feature).

---

## License

MIT
