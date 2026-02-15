# Apple Pay - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

---

## 📋 Problem Statement

Design the frontend architecture for a mobile wallet application that displays and manages provisioned payment cards, presents payment sheets for NFC and in-app transactions, shows transaction history with merchant details, and provides biometric authentication flows. The UI must feel as trustworthy and responsive as handling physical currency.

---

## 🎯 Requirements Clarification

### Functional Requirements

1. **Card Management** -- Display cards with visual representations matching real card art, add and remove cards from wallet, set default payment card
2. **Payment Sheet** -- Present payment options during checkout with card selection, amount display, and biometric authentication trigger
3. **Transaction History** -- Searchable, filterable list of past payments grouped by date with merchant icons and status indicators
4. **NFC Simulation UI** -- Visual feedback during tap-to-pay flow showing authentication state and transaction progress
5. **Device Management** -- View connected devices, mark device as lost (triggers card suspension across all cards on that device)

### Non-Functional Requirements

1. **Performance** -- Card selection responds in under 100ms; smooth 60fps animations during card carousel interactions
2. **Offline Resilience** -- Cards and recent transactions visible without network connectivity; instant app load from cache
3. **Accessibility** -- Full VoiceOver and screen reader support; keyboard navigation for all interactive elements
4. **Security** -- No sensitive card data (PAN, CVV, tokens) stored in frontend state; only display-safe fields (last4, network, card art URL)

---

## 🏗️ High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         React Application                                │
├───────────────────────────────────────────────────────────────────────────┤
│                          TanStack Router                                 │
│                                                                          │
│   /                  ──▶  Wallet View (card stack + default card)         │
│   /card/:id          ──▶  Card Detail (transactions, actions)            │
│   /transactions      ──▶  Transaction History (virtualized list)         │
│   /add-card          ──▶  Card Provisioning Flow (multi-step)            │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────┐     ┌──────────────────────────────────────┐ │
│  │    Card Stack View     │     │       Payment Sheet Modal            │ │
│  │                        │     │                                      │ │
│  │  - Interactive carousel│     │  - Card selection dropdown           │ │
│  │  - 3D transformations  │     │  - Amount + merchant display         │ │
│  │  - Swipe gestures      │     │  - Biometric auth trigger            │ │
│  │  - Spring physics      │     │  - State machine (idle/auth/done)    │ │
│  └────────────────────────┘     └──────────────────────────────────────┘ │
│                                                                          │
├───────────────────────────────────────────────────────────────────────────┤
│                          Zustand Store                                    │
│                                                                          │
│  cards[]  │  transactions[]  │  selectedCardId  │  paymentSheet  │ auth  │
├───────────────────────────────────────────────────────────────────────────┤
│                    localStorage Persistence                               │
│  Full card metadata + last 50 transactions cached for offline access     │
└───────────────────────────────────────────────────────────────────────────┘
```

> "I'm structuring the app around four main views connected by TanStack Router, with Zustand managing global state and localStorage persistence providing offline-first behavior. The payment sheet is a modal overlay that can appear on any route when triggered by an in-app payment request."

---

## 🗄️ State Management

### Store Architecture

The wallet store manages three data domains -- cards, transactions, and payment sheet state -- with persistence middleware for offline access.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                           WalletStore                                     │
├───────────────────────────────────────────────────────────────────────────┤
│  DATA SLICES                                                              │
│  ├── cards: Card[]              id, last4, network, cardType, status,    │
│  │                              isDefault, cardArtUrl                     │
│  ├── transactions: Transaction[]  merchantName, amount, currency,        │
│  │                              status, cardId, createdAt                │
│  └── selectedCardId             currently focused card in carousel       │
├───────────────────────────────────────────────────────────────────────────┤
│  PAYMENT SHEET STATE                                                      │
│  ├── isPaymentSheetOpen         controls modal visibility                │
│  └── paymentRequest             amount, currency, merchantId, name       │
├───────────────────────────────────────────────────────────────────────────┤
│  ACTIONS                                                                  │
│  ├── setCards / addCard / removeCard                                      │
│  ├── setDefaultCard / suspendCard                                         │
│  ├── openPaymentSheet / closePaymentSheet                                 │
│  └── selectCard                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│  COMPUTED SELECTORS                                                       │
│  ├── getDefaultCard()          finds first active + isDefault card        │
│  ├── getCardById(id)           single card lookup                        │
│  └── getTransactionsForCard()  filters transactions by cardId            │
└───────────────────────────────────────────────────────────────────────────┘
```

