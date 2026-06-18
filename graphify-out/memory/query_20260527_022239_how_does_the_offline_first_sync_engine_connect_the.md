---
type: "query"
date: "2026-05-27T02:22:39.445518+00:00"
question: "How does the offline-first sync engine connect the native app to the Convex backend, and what is left of the old online-only design?"
contributor: "graphify"
source_nodes: ["SyncManager", "getDatabase", "getOrCreateDeviceId", "syncEndpoints", "applyPushedRow", "api", "Online-Only Architecture"]
---

# Q: How does the offline-first sync engine connect the native app to the Convex backend, and what is left of the old online-only design?

## Answer

Expanded original query via graph vocab to tokens: [sync, offline, push, pull, manager, bootstrap, device, network, watermelon, dedupe, bucket, convex], then re-anchored on rarer tokens [watermelon, dedupe, bucket, SyncManager] to reach the sync engine. Trace: mutations (orderMutations/checkoutMutations/voidMutations/takeoutMutations/discountMutations, Community 6) write to local WatermelonDB via getDatabase() (db/database.ts:14, 45 edges), then call syncManager.triggerPush(). syncManager singleton (SyncManager.ts:386, Community 9) owns lifecycle via SyncManagerImpl (:34): start/syncOnce/triggerPush/forceFullResync. Identity via getOrCreateDeviceId (auth/deviceId.ts:10), sent as x-device-id header and feeding orderNumber.ts. Transport: syncEndpoints.ts rewrites .convex.cloud->.convex.site and exposes callPull(/sync/pull,{lastPulledAt}) and callPush(/sync/push,x-device-id) — Convex HTTP actions, not the reactive client. syncOnce (:152) drives WatermelonDB synchronize() pull-then-push, with demoteExistingCreates (:327) reclassifying stale creates as updates to dedup. Backend packages/backend/convex/sync.ts (Community 11): applyPushedRow (:552) calls findExistingSyncedRow/resolveOrderNumber/resolveActorId; applyPushedDelete sibling. Spec: docs/superpowers/specs/2026-04-27-offline-first-pos-tablet-design.md:174-256. Old online-only design: write path fully inverted to local-first; vestige is the reactive convex client (api god node, 55 edges) still wrapped by read hooks useOrders/useStore/useProducts for local-first-with-live-fallback reads.

## Source Nodes

- SyncManager
- getDatabase
- getOrCreateDeviceId
- syncEndpoints
- applyPushedRow
- api
- Online-Only Architecture