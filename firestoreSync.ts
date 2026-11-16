import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { DeliveryZone, PricingSettings, ZoneRouteRate } from '../types';

export async function syncSignedInUserToFirestore(): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const userPath = `users/${user.uid}`;
  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName: user.displayName || 'مستخدم وصلها',
        role: 'customer',
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }
}

export async function syncPricingToFirestore(settings: PricingSettings): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const path = 'settings/pricing';
  try {
    await setDoc(doc(db, 'settings', 'pricing'), {
      baseFeeIqd: settings.baseFeeIqd,
      perKmFeeIqd: settings.perKmFeeIqd,
      minFeeIqd: settings.minFeeIqd,
      maxFeeIqd: settings.maxFeeIqd,
      interZoneFeeIqd: settings.interZoneFeeIqd,
      longDistanceThresholdKm: settings.longDistanceThresholdKm,
      longDistancePerKmFeeIqd: settings.longDistancePerKmFeeIqd,
      platformCommissionPct: settings.platformCommissionPct,
      outsideZonesAllowed: settings.outsideZonesAllowed,
      outsideZoneSurchargeIqd: settings.outsideZoneSurchargeIqd,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncZoneToFirestore(zone: DeliveryZone): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const path = `zones/${zone.id}`;
  try {
    const ref = doc(db, 'zones', zone.id);
    const snap = await getDoc(ref);
    await setDoc(ref, {
      id: zone.id,
      name: zone.name,
      city: zone.city,
      centerLat: zone.centerLat,
      centerLng: zone.centerLng,
      radiusKm: zone.radiusKm,
      pricingMode: zone.pricingMode,
      fixedFeeIqd: zone.fixedFeeIqd,
      baseFeeIqd: zone.baseFeeIqd,
      perKmFeeIqd: zone.perKmFeeIqd,
      isCovered: zone.isCovered,
      isActive: zone.isActive,
      ...(zone.notes ? { notes: zone.notes } : {}),
      createdAt: snap.exists() ? snap.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteZoneFromFirestore(zoneId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const path = `zones/${zoneId}`;
  try {
    await deleteDoc(doc(db, 'zones', zoneId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function syncZoneRouteToFirestore(route: ZoneRouteRate): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const path = `zoneRoutes/${route.id}`;
  try {
    const ref = doc(db, 'zoneRoutes', route.id);
    const snap = await getDoc(ref);
    await setDoc(ref, {
      id: route.id,
      fromZoneId: route.fromZoneId,
      toZoneId: route.toZoneId,
      fromZoneName: route.fromZoneName,
      toZoneName: route.toZoneName,
      feeIqd: route.feeIqd,
      bidirectional: route.bidirectional,
      isActive: route.isActive,
      ...(route.notes ? { notes: route.notes } : {}),
      createdAt: snap.exists() ? snap.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteZoneRouteFromFirestore(routeId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const path = `zoneRoutes/${routeId}`;
  try {
    await deleteDoc(doc(db, 'zoneRoutes', routeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
