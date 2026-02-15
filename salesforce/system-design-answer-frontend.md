# Salesforce CRM - Frontend System Design Answer

## 1. Requirements Clarification (2 minutes)

"I'm designing the frontend for a CRM system -- the primary tool sales teams use 8+ hours daily. Let me confirm the scope:

- **Dashboard**: KPI cards and pipeline visualization on the landing page?
- **Entity views**: List pages for accounts, contacts, leads with search and filtering?
- **Account detail**: Tabbed view showing related contacts, opportunities, and activities?
- **Kanban board**: Drag-and-drop opportunity pipeline by stage?
- **Lead conversion**: Modal workflow to convert a lead into account + contact + opportunity?
- **Reports**: Visual charts for pipeline, revenue, and lead source analytics?

The key frontend challenges here are the kanban drag-drop interaction, optimistic UI updates, complex entity navigation, and dashboard data aggregation. I'll focus on those."

## 2. UI Architecture (5 minutes)

```
┌──────────────────────────────────────────────────────┐
│                    App Shell                          │
│  ┌──────────┐ ┌────────────────────────────────────┐ │
│  │          │ │          Content Area               │ │
│  │ Sidebar  │ │  ┌──────────────────────────────┐  │ │
│  │          │ │  │     Route Content             │  │ │
│  │ - Home   │ │  │  (Dashboard / Accounts /     │  │ │
│  │ - Accts  │ │  │   Contacts / Pipeline /      │  │ │
│  │ - Conts  │ │  │   Leads / Reports)           │  │ │
│  │ - Opps   │ │  │                              │  │ │
│  │ - Leads  │ │  └──────────────────────────────┘  │ │
│  │ - Rpts   │ │                                    │ │
│  │          │ │                                    │ │
│  │ ──────── │ │                                    │ │
│  │ User     │ │                                    │ │
│  │ Sign out │ │                                    │ │
│  └──────────┘ └────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

> "The layout uses a fixed sidebar for navigation and a content area that changes per route. The sidebar is persistent -- CRM users navigate between entities constantly, so navigation must always be visible. The sidebar collapses on mobile to a hamburger menu.

I use file-based routing with TanStack Router. Each route maps to a page component that fetches its own data on mount. State management uses Zustand for global CRM data (accounts, contacts, opportunities, leads, activities, dashboard KPIs) and React state for local UI concerns (form inputs, modals, pagination)."

### Component Tree

```
App
├── Sidebar (always visible when authenticated)
├── Routes
│   ├── / ──── Dashboard
│   │         ├── DashboardMetrics (KPI cards)
│   │         └── PipelineChart (bar chart)
│   ├── /accounts ──── AccountList
│   │         └── EntityForm (modal)
│   ├── /accounts/:id ──── AccountDetail
│   │         ├── Contacts Tab (table)
│   │         ├── Opportunities Tab (table + StatusBadge)
│   │         └── Activities Tab
│   │               ├── ActivityForm
│   │               └── ActivityTimeline
│   ├── /contacts ──── ContactList
│   │         └── EntityForm (modal)
│   ├── /opportunities ──── KanbanBoard
│   │         ├── KanbanColumn (per stage)
│   │         └── OpportunityCard (draggable)
│   ├── /leads ──── LeadList
│   │         ├── EntityForm (modal)
│   │         └── ConvertLeadModal
│   └── /reports ──── ReportChart (x3)
├── /login ──── LoginPage
└── /register ──── RegisterPage
```

### Route Structure

```
/                    Dashboard with KPI cards and pipeline chart
/login               Login form
/register            Registration form
/accounts            Account list with search and create
/accounts/:id        Account detail with tabs
/contacts            Contact list with search and create
/opportunities       Kanban pipeline board
/leads               Lead list with convert action
/reports             Pipeline, revenue, and lead source charts
```

## 3. State Management (5 minutes)

> "I split state into two Zustand stores:

**authStore** -- User session state. Handles login, logout, registration, and session check on app load. The root route calls checkAuth() on mount to restore sessions.

**crmStore** -- All CRM entity data. Contains arrays for accounts, contacts, opportunities, leads, activities, plus dashboard KPIs and report data. Each entity section has its own loading flag and fetch function.

I chose Zustand over React Context because CRM stores have many independent slices. With Context, updating opportunities would re-render the contacts list. Zustand's selector pattern lets components subscribe to only the data they need -- the KanbanBoard subscribes to opportunities, the LeadList subscribes to leads, and neither re-renders when the other changes."

### Store Shape

```
authStore
├── user (User | null)
├── loading (boolean)
├── error (string | null)
├── login(), register(), logout(), checkAuth()

