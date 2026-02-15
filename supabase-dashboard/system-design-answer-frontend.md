# Supabase Dashboard - Frontend System Design Answer

## 1. Requirements Clarification

> "We're building a frontend for a BaaS management dashboard -- like Supabase Studio. The key frontend challenges are: a table data browser that feels like a spreadsheet, an SQL editor with query execution and results display, dynamic schema visualization, and a multi-section project layout with sidebar navigation. All in a dark theme matching Supabase's brand."

**Functional Requirements:**
- Project dashboard with create/delete and connection status indicators
- Table editor: schema viewer with column types, PK/FK badges, and a "View Data" link
- Table data browser: spreadsheet-like grid with pagination, sorting, inline editing, insert, delete
- SQL editor: multi-line textarea with Ctrl+Enter execution, saved query sidebar, results table
- Auth user management: list, create, edit, delete with role and email-confirmation controls
- Project settings: connection configuration with live connection test

**Non-Functional Requirements:**
- Responsive layout for 1280px+ screens (desktop-focused developer tool)
- Sub-200ms perceived response for navigation between sections
- Dark theme by default (#1C1C1C background, #3ECF8E primary green)
- Keyboard shortcuts in SQL editor (Ctrl+Enter to run, Tab for indentation)
- Bounded memory usage -- never load more than one page of data at a time

## 2. UI Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Root Layout (__root.tsx)                                      │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ / (Index) - Project Dashboard                           ││
│  │ /login, /register - Auth Pages                          ││
│  │                                                          ││
│  │ /project/$projectId - Project Layout                    ││
│  │  ┌──────────┬───────────────────────────────────────┐   ││
│  │  │ Sidebar  │ Content Area                          │   ││
│  │  │          │                                        │   ││
│  │  │ Tables   │ /tables - Schema browser              │   ││
│  │  │ SQL      │ /tables/$name - Data browser          │   ││
│  │  │ Auth     │ /sql - SQL editor + results           │   ││
│  │  │ Settings │ /auth - Auth user management          │   ││
│  │  │          │ /settings - Project configuration     │   ││
│  │  └──────────┴───────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

> "The layout is a nested route structure. The root handles auth checking. The project layout provides the persistent sidebar and breadcrumb. Each section (tables, SQL, auth, settings) is a child route that renders in the content area. This means navigating between sections doesn't re-mount the sidebar or re-fetch the project -- only the content changes."

## 3. Component Hierarchy

**~16 components organized by feature:**

- **Layout**: ProjectSidebar (persistent navigation), Breadcrumb (path display)
- **Projects**: ProjectCard (project tile with name, DB info, delete), ConnectionStatus (green/red dot)
- **Tables**: TableList (sidebar list with column counts), SchemaViewer (column detail table), CreateTableModal (form with ColumnEditors), ColumnEditor (name, type, PK, nullable, default inputs)
- **Data**: TableBrowser (paginated grid with sort/insert/refresh), DataRow (inline edit/delete per row)
- **SQL**: SQLEditor (monospace textarea with keyboard shortcuts), QueryResults (result table or row-affected message), SavedQueryList (sidebar list with click-to-load)
- **Auth**: AuthUserList (user table with role badges), AuthUserForm (create/edit form)
- **Settings**: ProjectSettings (connection config with save)

> "I kept components focused -- each handles one responsibility. TableBrowser manages pagination and sorting state but delegates row rendering to DataRow. SQLEditor handles keyboard shortcuts but delegates result display to QueryResults. This separation means we can refactor the SQL editor (e.g., replace textarea with CodeMirror) without touching the results display."

## 4. State Management

**Two Zustand stores:**

**authStore** - Authentication state
- user, loading, error
- login(), register(), logout(), checkAuth()

**projectStore** - All project-scoped state
- projects list, currentProject
- tables list, table data (paginated response)
- query result, query error, saved queries
- auth users list
- project settings

> "I chose a single projectStore over per-feature stores because the data is all scoped to the current project. When the user switches projects, we need to clear tables, queries, auth users, and settings simultaneously. A single store makes this atomic. The alternative -- separate tableStore, sqlStore, authUserStore -- would require coordinating resets across stores when the project changes, introducing timing bugs."

| Approach | Pros | Cons |
|----------|------|------|
| Single projectStore | Atomic project switching, simpler coordination | Larger store file, all state in one place |
| Per-feature stores | Smaller files, focused concerns | Must coordinate project-switch resets |
| React Query/SWR | Built-in caching, deduplication, retry | Overkill for this data volume, adds abstraction |

> "I didn't use React Query because the data volumes are small (typically less than 100 tables, less than 1000 rows per page) and the caching behavior would add complexity without clear benefit. React Query shines when you have many components reading the same data with different loading states -- our components are page-level, not deeply nested. Direct fetch + Zustand is simpler and more predictable for a dashboard where users expect to see fresh data after every mutation."

## 5. Deep Dive: Table Browser UX

> "The table data browser is the most interaction-heavy component. It needs to feel like a spreadsheet while being a React table backed by API calls. The challenge is balancing responsiveness with data freshness."

**Layout:**

```
┌──────────────────────────────────────────────────┐
│ [tableName]              [Refresh] [Insert Row]  │
├──────────────────────────────────────────────────┤
│ Insert form (collapsible)                        │
│  ┌────────┐ ┌────────┐ ┌────────┐               │
│  │ field1 │ │ field2 │ │ field3 │  [Save][Cancel]│
│  └────────┘ └────────┘ └────────┘               │
├──────────────────────────────────────────────────┤
│  name ▲  │ price  │ stock  │ category │ Actions  │
├──────────┼────────┼────────┼──────────┼──────────┤
│  Mouse   │  2999  │  150   │ Elec     │ Edit Del │
│  Keyboard│  8999  │   75   │ Elec     │ Edit Del │
│  USB Hub │  4999  │  200   │ Elec     │ Edit Del │
├──────────────────────────────────────────────────┤
│ 5 rows - Page 1 of 1           [Prev] [Next]    │
└──────────────────────────────────────────────────┘
```

**Sorting:**

> "Column headers are clickable. Clicking toggles between ascending and descending for that column. The sort state (sortBy, sortOrder) is passed as query parameters to the API, which adds an ORDER BY clause server-side. We don't sort client-side because the dataset may have thousands of rows across pages -- only server-side sort gives correct cross-page results. Client-side sorting would only sort the 50 visible rows, giving misleading output."

**Inline editing:**

> "Clicking 'Edit' on a row switches all cells in that row to input fields, pre-populated with current values. The primary key field is disabled to prevent accidental PK changes. On 'Save', we diff the edited values against the originals and only send changed fields in the PUT request. This minimizes the update payload and avoids unnecessary writes. On 'Cancel', we discard edits and revert to display mode -- no API call needed."

**Why not a virtual spreadsheet?**

| Approach | Pros | Cons |
|----------|------|------|
| Standard HTML table with pagination | Simple, predictable, server handles data volume | Less fluid than spreadsheet, requires page clicks |
| Virtualized infinite scroll | Fluid scrolling, no pagination | Complex scroll state, obscures total counts, harder sorting |
| Full spreadsheet library (AG Grid) | Feature-rich, familiar UX | Heavy dependency (200KB+), styling conflicts with dark theme |

> "I chose paginated HTML tables because a database management tool deals with structured queries, not free-form editing. Users expect to see page counts and row totals -- that's part of understanding their data. An infinite scroll grid would obscure total row counts and make it harder to navigate to specific rows. The pagination approach also naturally limits memory usage -- we never load more than 50 rows at a time. For a tool where users run SELECT with LIMIT/OFFSET, pagination is the natural metaphor."

**Insert row form:**

> "The insert form is collapsible (hidden by default) to keep the interface clean. It renders one input per field, excluding auto-generated fields like serial primary keys with defaults. We detect auto-generated fields by checking if the column has a default value AND is a primary key. This heuristic works for SERIAL/BIGSERIAL and gen_random_uuid() defaults. The form values are stored in local state and cleared on submit or cancel."

**Null handling:**

> "Null values display as italicized 'null' text in a muted color, visually distinct from the string 'null' or empty string. When editing, an empty input field sends an empty string -- if the user wants actual NULL, they'd need to use the SQL editor. This is a simplification: a production version would add a NULL toggle button on each cell."

## 6. Deep Dive: SQL Editor Experience

> "The SQL editor is where power users spend most of their time. It needs to support multi-line queries, keyboard shortcuts, and display results in a way that's easy to scan."

**Editor layout:**

```
┌──────────────────────────────────────────────────┐
│ Saved Queries  │  SQL Editor                     │
│                │  ┌──────────────────────────┐   │
│ query1         │  │ SELECT *                 │   │
│ query2         │  │ FROM products            │   │
│ query3         │  │ WHERE price_cents > 3000 │   │
│                │  │ LIMIT 10;                │   │
│                │  │               Ctrl+Enter │   │
│                │  └──────────────────────────┘   │
│                │         [Save]  [Run]           │
│                ├─────────────────────────────────┤
│                │  Results: 3 rows                │
│                │  ┌──────┬────────┬───────┐      │
│                │  │ name │ price  │ stock │      │
│                │  ├──────┼────────┼───────┤      │
│                │  │ Key  │  8999  │   75  │      │
│                │  │ Hub  │  4999  │  200  │      │
│                │  │ Stand│  3499  │  100  │      │
│                │  └──────┴────────┴───────┘      │
└──────────────────────────────────────────────────┘
```

> "The editor uses a plain textarea with monospace font styling. Tab key inserts two spaces instead of moving focus (we intercept the keydown event and programmatically insert whitespace). Ctrl+Enter (or Cmd+Enter on Mac) triggers query execution. These keyboard shortcuts are critical for power users -- nobody wants to mouse to a 'Run' button after writing a query."

**Why textarea over CodeMirror/Monaco?**

| Approach | Pros | Cons |
|----------|------|------|
| Plain textarea | Zero dependencies, instant load, simple integration | No syntax highlighting, no autocomplete, no line numbers |
| CodeMirror 6 | Syntax highlighting, lightweight (~50KB), extensible | Added dependency, theme customization needed |
| Monaco Editor | Full IDE experience, IntelliSense, multi-cursor | 2MB+ bundle, complex integration, heavy for occasional use |

> "I chose textarea for initial implementation because it's zero-dependency and loads instantly. For a dashboard that users access occasionally, bundle size matters -- Monaco adds 2MB to the initial load. CodeMirror 6 would be my upgrade path: it's ~50KB, supports SQL highlighting, and has a clean API for custom themes. The textarea serves as a functional placeholder that can be swapped out without changing the component interface (the props are value, onChange, onRun -- any editor can implement those)."

**Results display:**

> "Query results render in a scrollable table with sticky headers. Column names come from the fields array in the API response. For queries that don't return rows (INSERT, UPDATE, DELETE, CREATE TABLE), we show 'N rows affected' in a green success banner instead of an empty table. Error messages from PostgreSQL are displayed verbatim in a red banner -- they contain line numbers and position information that developers need for debugging."

**Saved queries sidebar:**

> "The saved query sidebar is a simple scrollable list showing query name and a truncated preview of the SQL. Clicking a saved query loads its SQL into the editor textarea. This is a replace operation, not an append -- if the user has unsaved work in the editor, it gets overwritten. In a production version, I'd add a confirmation dialog or an undo buffer. Delete buttons appear on hover to keep the list clean."

## 7. Deep Dive: Schema Visualization

> "The schema viewer shows column details in a format that helps developers understand their database structure at a glance. The challenge is presenting type information, constraints, and defaults in a scannable way without overwhelming the user."

**Schema viewer layout:**

```
┌──────────────────────────────────────────────────┐
│ products                      [View Data]        │
│ 7 columns - ~5 rows                             │
├──────────────────────────────────────────────────┤
│ Name      │ Type        │ Default  │ Null │ Keys │
├───────────┼─────────────┼──────────┼──────┼──────┤
│ id        │ integer     │ nextval  │ NO   │ PK   │
│ name      │ varchar(255)│ -        │ NO   │      │
│ price_cents│ integer    │ -        │ NO   │      │
│ stock     │ integer     │ 0        │ YES  │      │
│ category  │ varchar(100)│ -        │ YES  │      │
│ created_at│ timestamptz │ NOW()    │ YES  │      │
└──────────────────────────────────────────────────┘
```

**Visual encoding for constraints:**

> "Primary keys get a green 'PK' badge (using the Supabase primary color), foreign keys get a blue 'FK' badge with a tooltip showing the referenced table.column. Nullable columns have a yellow 'YES' indicator -- yellow draws attention because nullable columns are often a design smell worth investigating. Non-nullable columns get a muted gray 'NO'. This color coding lets developers scan column constraints without reading each cell individually."

**Table list sidebar:**

> "The table list shows table name, column count, and a delete button that appears on hover. Column count gives a quick sense of table complexity without clicking into each one. The selected table is highlighted with a left border accent in the primary green color, following Supabase's sidebar selection pattern. This provides clear affordance about which table's schema is displayed."

**Create table modal:**

> "The CreateTableModal uses ColumnEditor components -- one per column. Each editor is a horizontal row with inputs for name (text), type (dropdown of common PostgreSQL types), primary key (checkbox), nullable (checkbox), and default value (text). Users can add and remove columns dynamically. The modal starts with two default columns: 'id' (SERIAL, PK) and 'created_at' (TIMESTAMPTZ, default NOW()) -- these are the most common starting point for a new table and save repetitive work."

## 8. Routing Architecture

**TanStack Router file-based routing:**

```
routes/
  __root.tsx                         Root layout + auth check
  index.tsx                          / - Project dashboard
  login.tsx                          /login
  register.tsx                       /register
  project.$projectId.tsx             Project layout + sidebar
  project.$projectId.tables.tsx      Table editor
  project.$projectId.tables_.$tableName.tsx  Table data browser
  project.$projectId.sql.tsx         SQL editor
  project.$projectId.auth.tsx        Auth users
  project.$projectId.settings.tsx    Settings
```

> "The nested route structure means the ProjectSidebar and Breadcrumb render once in project.$projectId.tsx and persist across section navigation. When a user clicks from Tables to SQL, only the content area re-renders -- the sidebar stays mounted with its current state. This prevents jarring full-page transitions and avoids unnecessary re-fetches of project data."

> "The root route runs checkAuth() on mount, which calls GET /api/auth/me. If the user has a valid session cookie, they're authenticated and the user object populates in the auth store. If not, each protected page redirects to /login. This is a single auth check on app load, not on every navigation."

## 9. API Layer

> "All API calls go through a single request() helper that handles JSON serialization, error extraction, and credentials inclusion. The helper throws on non-2xx responses with the server's error message, which Zustand store actions catch and expose to components."

**Error handling pattern:**

> "Every Zustand action wraps API calls in try/catch. Errors are stored in the store (queryError, for example) and displayed in the component. The component doesn't need to know about HTTP status codes -- it just checks if queryError is non-null and renders a red banner. This separation means error display is consistent across the app without duplicating error UI logic in every component."

**Credentials handling:**

> "The request() helper includes credentials: 'include' on every fetch call. This sends the session cookie with every request, even to the Vite proxy. The Vite dev server proxies /api/* to localhost:3001, so in development we avoid CORS issues entirely. In production, the API and frontend would share a domain or use proper CORS with credentials."

## 10. Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| State management | Zustand (single store) | React Query / per-feature stores | Simple, atomic project switching |
| SQL editor | Plain textarea | CodeMirror / Monaco | Zero deps, instant load, replaceable |
| Table browser | Paginated HTML table | Virtualized grid / AG Grid | Clear row counts, bounded memory |
| Routing | TanStack Router file-based | React Router / manual routes | Type-safe, file-based convention, nested layouts |
| Styling | Tailwind CSS (dark theme) | CSS Modules / styled-components | Utility-first, fast iteration, consistent dark palette |
| Inline editing | Row-level edit mode | Cell-level click-to-edit | Simpler state management, batch save per row |
| Auth check | Single check on app load | Per-route guard | Fewer API calls, session cookie persists across tabs |
| Component structure | Feature-based grouping | Domain-driven / atomic design | Matches route structure, easy to find components |
