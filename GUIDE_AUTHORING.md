# Guide JSON Authoring Specifications

## Overview

This system injects Driver.js-based step navigation into pages via a proxy.
Guide definitions are written in JSON files and loaded during server startup.

---

## File Structure

| File | Target Site |
|---|---|
| `togodx_guide-patterns.json` | TogoDX (https://togodx.dbcls.jp) |
| `guide-patterns.json` | NBRC Microbe List (https://www.nite.go.jp) |

Each file should be written as a **JSON array** of guide objects: `[{...}, {...}]`.

---

## Schema

```jsonc
{
  "guideId": "string",      // Unique identifier (kebab-case recommended)
  "version": 1,             // Schema version (currently fixed at 1)
  "locale": "en-US",        // Locale
  "title": "string",        // Title displayed in the guide selection UI
  "description": "string",  // (Optional) Overview of the guide
  "steps": [ /* Step[] */ ]
}
```

---

## Step Object

```jsonc
{
  "id": "step-N",           // Step identifier (sequential numbering recommended)
  "selector": "string",     // CSS selector (see below)
  "action": "string",       // "highlight" | "tooltip" | "complete"
  "title": "string",        // Title of the popover
  "description": "string",  // Body text of the popover (HTML tags allowed)
  "placement": "string"     // (Optional) "top" | "bottom" | "left" | "right"
}
```

---

## `selector` Field Specifications

The way parameters are passed to Driver.js changes based on the combination of `selector` and `action`.

### Pattern A — Direct Element Specification

```json
"selector": "button[data-testid='result-button'], button[type='submit']",
"action": "highlight"
```

Resolved via `querySelector`, and the found element is highlighted.
Multiple selectors can be specified, separated by commas (the first match takes priority).

### Pattern B — Auto-Resolution from `description` Path (TogoDX Specific)

```json
"selector": "",
"action": "highlight"
```

If `selector` is an empty string and `action: "highlight"`, the target element is determined by parsing the **`『A → B → C』` formatted string** within the `description` field.

Resolution algorithm priority:

| Priority | Target | Matching Method |
|---|---|---|
| 1 | `li.track-filter-view[data-node]`'s `span.label` | Exact / Partial text match |
| 2 | `.attribute-track-view h2.title` | Exact / Partial text match (scoped by `data-category-id`) |
| 3 | `[data-node]` attribute value | Match after normalization (removing spaces, underscores, etc.) |
| 4 | `[title]` / `[aria-label]` attribute values | Partial match |
| 5 | `.label`, `.title`, `span`, `li`, `h2`, `h3`, etc. text | Exact / Partial match |
| Final | `h3[data-category-id="${catId}"]` | Returns the entire category header |

**Path Format Rules:**
- Enclosed in `『』` (double angle brackets)
- Hierarchy separator is ` → ` (arrow with spaces)
- The first element is used as a category hint (e.g., `gene`, `protein`, `disease`)
- Search is performed starting from the **last (most specific) keyword**

```
『Gene → Tissue-specific high expression (HPA) → Lung』
  ↓ Extraction
['Gene', 'Tissue-specific high expression (HPA)', 'Lung']
  ↓ Search Order
Lung → Tissue-specific high expression (HPA) → Gene
```

**Available Aliases (Defined in inject.js):**

| Input | Automatically Added Variants |
|---|---|
| `intestine` | `small intestine` |
| `zebrafish` | `danio rerio` |

### Pattern C — Floating Tooltip (Operation-Allowed Step)

```json
"selector": "",
"action": "tooltip"
```

Does not pass `element` to Driver.js (floating tooltip mode).
No overlay is displayed, allowing interaction with the entire page.
Use this for **steps requiring user interaction**, such as expanding accordions.

### Pattern D — Floating Tooltip (Intro / Completion)

```json
"selector": "body",
"action": "tooltip"   // Or "complete"
```

`selector: "body"` is not treated as a real element selector and results in a Floating Tooltip.
Use this for intro steps before the guide starts or for completion steps.

---

## `action` Field Specification

| Value | Behavior | Usage |
|---|---|---|
| `"highlight"` | Highlight element (with overlay) | Point to a target |
| `"tooltip"` | Floating Tooltip (no overlay) | Description only / Allow user operation |
| `"complete"` | Floating Tooltip (no overlay) | Final guide step |

> **Note:** If `selector` is a valid CSS selector (other than `body` or empty),
> it will always use highlight mode regardless of the `action` value.

---

## "To-do" Step Patterns (TogoDX Specific)

If you want the user to interact with dynamically displayed elements like accordion UIs,
**define an indicator step (highlight) and an operation step (tooltip) as a pair**.

```jsonc
// indicator: Shows the location (highlights the element if visible)
{
  "id": "step-3",
  "selector": "",
  "action": "highlight",
  "title": "Select proteins related to Retinitis pigmentosa",
  "description": "Expand 『Protein → Disease-related proteins → Retinitis pigmentosa』 on the left and check the box."
},
// operation: Allow user operation (releasing interaction via floating tooltip)
{
  "id": "step-3-do",
  "selector": "",
  "action": "tooltip",
  "title": "Select proteins related to Retinitis pigmentosa",
  "description": "Expand 『Protein → Disease-related proteins → Retinitis pigmentosa』 on the left and check the box."
}
```

**Cases where a -do step is required:**
- Items whose choices are not displayed unless an accordion is expanded.
- Elements added to the DOM later via dynamic loading (asynchronous fetch).

**Cases where a -do step is not required:**
- Items where `li.track-filter-view` is already expanded at page load (e.g., Lung in Case1).
- Elements that are always displayed, such as `<select>` or `<button>`.

---

## Guide Template (for TogoDX)

```json
{
  "guideId": "togodx-caseX-search",
  "version": 1,
  "locale": "en-US",
  "title": "CaseX: (Guide Title)",
  "steps": [
    {
      "id": "step-1",
      "selector": "body",
      "action": "tooltip",
      "title": "CaseX Search Guide",
      "description": "(General overview of the guide)"
    },
    {
      "id": "step-2",
      "selector": "select[data-testid='dataset-selector'], select",
      "action": "highlight",
      "title": "Select (Dataset Name)",
      "description": "Select '(Dataset Name)' from the target datasets."
    },
    {
      "id": "step-3",
      "selector": "",
      "action": "highlight",
      "title": "Select (Filter Name)",
      "description": "Expand 『Category → Panel → Item』 on the left and check the box."
    },
    {
      "id": "step-3-do",
      "selector": "",
      "action": "tooltip",
      "title": "Select (Filter Name)",
      "description": "Expand 『Category → Panel → Item』 on the left and check the box."
    },
    {
      "id": "step-N",
      "selector": "button[data-testid='result-button'], button[type='submit']",
      "action": "highlight",
      "title": "Execute Search",
      "description": "Click the 『Result』 button to display the results."
    },
    {
      "id": "step-N+1",
      "selector": "body",
      "action": "complete",
      "title": "Guide Completed",
      "description": "(Completion message)"
    }
  ]
}
```

---

## TogoDX Category and `data-category-id` Mapping

The first element 『A』 in 『A → B → C』 is mapped to the following values (case-insensitive).

| String written in `description` | `data-category-id` |
|---|---|
| `Gene` | `gene` |
| `Protein` | `protein` |
| `Structure` | `structure` |
| `Interaction` | `interaction` |
| `Compound` | `compound` |
| `Glycan` | `glycan` |
| `Disease` | `disease` |
| `Variant` | `variant` |

---

## Validation

Schema validation can be performed with `validate-guide.js` (`proxy-server/validate-guide.js`).

```bash
node proxy-server/validate-guide.js togodx_guide-patterns.json
```

Detects JSON syntax errors and missing mandatory fields (`guideId`, `steps`, `steps[].id`).

---

## New Guide Request: Disease Database (3 User Flows)

We plan to create guides for the following three user flows. Please provide the **CSS selectors** for the target elements in each flow.

### How to Obtain Selectors

Right-click the target element in browser developer tools (F12) and use one of the following:

- **Elements Panel** → Right-click target → `Copy` → `Copy selector`
- HTML source snippets (lines containing `id`, `data-*`, `class`, or `name` attributes)
- Machine-readable attribute values such as `data-testid`, `aria-label`, or `role`

---

### Flow 1 — Searching for a Disease and Viewing the Page

| # | UI Element | Target Selector / Attribute |
|---|---|---|
| 1-1 | Search box on the top page (input) | `selector:` |
| 1-2 | Each search suggestion / autocomplete item | `selector:` |
| 1-3 | Search execution button (if any) | `selector:` |
| 1-4 | Each disease row in the search results list | `selector:` |
| 1-5 | Link to the disease details page (within the result row) | `selector:` |

**Example:**
```
1-1: input#searchBox
1-2: ul.suggest-list li
1-3: button[type="submit"]
```

---

### Flow 2 — Filtering Diseases in the Disease List

| # | UI Element | Target Selector / Attribute |
|---|---|---|
| 2-1 | Navigation to the Disease List page (menu / link) | `selector:` |
| 2-2 | Switching UI for Designated Intractable Diseases / Specific Pediatric Chronic Diseases (radio, tab, etc.) | `selector:` |
| 2-3 | Filtering UI by category or attributes (button groups, select, etc.) | `selector:` |
| 2-4 | Filter apply button (if any) | `selector:` |
| 2-5 | Each disease row in the filtered results | `selector:` |

**Note:** Item 2-4 is unnecessary if filtering is applied in real-time (without clicking a button).

---

### Flow 3 — Downloading Data (NANDO / Gene / Phenotype)

| # | UI Element | Target Selector / Attribute |
|---|---|---|
| 3-1 | Navigation to the download page (menu / link) | `selector:` |
| 3-2 | Download link / button for NANDO data | `selector:` |
| 3-3 | Download link / button for Gene data | `selector:` |
| 3-4 | Download link / button for Phenotype data | `selector:` |
| 3-5 | File format selection UI (if any: CSV / TSV / OWL, etc.) | `selector:` |

---

### How the Provided Information is Used

The provided selectors will be set in the `"selector"` field of each step in `guide-patterns.json` as Pattern A (Direct Element Specification).

```jsonc
// Example: If 1-1 is "input#searchBox"
{
  "id": "step-2",
  "selector": "input#searchBox",   // ← Set here
  "action": "highlight",
  "title": "Enter Disease Name",
  "description": "Please enter the disease name you want to look up in the search box."
}
```

Selectors containing attributes that are unlikely to change, such as `id` or `data-testid`, are the most robust.
Please note that selectors using only class names (e.g., `.btn-primary`) are more likely to break during a site redesign.

---

## File Structure (Updated: 2026-07-02)

Migrated from the old structure (single file in the root) to a site-specific directory structure.

```
guides/
├── nbrc/         guide-patterns.json   ← www.nite.go.jp
├── nanbyodata/   guide-patterns.json   ← nanbyodata.jp
└── togodx/       guide-patterns.json   ← togodx.dbcls.jp
```

Hostnames and directories are mapped in the `SITE_GUIDE_MAP` in `server.js`.  
To add a new site, simply add the hostname to `SITE_GUIDE_MAP` and create a `guides/<site-name>/guide-patterns.json` file.

**How the Guide Selection UI Works:**  
`inject.js` calls the server at `/api/guides?url=<targetUrl>` and displays only the guides corresponding to the site currently being viewed as a list of buttons.  
Unregistered sites will display "No guides available".

---

## Collecting Selector Information Using crawl4AI

The future goal is to automatically generate `guide-patterns.json` from three inputs: "Website Markdown," "JSON Description Rules," and "Human Operation Procedures."  
When using crawl4AI to crawl a website and obtain markdown, standard markdown discards the attribute information necessary for CSS selectors.

### Elements Required for Markdown Output

**Identification Information for HTML Elements (Basis for Selectors)**
- Element `id` attribute (`#tblUList`, `#NANDO`, etc.)
- Element `class` attribute (`.corr`, `.bgroup`, `.lpsn`, etc.)
- Element tag name (`input`, `button`, `table`, `tr`, `a`, etc.)

**Attribute Information (Filtering conditions for selectors)**
- `<a>`'s `href` value (for partial match patterns)
- `<input>`'s `type` attribute (`text`, `checkbox`, `submit`, etc.)
- `<input>`'s `placeholder` text
- `<button>`'s `type` attribute
- `role` attribute (`role="checkbox"`, etc.)

**Page Structure and Hierarchy**
- Correlation between section headings (H1-H3) and subordinate elements
- Navigation menu items and target URLs
- Group structure of form elements
- Composition of table headers (`thead`) and data rows (`tbody`)

**Labels for Interactive Elements**
- Display text for buttons and links
- Mapping between form labels and `input` fields
- Column header text of tables

**Supplementary Information (For improving selector precision)**
- Element appearance order/position (for generating `:nth-child`)
- Relationship with parent elements (for descendant selectors)
- `data-*` custom attributes

### Recommended Approaches

1. **Use Raw HTML** — In addition to crawl4AI's `fit_markdown`, obtain the raw HTML to preserve attribute information.
2. **Output as a Structured List** — Separately output a list of interactive elements (links, buttons, forms) with their attributes.
3. **Embed Metadata Blocks in Markdown** — Record `id`/`class` as HTML comments or YAML front matter.

---

## Common Errors and Precautions

### Incorrect Field Name: `"element"` vs `"selector"`

The correct field for specifying elements in a Step object is **`"selector"`**.  
If `"element"` is used, `step.selector` will be undefined on the server, causing the guide to fall back to an empty selector equivalent to `document.querySelector('')`, which results in highlighting the body.

```jsonc
// NG — Not recognized by inject.js
{ "id": "go-bacteria", "element": "#menu > li:nth-child(1) > a", "action": "highlight" }

// OK
{ "id": "go-bacteria", "selector": "#menu > li:nth-child(1) > a", "action": "highlight" }
```

### Robustness of Selectors

| Priority | Example Selector | Reason |
|---|---|---|
| High | `#tblUList`, `input#NANDO` | id is unlikely to change |
| High | `a[href='/mrinda/list/crossLink']` | Static URLs are stable |
| Medium | `input[type='text']`, `button[type='submit']` | Attribute values are relatively stable |
| Low | `.btn-primary`, `div.content > p:nth-child(3)` | Class names and positions break during redesigns |

### Behavior When `selector` is an Empty String

- `selector: ""` + `action: "highlight"` → Resolves element via the 『...』 path in the `description` (TogoDX specific)
- `selector: ""` + `action: "tooltip"` → Floating Tooltip (Page is interactable)
- `selector: "body"` → Treated as a Floating Tooltip regardless of the `action`

### Verifying JSON Syntax

Guide files must be in the array format: `[{...}, {...}]`.  
Trailing commas, single quotes, and comments (`//`) are all invalid JSON.  
Perform schema validation using `node proxy-server/validate-guide.js <file-path>`.