crmStore
├── Dashboard
│   ├── kpis (DashboardKPIs | null)
│   └── fetchKPIs()
├── Accounts
│   ├── accounts[], accountsTotal
│   └── fetchAccounts(params)
├── Contacts
│   ├── contacts[], contactsTotal
│   └── fetchContacts(params)
├── Opportunities
│   ├── opportunities[], opportunitiesTotal
│   ├── fetchOpportunities(params)
│   └── updateOpportunityStage(id, stage)
├── Leads
│   ├── leads[], leadsTotal
│   └── fetchLeads(params)
├── Activities
│   ├── activities[], activitiesTotal
│   └── fetchActivities(params)
└── Reports
    ├── pipeline[], revenue[], leadsBySource[]
    └── fetchPipelineReport(), fetchRevenueReport(), fetchLeadsReport()
```

## 4. Deep Dives

### Deep Dive 1: Kanban Board with Drag-Drop

> "The kanban board is the most interaction-heavy component. It renders 7 columns (one per pipeline stage) with draggable opportunity cards. Users drag cards between columns to change deal stages.

I use @dnd-kit because it provides separate abstractions for draggable items and droppable containers. Each KanbanColumn is a droppable zone identified by its stage name. Each OpportunityCard is a draggable item identified by its opportunity ID.

**The drag flow:**

1. User starts dragging a card. DndContext fires onDragStart. I store the active opportunity in local state to render a DragOverlay -- a floating clone of the card that follows the cursor. The original card becomes semi-transparent.

2. As the user drags over columns, @dnd-kit's closestCorners collision detection algorithm determines which column the card is hovering over. The target column highlights with a blue ring.

3. User drops the card. DndContext fires onDragEnd with the active item ID and the over container ID (the stage name). I call updateOpportunityStage(oppId, newStage).

**Optimistic update pattern:** When the user drops a card, I immediately update the local store to move the opportunity to the new stage. This provides instant visual feedback -- the card appears in the new column before the API responds. If the API call fails, I revert by re-fetching all opportunities.

The alternative to optimistic updates is waiting for the API response before moving the card. This creates a 100-300ms delay where the card snaps back to its original position, then jumps to the new column. Users perceive this as laggy and lose trust in the interaction.

The trade-off with optimistic updates: if two users drag the same deal simultaneously, one will see their change reverted on the next data fetch. For a CRM where deal ownership is typically single-user, this collision is rare. I'd add WebSocket notifications for real-time sync if multi-user editing becomes a requirement.

**DragOverlay vs. in-place drag:** I render a DragOverlay (a portal-rendered clone) instead of transforming the original card. This prevents layout shifts in the source column during drag and ensures the dragged item renders above all other content. Without DragOverlay, the dragged card can clip behind adjacent columns."

| Approach | Pros | Cons |
|----------|------|------|
| @dnd-kit | Accessible, composable, typed | More setup than HTML5 drag |
| react-beautiful-dnd | Simpler API, auto-animations | Deprecated, no active maintenance |
| HTML5 Drag API | No dependencies | Poor mobile support, no custom drag preview |

### Deep Dive 2: Dashboard Data Aggregation

> "The dashboard displays 8 KPI cards and a pipeline bar chart. This data comes from two API calls: GET /api/dashboard (KPIs) and GET /api/reports/pipeline (stage breakdown).

**The loading strategy:** Both calls fire in parallel on mount via the Zustand store. I display a skeleton loading state until both complete. The KPI cards render individually -- if the dashboard API returns first, cards appear while the pipeline chart still shows a spinner.

**KPI card design:** Each card shows a metric label, value, and colored indicator. Values use locale-aware formatting: currency uses Intl.NumberFormat with USD, counts use toLocaleString() for thousands separators, percentages append '%'. The metric list is defined as a constant array with format specifications, so adding new KPIs requires only adding an entry to the array -- not a new component.

**Pipeline chart:** I built a pure CSS bar chart rather than importing a charting library. Each stage gets a horizontal bar whose width is proportional to its total amount relative to the largest stage. Color-coding matches the kanban column colors for visual consistency. This approach adds zero bundle size compared to Chart.js (40KB gzipped) or Recharts (60KB gzipped).

The trade-off: the CSS-only chart can't render tooltips, animations, or responsive axis labels as elegantly as a charting library. For the reports page where users expect richer visualizations, I'd introduce a lightweight library. But for the dashboard overview, simple bars with inline labels are sufficient and load instantly.

**Caching strategy:** Dashboard data doesn't change frequently -- a deal closing or a new lead arriving updates one of eight metrics. I cache KPIs in the Zustand store and only re-fetch when the user navigates back to the dashboard or explicitly refreshes. This prevents unnecessary API calls when switching between tabs. A production version would add WebSocket-pushed invalidation when deals move stages."

### Deep Dive 3: Entity Relationship Navigation

> "CRM users navigate relationships constantly: click an account, see its contacts, click a contact, see their opportunities. The UI must support fluid navigation without losing context.

**Account detail page:** Uses a tabbed interface (Contacts, Opportunities, Activities) within a single page. All three tabs' data loads in parallel on mount via Promise.all. This means switching tabs is instant -- the data is already in memory. The active tab is tracked in local React state, not the URL, because tab state shouldn't create browser history entries.

**The data loading pattern:** When the user navigates to /accounts/:accountId, the AccountDetail component fires four parallel API calls:

1. Account detail (GET /api/accounts/:id)
2. Account contacts (GET /api/accounts/:id/contacts)
3. Account opportunities (GET /api/accounts/:id/opportunities)
4. Account activities (GET /api/activities?relatedType=account&relatedId=:id)

This parallel loading means the page renders in the time of the slowest call, not the sum of all calls. If contacts load in 50ms but activities take 200ms, the page shows content at 200ms instead of 300ms.

**Entity forms:** I use a shared EntityForm component that renders different fields based on the entityType prop. Account forms show name, industry, phone. Contact forms show first/last name, email, account selector. This avoids duplicating form logic across 4 entity types. The form renders as a modal overlay so the user doesn't lose their list context.

The account selector in the contact and opportunity forms loads account options lazily -- only when the user clicks 'New Contact' do I fetch the accounts list for the dropdown. This avoids loading account data on every page where it's not needed.

**Polymorphic activity display:** Activities are rendered through a shared ActivityTimeline component that works on any entity detail page. The component receives activities as props and renders them chronologically with type-specific icons (phone for calls, envelope for emails, calendar for meetings). The ActivityForm component captures the relatedType and relatedId from the parent context, so creating an activity on an account page automatically associates it with that account."

| Pattern | Pros | Cons |
|---------|------|------|
| Parallel data loading | Fast initial render | Wasted bandwidth if user only views one tab |
| Lazy tab loading | Less data transferred | Tab switch has loading delay |
| Prefetch on hover | Best perceived performance | Complex, may waste bandwidth |

## 5. Component Design Patterns (5 minutes)

### Reusable List Pattern

> "All entity list pages (AccountList, ContactList, LeadList) follow the same pattern: search input, filter controls, data table with pagination. I extract the pagination UI but keep each list as its own component because the columns, filters, and row click behaviors differ per entity.

Each list receives data, loading state, and callback functions as props from the route component. The route component manages the Zustand store interaction. This separation means list components are pure presentational -- they can be tested without store dependencies.

The list pattern has five consistent pieces:

1. **Header bar** with entity title and 'New' button
2. **Search input** that triggers parent callback on form submit
3. **Filter controls** (entity-specific: industry for accounts, status+source for leads)
4. **Data table** with sortable columns, hover highlighting, and clickable rows
5. **Pagination footer** showing total count, page number, and previous/next buttons

The data table is intentionally not abstracted into a generic Table component. Each entity has different column configurations, cell formatters (currency for revenue, badges for status, concatenated name for contacts), and click handlers (accounts navigate to detail page, leads have a convert button). A generic table would need so many configuration props that it would be harder to maintain than separate components."

### StatusBadge Component

> "Status badges appear throughout the CRM -- opportunity stages on the kanban and detail views, lead statuses on the lead list, activity types on timelines. A single StatusBadge component maps status strings to color classes using three separate lookup objects (one per entity type). This centralizes color decisions and ensures visual consistency -- 'Closed Won' is always green whether it appears in the kanban, account detail opportunities tab, or reports page.

The component accepts a type prop ('opportunity', 'lead', or 'activity') to select the correct color mapping. This avoids a single giant lookup where 'New' could mean a new lead (blue) or a new activity type that doesn't exist. The type parameter disambiguates."

### Modal Pattern

> "Entity creation forms and the lead conversion modal render as fixed-position overlays with a semi-transparent backdrop. I use a simple state boolean (showForm/convertingLead) in the route component rather than a modal manager library. The modal traps focus and closes on backdrop click or Escape key.

For the lead conversion modal specifically, I pre-populate the account name from the lead's company field and generate a default opportunity name. This reduces data entry -- the rep typically only needs to adjust the amount and close date before clicking 'Convert.' The checkbox to skip opportunity creation defaults to checked, because not every lead justifies creating a deal immediately.

The EntityForm component dynamically renders fields based on entityType. When creating a contact or opportunity, it lazily loads account options for the dropdown -- only when the user clicks 'New Contact' does it fetch the accounts list. This avoids loading relationship data on every page load."

### Sidebar Navigation

> "The sidebar uses a fixed-position layout on the left, 224px wide (w-56 in Tailwind), with the Salesforce navy color (#032D60). Navigation items show icon + label, with the active route highlighted by a white/translucent background and a 3px blue left border matching the Salesforce cloud blue (#00A1E0).

The sidebar is only rendered when the user is authenticated. The root route checks for the user in the auth store and conditionally renders the sidebar. Unauthenticated routes (login, register) render full-width without the sidebar. This avoids a flash-of-sidebar that would appear if we rendered it and then hid it on login check."

## 6. Lead Conversion UX (3 minutes)

> "The lead conversion workflow is the most complex user interaction. The rep clicks 'Convert' on a lead, which opens a modal with three sections:

**Section 1: Account creation** -- Pre-filled with the lead's company name. The rep can change it if the company name on the lead was informal or incorrect.

**Section 2: Opportunity creation** -- A checkbox controls whether to create an opportunity. When checked, three fields appear: opportunity name (pre-filled with 'Company - New Opportunity'), amount, and close date. When unchecked, only the account and contact are created. This is important because many leads convert without an immediate sales opportunity -- the rep just wants to promote the lead to a proper account/contact for future follow-up.

**Section 3: Confirmation** -- The convert button triggers a POST /api/leads/:id/convert. On success, the modal closes and the lead list re-fetches, showing the lead's status as 'Converted' with a purple badge. On failure (e.g., lead was already converted by another user), an error message appears inline without closing the modal.

The key UX decision: I use a modal rather than a separate page for conversion. This keeps the lead list visible in the background, maintaining context. The rep can see which leads they've already processed. After conversion, the lead immediately shows as 'Converted' in the list without a full page reload."

## 7. Performance Considerations (3 minutes)

> "CRM performance is critical because sales reps use the tool all day. Slow interactions directly impact productivity and adoption.

- **Code splitting**: Each route is a separate chunk via TanStack Router's file-based routing. The kanban page with @dnd-kit (the heaviest dependency) only loads when the user navigates to /opportunities. Login/register pages are separate chunks that aren't loaded for authenticated users.

- **Selective re-renders**: Zustand selectors ensure the dashboard doesn't re-render when opportunity data changes. Each page subscribes only to its own entity slice. The kanban board uses a flat selector for the opportunities array, so adding a new account doesn't cause 200 opportunity cards to re-render.

- **Debounced search**: Search inputs debounce API calls by 300ms to prevent request storms during typing. Without debouncing, typing 'Acme Corporation' would fire 16 API requests. With debouncing, it fires 1-2.

- **Pagination over infinite scroll**: CRM data tables use traditional pagination (OFFSET/LIMIT) because sales reps need to navigate to specific pages and the total count is meaningful for workflow management. A manager asking 'how many leads do we have?' can see the answer in the pagination footer.

- **Lazy account loading**: Contact and opportunity forms load account dropdown options only when the create form opens, not on page mount. This prevents fetching hundreds of accounts on every page navigation.

- **Parallel data loading**: Account detail pages fire four API calls in parallel (account, contacts, opportunities, activities) using Promise.all. This cuts page load time from the sum of all calls to the duration of the slowest call.

- **Stable keys for kanban**: Each opportunity card uses the opportunity ID as its React key and @dnd-kit ID. This ensures stable DOM references during drag operations and prevents React from unmounting/remounting cards when the opportunities array is re-fetched."

## 8. Accessibility Considerations (2 minutes)

> "CRM tools must be accessible -- many organizations have accessibility requirements for internal tools.

- **Keyboard navigation**: @dnd-kit provides built-in keyboard support for drag-and-drop. Users can use Tab to focus a card, Space to pick it up, Arrow keys to move between columns, and Space again to drop. This is a primary reason I chose @dnd-kit over HTML5 drag API.

- **Form labels**: All form inputs have associated label elements. The EntityForm component renders explicit labels above each input rather than using placeholder text as pseudo-labels (placeholders disappear when the user starts typing, which is inaccessible).

- **Color independence**: Status badges use both color and text to convey meaning. 'Closed Won' is green text on green background, but the text itself ('Closed Won') communicates the status without relying on color alone. This supports color-blind users.

- **Focus management**: When a modal opens, focus moves to the first form input. When it closes, focus returns to the trigger button. This prevents keyboard users from losing their place in the page."

## 9. Trade-offs Summary (2 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Drag-drop library | @dnd-kit | react-beautiful-dnd | Active maintenance, TypeScript native, accessible |
| Charts | CSS-only bars | Chart.js / Recharts | Zero bundle impact, sufficient for KPI display |
| State management | Zustand (2 stores) | React Context | Selector-based updates, no unnecessary re-renders |
| Entity forms | Shared EntityForm | Per-entity form components | DRY, consistent UX, single validation pattern |
| Tab state | Local React state | URL search params | Tabs shouldn't create history entries |
| Styling | Tailwind CSS | CSS modules | Rapid prototyping, consistent design tokens |
| Routing | TanStack Router (file-based) | React Router | Type-safe, code splitting, dev tools |
| Data tables | Per-entity components | Generic table component | Different columns/formatters/actions per entity |
| Account loading | Lazy on form open | Eager on page mount | Avoids unnecessary API calls |
| Conversion UX | Modal over list | Separate page | Maintains list context, faster workflow |