### Persistence Strategy

The store uses Zustand's persist middleware with a partialize function. Full card metadata is persisted (typically 3-8 cards at roughly 500 bytes each), but only the 50 most recent transactions are cached. This keeps storage well under localStorage's 5MB limit while providing instant app load without a loading spinner.

> "Wallet apps have a unique requirement: users pull out their phone to pay and expect cards to be visible immediately. The persist middleware gives us synchronous reads on app start, meaning cards render in the first frame -- no async loading state needed."

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Zustand + localStorage persist | Synchronous reads, instant load, offline cards | Manual cache invalidation, 5MB limit |
| ❌ React Query with IndexedDB | Automatic refetch, large storage | Async reads require loading states |
| ❌ Redux Toolkit + Redux Persist | Mature ecosystem, middleware | Heavy boilerplate for small data |

---

## 🎴 Card Stack Component

### 3D Card Carousel

The card stack uses a physics-based carousel where cards fan out with perspective transforms. The active card sits at full scale in the center, while neighboring cards recede with reduced opacity, scale, and a Y-axis rotation.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        CardStack Layout                                   │
│                                                                          │
│       offset=-2       offset=-1       offset=0        offset=1           │
│          │                │              │               │               │
│     ┌────▼────┐      ┌────▼────┐    ┌────▼────┐     ┌────▼────┐         │
│     │░░░░░░░░░│      │░░░░░░░░░│    │█████████│     │░░░░░░░░░│         │
│     │░ Card 3 │      │░ Card 2 │    │█ Card 1 █│     │░ Card 4 │         │
│     │░░░░░░░░░│      │░░░░░░░░░│    │█ ACTIVE █│     │░░░░░░░░░│         │
│     └─────────┘      └─────────┘    │█████████│     └─────────┘         │
│                                     └─────────┘                          │
│     scale: 0.8        scale: 0.9    scale: 1.0      scale: 0.9          │
│     opacity: 0.4      opacity: 0.7  opacity: 1.0    opacity: 0.7        │
│     rotateY: 30deg    rotateY: 15deg rotateY: 0deg   rotateY: -15deg    │
│                                                                          │
└───────────────────────────────────────────────────────────────────────────┘
```

The carousel tracks drag position via a motion value. When the user releases, a swipe threshold of 100 pixels determines whether to advance to the next card or spring back to center. Spring physics (stiffness 300, damping 30) create the natural deceleration users expect from a native wallet app.

### Payment Card Visual

Each card renders as a 320 by 192 pixel rounded rectangle with a gradient background determined by network -- blue for Visa, orange-to-red for Mastercard, slate for Amex. The card displays the network logo, last four digits in monospace, card type label, and an optional status badge when suspended. Card art images load lazily with a skeleton placeholder that pulses during load.

> "The card dimensions and aspect ratio match a standard credit card (85.6mm x 53.98mm). Users intuitively recognize their cards by color and network logo -- these visual cues need to match the physical card in their wallet."

---

## 💳 Payment Sheet Modal

### Payment Flow State Machine

The payment sheet follows a strict state machine to prevent users from seeing premature success or triggering duplicate payments.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                    Payment Sheet State Machine                             │
│                                                                          │
│  ┌──────┐       ┌────────────────┐       ┌─────────┐       ┌───────┐    │
│  │ idle │──────▶│ authenticating │──────▶│ success │──────▶│ close │    │
│  └──────┘       └────────────────┘       └─────────┘       └───────┘    │
│      │                  │                                                │
│      │                  │ auth fails or network error                    │
│      │                  ▼                                                │
│      │          ┌───────────┐                                            │
│      └─────────▶│   error   │───▶ user can retry                        │
│                 └───────────┘                                            │
│                                                                          │
│  Transitions:                                                            │
│  idle ──▶ authenticating    user taps "Pay with Face ID"                 │
│  authenticating ──▶ success biometric passes + API confirms              │
│  authenticating ──▶ error   biometric fails or API declines              │
│  success ──▶ close          auto-close after 1.5 second delay            │
│  error ──▶ idle             user taps "Try Again"                        │
└───────────────────────────────────────────────────────────────────────────┘
```

### Payment Sheet Layout

The sheet slides up from the bottom over a semi-transparent overlay. It contains a header with the merchant name, a large amount display, a card selector dropdown defaulting to the user's default card, and a full-width payment button. The button visually transforms through each state: black with Face ID icon for idle, spinning loader during authentication, green checkmark on success, red X on error.

