# MD Reader - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

---

## 📋 Introduction

"Today I'll design MD Reader, a Progressive Web App for editing and previewing Markdown in the browser. This is a client-focused challenge where we need to balance editor performance, real-time preview rendering, and offline-first architecture. Let me start by clarifying the requirements."

---

## 🎯 Requirements

### Functional Requirements

- Rich text editor with Markdown syntax highlighting
- Live preview rendering as the user types
- Multiple view modes: editor-only, preview-only, split view
- Document management with auto-save to local storage
- Light and dark theme support
- PWA installation for offline use

### Non-Functional Requirements

- Preview updates within 150ms of typing pause
- Smooth handling of 10,000+ line documents
- Keyboard accessibility and screen reader support
- Full functionality without network connection

### Scale Estimates

- Average document size: 10KB, maximum: 500KB
- Typing rate: 5-10 keystrokes per second during active editing
- Up to 100 documents stored locally per user

---

## 🏗️ High-Level Design

"Let me sketch the overall application layout on the whiteboard."

```
+------------------------------------------------------------------+
|                       Application Shell                           |
+------------------------------------------------------------------+
|  Toolbar                                                          |
|  +-------------------------------------------------------------+  |
|  | [New] [Import] [Export]  |  [Theme]  |  [Edit|Split|View]   |  |
|  +-------------------------------------------------------------+  |
+------------------------------------------------------------------+
|  Document Selector                                                |
|  +-------------------------------------------------------------+  |
|  | [Dropdown: Document Title]                      [Delete]    |  |
|  +-------------------------------------------------------------+  |
+------------------------------------------------------------------+
|  View Container                                                   |
|  +---------------------------+-------------------------------+    |
|  |                           |                               |    |
|  |      Code Editor          |       Preview Pane            |    |
|  |                           |                               |    |
|  |  - Syntax highlighting    |  - Rendered HTML              |    |
|  |  - Line numbers           |  - Sanitized output           |    |
|  |  - Virtual scrolling      |  - Scroll synchronized        |    |
|  |                           |                               |    |
|  +---------------------------+-------------------------------+    |
+------------------------------------------------------------------+
```

"The architecture has three main layers: the application shell with toolbar and document management, the dual-pane view container, and the underlying data layer using IndexedDB for persistence."

---

## 🔍 Deep Dive

### 1. Code Editor Selection

"The first major decision is choosing a code editor. Let me compare the options."

#### Why Monaco Over CodeMirror?

| Factor | Monaco | CodeMirror 6 | Plain Textarea | Winner |
|--------|--------|--------------|----------------|--------|
| Bundle size | ~2MB | ~400KB | 0 | Textarea |
| Syntax highlighting | Excellent | Good | None | Monaco |
| Large file handling | Virtual scrolling | Virtual scrolling | Poor | Tie |
| VS Code familiarity | Identical | Similar | N/A | Monaco |
| TypeScript support | Native | Plugin required | None | Monaco |
| Extension ecosystem | Rich | Growing | None | Monaco |

**Decision: Monaco Editor**

"I'm choosing Monaco Editor despite its larger bundle size. The rationale is that our target users are developers who are already familiar with VS Code, so Monaco provides an immediately comfortable editing experience. The syntax highlighting quality is excellent, and we get virtual scrolling out of the box for handling large documents. The TypeScript integration is also valuable if we want to add language features later. The 2MB bundle is acceptable because we're building a PWA where assets get cached after first load."

---

### 2. Markdown Parser Selection

"For converting Markdown to HTML, I'm evaluating two main options."

#### Why markdown-it Over remark/unified?

| Factor | markdown-it | remark/unified | Winner |
|--------|-------------|----------------|--------|
| Parse speed | Very fast | Moderate | markdown-it |
| Bundle size | ~25KB | ~150KB+ | markdown-it |
| Plugin ecosystem | Rich | Extensive | Tie |
| GFM support | Built-in | Plugin | markdown-it |
| AST manipulation | Limited | Full control | remark |
| Extensibility | Straightforward | More powerful | remark |

**Decision: markdown-it**

"I'm going with markdown-it because parsing speed is critical for real-time preview. markdown-it is significantly faster and has a smaller footprint. While remark gives more control over the AST, we don't need that level of manipulation for a preview renderer. markdown-it's plugin ecosystem covers our needs: task lists, code highlighting, and emoji support. The GFM support being built-in also reduces configuration complexity."

---

### 3. HTML Sanitization

"Since we're rendering user-generated Markdown as HTML, security is paramount."

#### Why DOMPurify for Sanitization?

| Factor | DOMPurify | sanitize-html | Built-in browser | Winner |
|--------|-----------|---------------|------------------|--------|
| Security track record | Excellent | Good | Varies | DOMPurify |
| Performance | Very fast | Moderate | Fast | DOMPurify |
| Bundle size | ~15KB | ~30KB | 0 | Built-in |
| Configurability | Excellent | Good | Limited | DOMPurify |
| Active maintenance | Very active | Active | N/A | DOMPurify |

