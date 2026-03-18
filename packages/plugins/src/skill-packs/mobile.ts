import type { SkillPack } from "./ecommerce";

/**
 * Mobile Skill Pack
 *
 * Patterns for responsive design, offline-first architecture,
 * push notifications, and mobile-specific UX patterns.
 */

export const MOBILE_SKILL_PACK: SkillPack = {
  id: "skill-pack-mobile",
  name: "Mobile & Responsive",
  description:
    "Responsive design, offline-first architecture, push notifications, and mobile UX patterns",
  category: "skill-pack",
  tags: ["mobile", "responsive", "offline", "push-notifications", "pwa"],

  patterns: [
    {
      name: "Responsive Design System",
      description:
        "Mobile-first responsive layout with breakpoint-driven components",
      context: "UI must work seamlessly across phone, tablet, and desktop",
      implementation: `
- Mobile-first approach: design for smallest screen first, enhance for larger
- Breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px), 2xl (1536px)
- Use CSS Container Queries for component-level responsiveness
- Touch targets: minimum 44x44px for all interactive elements
- Typography scale: fluid type using clamp() for responsive font sizes
- Layout patterns: stack on mobile, side-by-side on desktop
- Navigation: bottom tabs on mobile, sidebar on desktop
- Images: responsive srcset with multiple resolutions, lazy loading
- Test on real devices, not just browser resize
`,
    },
    {
      name: "Offline-First Architecture",
      description: "App works without network, syncs when connectivity returns",
      context: "Users may have intermittent or no connectivity",
      implementation: `
- Service Worker for caching strategies (cache-first for assets, network-first for API)
- IndexedDB or SQLite for local data storage
- Sync queue: store mutations locally, replay when online
- Conflict resolution: last-write-wins or manual merge for conflicts
- Optimistic UI: show changes immediately, reconcile on sync
- Network status detection: online/offline events, connection quality
- Background sync: Web Background Sync API for deferred operations
- Cache invalidation: version-based cache busting, TTL for API caches
- Data schema versioning: handle migrations in local storage
`,
    },
    {
      name: "Push Notifications",
      description: "Web Push and native push notification system",
      context: "Keep users engaged with timely, relevant notifications",
      implementation: `
- Web Push API with VAPID keys for browser push
- PushSubscription table: id, userId, endpoint, keys, platform, createdAt
- Notification preferences: per-category opt-in/out settings
- Notification types: transactional (order updates), engagement (reminders), system (alerts)
- Server-side: queue notifications, batch send, track delivery
- Client-side: request permission gracefully (after user action, not on page load)
- Rich notifications: images, actions buttons, badge counts
- Notification center: in-app list of recent notifications with read/unread state
- Rate limiting: max N notifications per user per day to prevent fatigue
- Analytics: track open rates, click-through, and opt-out rates
`,
    },
    {
      name: "Touch & Gesture Handling",
      description: "Native-feeling touch interactions for web and mobile apps",
      context: "Mobile users expect gesture-based interactions",
      implementation: `
- Swipe actions: swipe-to-delete, swipe-to-archive on list items
- Pull-to-refresh: at top of scrollable lists
- Long press: context menu or selection mode
- Pinch-to-zoom: for images and maps
- Haptic feedback: vibration API for confirmation actions
- Scroll behavior: momentum scrolling, snap points for carousels
- Prevent 300ms tap delay: use touch-action CSS property
- Gesture conflict resolution: prioritize scroll over swipe in nested contexts
- Accessibility: all gesture actions must have button alternatives
`,
    },
    {
      name: "Progressive Web App (PWA)",
      description: "Installable web app with native-like experience",
      context: "Deliver app-store-like experience through the browser",
      implementation: `
- Web App Manifest: name, icons, theme_color, display: standalone
- Service Worker: offline support, push notifications, background sync
- Install prompt: show custom install banner after engagement threshold
- App shell architecture: cache the UI shell, load content dynamically
- Splash screen: configure via manifest for native-like launch experience
- Share Target API: register as share target for receiving shared content
- File handling: handle file types in the manifest
- Shortcuts: app shortcuts in manifest for quick actions from home screen
- Update flow: detect new SW version, prompt user to reload
`,
    },
  ],

  agentHints: {
    architect:
      "Design mobile-first with offline capabilities. Service Worker for caching. Local DB for offline data. Sync queue for mutations.",
    frontend_coder:
      "Mobile-first CSS with Tailwind. Touch targets >= 44px. Container Queries for responsive components. Service Worker registration.",
    backend_coder:
      "Push notification endpoints with VAPID. Sync API for offline mutation replay. Conflict detection on stale writes.",
    test_engineer:
      "Test on real mobile devices. Test offline scenarios. Test push notification delivery. Test responsive breakpoints.",
    deploy_engineer:
      "HTTPS required for Service Workers. Configure Cache-Control headers. CDN for static assets. Manifest and SW at root scope.",
  },
};