> "I deliberately avoid optimistic updates for the payment confirmation. Unlike card selection where we can safely roll back, showing 'Payment Successful' before the backend confirms could cause a user to leave a store believing they paid when the transaction actually failed. The 1.5-second success display matches the mental model from physical card terminals."

### Card Selector Behavior

The card selector shows only active cards, with the default card pre-selected. Each option displays the network icon, masked card number, and card type. When the user changes selection, the store updates immediately (optimistic) while the payment button remains in idle state awaiting user action. Suspended cards appear grayed out with an explanatory label.

---

## 📜 Transaction History

### Virtualized List

Transaction history uses TanStack Virtual to efficiently render potentially thousands of transactions. Only items visible in the viewport (plus 5 overscan rows above and below) are rendered to the DOM.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                    Virtualized Transaction List                           │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  Scroll Container (viewport height minus header)                    │ │
│  │                                                                     │ │
│  │  ┌───────────────────────────────────────────────────────────────┐  │ │
│  │  │  Virtual Container (height = totalSize, position: relative)   │  │ │
│  │  │                                                               │  │ │
│  │  │    Row 0px    ──▶  "Today" date header                        │  │ │
│  │  │    Row 32px   ──▶  Starbucks          -$5.45                  │  │ │
│  │  │    Row 104px  ──▶  Target             -$47.99                 │  │ │
│  │  │    Row 176px  ──▶  Uber               -$12.30                 │  │ │
│  │  │    Row 248px  ──▶  "Yesterday" date header                    │  │ │
│  │  │    ...        ──▶  (only visible + overscan rendered)          │  │ │
│  │  └───────────────────────────────────────────────────────────────┘  │ │
│  │                                                                     │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  Virtualizer: estimateSize = 72px, overscan = 5 rows                     │
│  Dynamic measurement enabled for mixed row heights (headers vs items)    │
│                                                                          │
└───────────────────────────────────────────────────────────────────────────┘
```

### Transaction Row Layout

Each row shows a merchant category icon (food, retail, transport, etc.) on the left, merchant name and timestamp with masked card number in the center, and amount on the right. Status styling differs: approved transactions show in normal text, declined in red with strikethrough, and pending shows an orange "Pending" badge before the amount.

---

## ➕ Card Provisioning Flow

### Multi-Step Form

Card provisioning walks the user through four steps, with a progress indicator showing completed, current, and pending stages.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                     AddCardFlow Steps                                     │
│                                                                          │
│       Scan          Details         Verify         Complete               │
│        ●──────────────●──────────────○──────────────○                     │
│                       ▲                                                   │
│                  current step                                             │
│                                                                          │
│  ┌────────┐      ┌─────────┐      ┌────────┐      ┌──────────┐          │
│  │  scan  │─────▶│ details │─────▶│ verify │─────▶│ complete │          │
│  └────────┘      └─────────┘      └────────┘      └──────────┘          │
│      │                │                │                │                │
│      ▼                ▼                ▼                ▼                │
│  CardScanner    CardDetailsForm   VerifyStep     SuccessScreen           │
│  (camera or     (confirm name,    (SMS/email/    (animated check,       │
│   manual)       network auto-      bank app      "Card Added")          │
│                 detected)          verification)                         │
│                                                                          │
└───────────────────────────────────────────────────────────────────────────┘
```

**Step transitions:**

1. **Scan** -- User enters or scans card number. The network is auto-detected from the first six digits (BIN). On completion, card data flows to the details step.
2. **Details** -- Confirms detected card type and network. User verifies name and expiry. On submit, the frontend calls the provisioning API.
3. **Verify** -- If the network requires additional verification (yellow-path provisioning), the API returns available methods (SMS, email, bank app). User completes one.
4. **Complete** -- Animated success screen. New card is added to the store and appears in the card stack.

> "Green-path provisioning skips the verify step entirely -- high-confidence cards activate immediately. Yellow-path adds one step but provides stronger identity verification through the issuing bank. The frontend handles both paths through the same state machine."

---

## ⚡ Performance Optimizations

### Hardware-Accelerated Animations

All card carousel animations use GPU-accelerated properties exclusively: transform (translate, scale, rotate) and opacity. Layout-triggering properties like width, height, and position offsets are never animated. The Framer Motion spring configuration (stiffness 300, damping 25) provides natural deceleration without overdamping.

### Selective Store Subscriptions