**Decision: DOMPurify**

"DOMPurify is the industry standard for client-side HTML sanitization. It's battle-tested against XSS attacks and has an excellent security track record. The configuration options let us allow specific tags like task list checkboxes while blocking dangerous elements. It's also faster than sanitize-html because it uses the browser's native DOM parser rather than doing string manipulation. Even though markdown-it can disable raw HTML input, we still sanitize the output as defense in depth."

---

### 4. Preview Update Timing

"Let me explain the debouncing strategy for preview updates."

#### Why 150ms Debounce?

| Debounce Time | Responsiveness | CPU Usage | User Perception | Winner |
|---------------|----------------|-----------|-----------------|--------|
| 50ms | Immediate | High | Flickering | - |
| 100ms | Very fast | Medium-high | Slightly jumpy | - |
| 150ms | Fast | Moderate | Smooth | 150ms |
| 300ms | Noticeable lag | Low | Sluggish | - |
| 500ms | Laggy | Very low | Frustrating | - |

**Decision: 150ms debounce**

"150 milliseconds is the sweet spot based on research into human perception. Below 100ms, users perceive changes as instantaneous, but we're doing expensive work like parsing and sanitizing that can cause UI jank. At 150ms, we're still under the 200ms threshold where users start perceiving delay, but we've consolidated multiple keystrokes into a single update. This dramatically reduces CPU usage during fast typing while feeling responsive. The preview catches up naturally during micro-pauses in typing."

```
Keystroke Flow:

User Types:   [H] [e] [l] [l] [o]    [W] [o] [r] [l] [d]
              |   |   |   |   |      |   |   |   |   |
Time:         0  50  100 150 200    400 450 500 550 600 (ms)
              |   |   |   |   |      |   |   |   |   |
Timer:        +-->+-->+-->+-->X      +-->+-->+-->+-->X
                          |                          |
                          v                          v
Render:                [Hello]                   [Hello World]

Legend: + = timer starts, --> = timer running, X = timer fires
```

"Each keystroke resets the debounce timer. The render only fires when there's a 150ms gap in typing, which naturally happens between words."

---

### 5. Theming Approach

"For implementing light and dark themes, I need to choose a styling strategy."

#### Why CSS Variables Over CSS-in-JS?

| Factor | CSS Variables | CSS-in-JS | Tailwind | Winner |
|--------|---------------|-----------|----------|--------|
| Runtime overhead | Zero | Medium | Zero | CSS Variables |
| Bundle size impact | None | +20-50KB | None | CSS Variables |
| Theme switching | Instant | Re-render | Instant | CSS Variables |
| DevTools support | Excellent | Good | Good | CSS Variables |
| Dynamic values | Supported | Native | Limited | Tie |
| Monaco integration | Seamless | Complex | Complex | CSS Variables |

**Decision: CSS Variables**

"I'm using CSS Variables with a data attribute on the document root. The main advantage is zero runtime overhead for theme switching. When the user toggles themes, we change one attribute and the browser handles all the cascading updates natively. This is much faster than CSS-in-JS solutions that need to regenerate styles and trigger React re-renders. It also integrates cleanly with Monaco Editor, which has its own theme system that we can coordinate through CSS variable references."

```
Theme Architecture:

+----------------+     +-------------------+
| Theme Toggle   |---->| data-theme attr   |
+----------------+     +-------------------+
                              |
                              v
              +---------------+---------------+
              |               |               |
              v               v               v
       +----------+    +----------+    +----------+
       | Toolbar  |    |  Editor  |    | Preview  |
       +----------+    +----------+    +----------+
              ^               ^               ^
              |               |               |
              +-------+-------+-------+-------+
                      |
               CSS Variables
           (--color-bg, --color-text, etc.)

```

---

### 6. State Management

"For managing application state across components, let me compare approaches."

#### Why Zustand Over Redux or Context?

| Factor | Zustand | Redux | React Context | Winner |
|--------|---------|-------|---------------|--------|
| Boilerplate | Minimal | Heavy | Minimal | Zustand |
| Bundle size | ~3KB | ~15KB | 0 | Context |
| DevTools | Supported | Excellent | Limited | Redux |
| Persistence | Built-in middleware | Requires setup | Manual | Zustand |
| Provider nesting | None required | Single provider | Can nest deeply | Zustand |
| TypeScript DX | Excellent | Good | Good | Zustand |
| Learning curve | Low | High | Low | Zustand |

**Decision: Zustand**

"Zustand gives us the right balance for this application. We need to manage document state, view mode, theme preference, and sync settings across components, but Redux would be overkill. Context alone would require multiple providers and can cause unnecessary re-renders. Zustand's persist middleware is particularly valuable because we can automatically sync state to localStorage without additional code. The API is also more ergonomic, with hooks that subscribe only to the slices of state each component needs."

