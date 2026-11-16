# WASELHA Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. A `UserProfile` at `/users/{userId}` can only be created with `role == 'customer'` by a verified user (`request.auth.uid == userId`), never self-assigning `super_admin`.
2. PII (`phone`, `email`) is isolated under `/users/{userId}/private/info` and `/orders/{orderId}/private/contact`, readable only by the owner, assigned driver, or verified Admin.
3. `DeliveryZone` documents at `/zones/{zoneId}`, `ZoneRouteRate` documents at `/zoneRoutes/{routeId}`, and `PricingSettings` at `/settings/{settingId}` are strictly writable ONLY by `isAdmin()`.
4. Active zones and inter-zone routes can be read publicly for transparent delivery fee estimation prior to order submission without exposing admin write access.
5. `Order` documents represent freelance parcel deliveries (`senderName`, `itemName`, `pickupAddress`, `deliveryAddress`, `deliveryFeeIqd`, `platformFeeIqd`, `driverNetIqd`), enforce non-negative server-validated fees, and require `customerId == request.auth.uid` on creation.
6. Terminal order states (`delivered`, `cancelled`) are locked against non-admin updates.
7. All `createdAt` and `updatedAt` timestamps must equal `request.time`.
8. All document IDs match `^[a-zA-Z0-9_\\-]+$` and length <= 128.

## 2. Dirty Dozen Adversarial Payloads
1. Unauthenticated read on `/users/{userId}/private/info` -> `PERMISSION_DENIED`
2. Self-elevation on `/users/{uid}` creation with `role: 'super_admin'` -> `PERMISSION_DENIED`
3. Unverified email user creating an order -> `PERMISSION_DENIED`
4. Shadow field `isVerified: true` injected on `/zones/{zoneId}` create -> `PERMISSION_DENIED`
5. Oversized 2KB `id` path variable poisoning -> `PERMISSION_DENIED`
6. Non-admin creating or modifying `/zoneRoutes/{routeId}` inter-zone fee -> `PERMISSION_DENIED`
7. Client forging `createdAt` timestamp in the past -> `PERMISSION_DENIED`
8. Updating a `delivered` order back to `pending` as a non-admin -> `PERMISSION_DENIED`
9. Non-admin modifying `/zones/{zoneId}` coverage or pricing -> `PERMISSION_DENIED`
10. Driver modifying `deliveryFeeIqd`, `platformFeeIqd`, or `driverNetIqd` during status update -> `PERMISSION_DENIED`
11. Blanket `list` query on `/orders` by unrelated customer -> `PERMISSION_DENIED`
12. Non-admin modifying `/settings/pricing` -> `PERMISSION_DENIED`