Components subscribe to specific store slices rather than the entire state object. The transaction list subscribes only to the transactions array length; the card stack subscribes only to the cards array and selectedCardId. This prevents unnecessary re-renders -- updating transaction history never re-renders the card carousel.

### Image Optimization

Card art images use lazy loading with a gradient skeleton placeholder that animates during load. Once loaded, the image fades in via an opacity transition. Network logos are inline SVG components (not external images) to eliminate additional HTTP requests for these small, frequently-displayed assets.

---

## ♿ Accessibility

### Screen Reader Support

The card stack uses listbox and option ARIA roles, with aria-activedescendant tracking the currently selected card. Each card option receives a descriptive label combining network, card type, masked number, and status (for example, "Visa credit ending in 4242, default card"). Arrow keys navigate between cards; Enter or Space selects.

### Payment Sheet Focus Management

When the payment sheet opens, focus moves to the cancel button. A focus trap keeps Tab cycling within the modal. The sheet uses role="dialog" with aria-modal="true" and aria-label="Payment". On close, focus returns to the element that triggered the sheet.

### Status Announcements

Payment state transitions trigger aria-live announcements. When authentication begins, the screen reader announces "Authenticating payment." On success: "Payment of $49.99 approved." On error: "Payment declined. Try again button available." These announcements ensure non-sighted users receive the same feedback as sighted users watching the button state changes.

---

## 🔧 Deep Dive: Framer Motion vs CSS Animations

**The decision:** Use Framer Motion for the card carousel and payment sheet animations.

**Why Framer Motion works for this UI:**

The card carousel requires gesture-driven animations that respond to real-time finger position. As the user drags, each card's rotation, scale, and opacity must update based on its distance from center. When released, velocity-dependent spring physics determine whether the carousel advances or springs back. Framer Motion's useMotionValue and useTransform hooks enable these derived animations declaratively -- each card computes its properties from a single drag offset value, and spring physics handle the release behavior automatically.

The payment sheet's slide-up entrance and the success checkmark animation also benefit from Framer Motion's AnimatePresence, which handles exit animations before DOM removal. CSS alone cannot animate elements being removed from the tree.

**Why CSS animations would struggle here:**

CSS animations excel at predefined transitions between discrete states (hover effects, loading spinners, page transitions). The card carousel needs continuous response to a dynamic drag value -- you cannot express "rotate this card by 15 degrees times its offset from center, where offset updates at 60fps as the user's finger moves" in CSS keyframes. You would end up computing positions in JavaScript and setting inline styles on requestAnimationFrame anyway, losing CSS animation's performance benefits while keeping its limited API.

The gesture system is the critical differentiator. CSS has no concept of drag velocity, swipe thresholds, or spring physics. Building these from scratch in JavaScript would require 200+ lines of pointer event handling, momentum calculation, and animation scheduling -- essentially reimplementing what Framer Motion provides.

**What we give up:** Framer Motion adds approximately 40KB to the bundle. For a wallet app where animation quality directly impacts perceived trustworthiness -- users spending money expect Apple-quality interactions -- this weight is justified. Jerky card transitions would undermine confidence in the payment process itself.

---

## 🔧 Deep Dive: LocalStorage vs IndexedDB for Wallet Persistence

**The decision:** Use Zustand persist middleware with localStorage for offline card and transaction caching.

**Why localStorage works for wallet data:**

Wallet data is compact. A user typically has 3-8 cards at roughly 500 bytes each, plus we cache only the 50 most recent transaction summaries. Total persisted data stays under 100KB, well within localStorage's 5MB limit. The critical advantage is synchronous reads: when the user opens the app, cards render in the first paint frame without any loading spinner or async resolution. For a tap-to-pay scenario where the user is standing at a checkout terminal, this instant availability is essential.

The persist middleware's partialize function controls exactly what gets stored. Full card metadata (last4, network, status, cardArtUrl) is persisted; sensitive fields like tokenRef never enter the frontend state at all. Transaction data is truncated to the 50 most recent entries, with full history fetched on demand from the API.

**Why IndexedDB would add complexity without benefit:**

IndexedDB provides gigabytes of structured storage with indexes and query capabilities -- power designed for offline-first applications storing documents, photos, or large datasets. For wallet data measured in kilobytes, this power introduces pure overhead. IndexedDB's async-only API means every read requires an await and a loading state, which directly contradicts the "instant card visibility" requirement. The async nature, often touted as non-blocking, means the first render shows an empty wallet while IndexedDB resolves -- exactly the experience we need to avoid.