---

### 7. Scroll Synchronization

"Keeping the editor and preview scrolled to matching positions is tricky because they have different heights."

#### Why Proportional Sync Over Pixel-Based?

| Approach | Editor 1000px doc | Preview 2000px doc | Result | Winner |
|----------|-------------------|--------------------|--------|--------|
| Pixel sync | Scroll to 500px | Scroll to 500px | Preview at 25% | - |
| Proportional | Scroll to 50% | Scroll to 50% | Both at midpoint | Proportional |
| Line mapping | Line 100/200 | Find line 100 | Accurate but complex | - |

**Decision: Proportional scroll synchronization**

"The challenge is that the editor and preview have different total heights. A 100-line Markdown file might render to 2000 pixels in the editor but 3000 pixels in the preview due to images, code blocks with syntax highlighting, and other formatting. Pixel-based synchronization would leave them misaligned. Instead, I calculate the scroll ratio: where are you proportionally in the document? If the editor is scrolled 50% down, we scroll the preview to 50% as well. This keeps the conceptual position aligned even when the physical heights differ."

```
Proportional Scroll Calculation:

     Editor                      Preview
   +--------+                  +--------+
   |        |                  |        |
   |========| <- viewport      |        |
   |        |    at 33%        |        |
   +--------+                  |========| <- synced
                               |        |    to 33%
                               +--------+

   scrollRatio = scrollTop / (scrollHeight - clientHeight)
   targetScroll = scrollRatio * (targetScrollHeight - targetClientHeight)
```

"I also track which pane initiated the scroll to prevent infinite loops. When the editor scrolls, we update the preview, but then suppress the preview's scroll event from updating the editor back."

---

## 📊 Data Flow

"Let me trace how data flows through the application during typical usage."

```
Document Editing Flow:

  +-----------+
  |   User    |
  |  Types    |
  +-----+-----+
        |
        v
  +-----------+     +-------------+     +-------------+
  |   Monaco  |---->|  Debounce   |---->|  markdown-it|
  |   Editor  |     |   150ms     |     |   Parser    |
  +-----------+     +-------------+     +-------------+
        |                                     |
        v                                     v
  +-----------+                         +-------------+
  |  Zustand  |                         |  DOMPurify  |
  |   Store   |                         | Sanitizer   |
  +-----------+                         +-------------+
        |                                     |
        v                                     v
  +-----------+                         +-------------+
  | IndexedDB |                         |   Preview   |
  | Persist   |                         |    Pane     |
  +-----------+                         +-------------+
```

"On each keystroke, Monaco fires a change event. This updates the Zustand store immediately so the editor stays responsive. Separately, the debounce timer tracks the content. After 150ms of no typing, the markdown-it parser converts the text to HTML, DOMPurify sanitizes it, and the preview pane renders the result. The Zustand persist middleware handles saving to IndexedDB in the background."

---

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Why This Choice |
|----------|--------|-------------|-----------------|
| Editor | Monaco | CodeMirror 6 | VS Code familiarity, better large file support |
| Parser | markdown-it | remark/unified | Speed critical for real-time, smaller bundle |
| Sanitizer | DOMPurify | sanitize-html | Industry standard, faster, better security |
| Debounce | 150ms | 50ms or 300ms | Balances responsiveness with CPU efficiency |
| Theming | CSS Variables | CSS-in-JS | Zero runtime overhead, instant switching |
| State | Zustand | Redux/Context | Right-sized, built-in persistence |
| Scroll sync | Proportional | Pixel or line | Works across different content heights |

---

## 🚀 Future Enhancements

"If we have time to extend the design, here are the next priorities."

1. **Collaborative Editing** - Add WebRTC with Yjs for real-time multi-user editing. This would require conflict resolution and cursor awareness.

2. **Export Options** - PDF and styled HTML export. We'd need a server-side rendering option for consistent PDF generation.

3. **Table of Contents** - Auto-generated sidebar navigation from headers. Helps navigation in long documents.

4. **Vim/Emacs Keybindings** - Modal editing support. Monaco has APIs for custom keymaps.

5. **Image Paste** - Paste images from clipboard and store as Base64 or blobs in IndexedDB. Increases document size management complexity.

---

## 📝 Summary

"To summarize the design: MD Reader is a Progressive Web App for Markdown editing with a split-pane interface. Monaco Editor provides the editing experience, chosen for its VS Code familiarity and virtual scrolling. markdown-it handles parsing because speed is critical for real-time preview. We debounce at 150ms to balance responsiveness with efficiency, then sanitize with DOMPurify for security. Zustand manages state with automatic IndexedDB persistence, and CSS Variables power instant theme switching. Proportional scroll synchronization keeps editor and preview aligned despite different heights. The PWA service worker enables full offline functionality. This architecture delivers a responsive, secure, and offline-capable editing experience."