IndexedDB also requires more error handling: transaction abort recovery, version upgrade migrations, and storage quota negotiation. localStorage's simple string get/set API matches the simplicity of our data. The blocking concern with localStorage is valid for large datasets, but reading 100KB of JSON takes microseconds -- imperceptible on any modern device.

**What we give up:** localStorage is limited to roughly 5MB per origin and stores only strings. If the app evolved to cache merchant logos, full transaction receipts, or offline maps of nearby NFC terminals, we would need to migrate to IndexedDB. For card metadata and transaction summaries, this limitation does not apply.

---

## 🔧 Deep Dive: Optimistic Updates vs Confirmation-Based Updates

**The decision:** Use optimistic updates for card preferences (default selection, reordering) but confirmation-based updates for payments and destructive actions.

**Why optimistic updates work for card selection:**

When a user taps a card to set it as default, the UI should respond instantly. The selected state updates immediately in the Zustand store while the API call proceeds in the background. The happy path (API succeeds) covers over 99 percent of cases, so designing for instant feedback with rare rollbacks is the right trade-off. Card selection is also safely reversible -- if the API fails, we revert the selection in the store and show an error toast. The user simply taps again. There is no data loss because we are updating a preference, not initiating an irreversible financial operation.

**Why confirmation-based updates are required for payments:**

The payment flow deliberately does not use optimistic updates. The state machine enforces a strict sequence: idle, authenticating, success, close. We wait for biometric authentication to complete, then for the API to confirm the transaction, before showing the green success checkmark. Telling users "Payment Successful" before the backend processes the charge could cause real-world harm -- a user might leave a store believing they paid when the transaction actually failed.

The 1.5-second success display before auto-closing serves a deliberate purpose: users need visible confirmation that the transaction completed. This matches the mental model from physical card terminals, where the "Approved" message stays on screen briefly. The authentication spinner similarly sets expectations -- the user knows something is happening and waits for the result rather than tapping repeatedly.

**What we give up:** Card selection has a potential flicker if the API fails. The user sees the card become default, then 200-500ms later it reverts with an error toast. This brief inconsistency is acceptable because it happens rarely and involves no financial risk. Payment confirmation has perceptible latency (200-500ms for biometric + API round trip), but users accept this because it matches expectations from physical payment terminals.

---

## ⚖️ Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| ✅ Zustand + persist | Offline cards, instant load, minimal boilerplate | Manual cache invalidation on reconnect |
| ✅ Framer Motion | Gesture-driven physics, exit animations | Bundle size (+40KB) |
| ✅ CSS gradients for cards | Fast rendering, no image requests | Limited to approximating real card art |
| ✅ Virtualized transaction list | Handles thousands of transactions smoothly | Setup complexity, dynamic height measurement |
| ✅ Optimistic updates for preferences | Instant feedback on card selection | Rollback logic for rare failures |
| ✅ Confirmation-based payments | Financial safety, user confidence | Perceptible latency during checkout |

---

## 📈 Scalability Considerations

**What breaks first:** Transaction history grows unboundedly. The virtualized list handles rendering, but fetching thousands of transactions on page load would be slow. Cursor-based pagination (keyed on created_at) loads pages of 50 transactions, with the virtualizer triggering fetches as the user scrolls near the bottom.

**Card art images:** With network-specific gradients, card art is currently CSS-only. If issuers provide custom card images, these should load from a CDN with aggressive caching (24-hour browser cache, 7-day edge cache) and lazy loading. A Service Worker could pre-cache card art for offline access.

**Multi-device sync:** When a user adds a card on their iPhone, it should appear on their Apple Watch. This requires either WebSocket push notifications or polling the cards endpoint. For the web implementation, polling every 30 seconds is sufficient. Native apps would use push notifications via APNs.

**State migration:** The localStorage persistence schema will evolve. Zustand's persist middleware supports version numbers and migration functions, allowing schema changes without losing cached data. Each version bump includes a migration that transforms old state shape to new.

---

## 🚀 Future Enhancements

1. **Haptic Feedback Simulation** -- Vibration API integration during payment confirmation for tactile response on web
2. **NFC Visual Feedback** -- Animated ripple effect showing radio communication progress during tap-to-pay
3. **Card Scanning** -- Camera-based OCR for card number entry using device camera API
4. **Spending Analytics** -- Charts and category breakdowns derived from transaction history
5. **Widget Support** -- Quick-access payment card widget for iOS home screen
