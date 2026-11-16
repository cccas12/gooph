export type UserRole = 'customer' | 'driver' | 'shop' | 'super_admin';
export type AppMode = 'hub' | 'customer' | 'driver' | 'manager';
export type AccountStatus = 'active' | 'suspended';
export type SenderType = 'individual' | 'shop';
export type ShopCategory = 'restaurant' | 'cafe' | 'grocery' | 'pharmacy' | 'other';
export type VehicleType = 'motorcycle' | 'car' | 'bicycle';
export type ZonePricingMode = 'fixed' | 'distance';
export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'picked_up'
  | 'on_the_way'
  | 'delivered'
  | 'cancelled';

export interface UserAccount {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  status: AccountStatus;
  shopId?: string;
  driverId?: string;
  createdAt: string;
}

export interface DeliveryZone {
  id: string;
  name: string;
  city: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  pricingMode: ZonePricingMode;
  fixedFeeIqd: number;
  baseFeeIqd: number;
  perKmFeeIqd: number;
  isCovered: boolean;
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ZoneRouteRate {
  id: string;
  fromZoneId: string;
  toZoneId: string;
  fromZoneName: string;
  toZoneName: string;
  feeIqd: number;
  bidirectional: boolean;
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Shop {
  id: string;
  ownerId: string;
  name: string;
  category: ShopCategory;
  description: string;
  address: string;
  phone: string;
  lat: number;
  lng: number;
  imageUrl: string;
  isOpen: boolean;
  status: AccountStatus;
  rating: number;
  createdAt: string;
  updatedAt: string;
}

export interface Driver {
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  vehicleType: VehicleType;
  plateNumber: string;
  isOnline: boolean;
  status: AccountStatus;
  lat: number;
  lng: number;
  completedCount: number;
  earningsIqd: number;
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  trackingCode: string;
  customerId?: string;
  senderType: SenderType;
  senderName: string;
  senderPhone: string;
  recipientName?: string;
  recipientPhone: string;
  itemName: string;
  itemDescription?: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  rejectedByDriverIds?: string[];
  pickupZoneId?: string;
  pickupZoneName?: string;
  deliveryZoneId?: string;
  deliveryZoneName?: string;
  zoneId?: string;
  zoneName?: string;
  pricingBreakdown?: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  distanceKm: number;
  notes?: string;
  deliveryFeeIqd: number;
  platformFeeIqd: number;
  driverNetIqd: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PricingSettings {
  baseFeeIqd: number;
  perKmFeeIqd: number;
  minFeeIqd: number;
  maxFeeIqd: number;
  interZoneFeeIqd: number;
  longDistanceThresholdKm: number;
  longDistancePerKmFeeIqd: number;
  platformCommissionPct: number;
  outsideZonesAllowed: boolean;
  outsideZoneSurchargeIqd: number;
  appName: string;
  supportPhone: string;
  maintenanceMode: boolean;
  updatedAt: string;
}

export interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  reason: string;
  ordersCount: number;
  zonesCount: number;
}

export interface DeliveryQuote {
  covered: boolean;
  reason?: string;
  distanceKm: number;
  deliveryFeeIqd: number;
  pickupZoneId?: string;
  pickupZoneName?: string;
  deliveryZoneId?: string;
  deliveryZoneName?: string;
  zoneId?: string;
  zoneName?: string;
  longDistanceExtraIqd: number;
  pricingMode: 'same_zone' | 'route_table' | 'inter_zone' | 'long_distance' | 'global_distance';
  breakdownLabel: string;
}

export function straightLineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  // Multiply straight-line distance by 1.25 urban road factor for realistic street routing
  return Math.round(straightLineDistanceKm(lat1, lng1, lat2, lng2) * 1.25 * 100) / 100;
}

export function matchDeliveryZone(
  lat: number,
  lng: number,
  zones: DeliveryZone[]
): { zone: DeliveryZone | null; distanceToCenterKm: number } {
  let bestZone: DeliveryZone | null = null;
  let bestDist = Infinity;

  for (const z of zones) {
    if (!z.isActive) continue;
    const dist = straightLineDistanceKm(lat, lng, z.centerLat, z.centerLng);
    if (dist <= z.radiusKm && dist < bestDist) {
      bestZone = z;
      bestDist = dist;
    }
  }

  return {
    zone: bestZone,
    distanceToCenterKm: Number.isFinite(bestDist) ? bestDist : 0,
  };
}

function roundTo250(val: number): number {
  return Math.max(0, Math.round(val / 250) * 250);
}

export function clampWithSettings(
  amount: number,
  pricing: Pick<PricingSettings, 'minFeeIqd' | 'maxFeeIqd'>
): number {
  const floor = Math.max(0, pricing.minFeeIqd);
  const ceiling = Math.max(floor, pricing.maxFeeIqd);
  return Math.min(ceiling, Math.max(floor, roundTo250(amount)));
}

function computeZoneBaseFee(zone: DeliveryZone, distanceKm: number): number {
  if (zone.pricingMode === 'fixed') return zone.fixedFeeIqd;
  return zone.baseFeeIqd + distanceKm * zone.perKmFeeIqd;
}

export function calculateZoneDeliveryQuote(params: {
  distanceKm: number;
  pickupLat: number;
  pickupLng: number;
  deliveryLat: number;
  deliveryLng: number;
  zones: DeliveryZone[];
  routeRates: ZoneRouteRate[];
  pricing: PricingSettings;
}): DeliveryQuote {
  const { distanceKm, pickupLat, pickupLng, deliveryLat, deliveryLng, zones, routeRates, pricing } =
    params;

  const { zone: pickupZone } = matchDeliveryZone(pickupLat, pickupLng, zones);
  const { zone: deliveryZone } = matchDeliveryZone(deliveryLat, deliveryLng, zones);

  if (pickupZone && !pickupZone.isCovered) {
    return {
      covered: false,
      reason: `التغطية متوقفة حالياً في منطقة الاستلام (${pickupZone.name}) بقرار الإدارة.`,
      distanceKm,
      deliveryFeeIqd: 0,
      pickupZoneId: pickupZone.id,
      pickupZoneName: pickupZone.name,
      deliveryZoneId: deliveryZone?.id,
      deliveryZoneName: deliveryZone?.name,
      zoneId: pickupZone.id,
      zoneName: pickupZone.name,
      longDistanceExtraIqd: 0,
      pricingMode: 'same_zone',
      breakdownLabel: `منطقة ${pickupZone.name} متوقفة مؤقتاً`,
    };
  }

  if (deliveryZone && !deliveryZone.isCovered) {
    return {
      covered: false,
      reason: `التغطية متوقفة حالياً في منطقة التسليم (${deliveryZone.name}) بقرار الإدارة.`,
      distanceKm,
      deliveryFeeIqd: 0,
      pickupZoneId: pickupZone?.id,
      pickupZoneName: pickupZone?.name,
      deliveryZoneId: deliveryZone.id,
      deliveryZoneName: deliveryZone.name,
      zoneId: deliveryZone.id,
      zoneName: deliveryZone.name,
      longDistanceExtraIqd: 0,
      pricingMode: 'same_zone',
      breakdownLabel: `منطقة ${deliveryZone.name} متوقفة مؤقتاً`,
    };
  }

  const thresholdKm = Math.max(0, pricing.longDistanceThresholdKm || 0);
  const extraKm = thresholdKm > 0 && distanceKm > thresholdKm ? distanceKm - thresholdKm : 0;
  const longDistanceExtraIqd =
    extraKm > 0 && pricing.longDistancePerKmFeeIqd > 0
      ? roundTo250(extraKm * pricing.longDistancePerKmFeeIqd)
      : 0;

  // Case 1: Both points inside defined zones
  if (pickupZone && deliveryZone) {
    // 1A: Same Zone
    if (pickupZone.id === deliveryZone.id) {
      const base = computeZoneBaseFee(pickupZone, distanceKm);
      const fee = clampWithSettings(base + longDistanceExtraIqd, pricing);
      const modeText =
        pickupZone.pricingMode === 'fixed'
          ? `أجرة منطقة ${pickupZone.name}`
          : `منطقة ${pickupZone.name} (${formatIqd(pickupZone.baseFeeIqd)} + ${formatIqd(pickupZone.perKmFeeIqd)}/كم)`;
      return {
        covered: true,
        distanceKm,
        deliveryFeeIqd: fee,
        pickupZoneId: pickupZone.id,
        pickupZoneName: pickupZone.name,
        deliveryZoneId: deliveryZone.id,
        deliveryZoneName: deliveryZone.name,
        zoneId: deliveryZone.id,
        zoneName: deliveryZone.name,
        longDistanceExtraIqd,
        pricingMode: longDistanceExtraIqd > 0 ? 'long_distance' : 'same_zone',
        breakdownLabel:
          longDistanceExtraIqd > 0
            ? `${modeText} + مسافة بعيدة (${formatIqd(longDistanceExtraIqd)})`
            : modeText,
      };
    }

    // 1B: Between two different zones — check custom Manager route rate table first
    const matchedRoute = routeRates.find(
      (r) =>
        r.isActive &&
        ((r.fromZoneId === pickupZone.id && r.toZoneId === deliveryZone.id) ||
          (r.bidirectional && r.fromZoneId === deliveryZone.id && r.toZoneId === pickupZone.id))
    );

    if (matchedRoute) {
      const fee = clampWithSettings(matchedRoute.feeIqd + longDistanceExtraIqd, pricing);
      return {
        covered: true,
        distanceKm,
        deliveryFeeIqd: fee,
        pickupZoneId: pickupZone.id,
        pickupZoneName: pickupZone.name,
        deliveryZoneId: deliveryZone.id,
        deliveryZoneName: deliveryZone.name,
        zoneId: deliveryZone.id,
        zoneName: `${pickupZone.name} ← ${deliveryZone.name}`,
        longDistanceExtraIqd,
        pricingMode: 'route_table',
        breakdownLabel:
          longDistanceExtraIqd > 0
            ? `أجرة مسار (${pickupZone.name} ← ${deliveryZone.name}) من جدول المدير + مسافة بعيدة`
            : `أجرة مسار (${pickupZone.name} ← ${deliveryZone.name}) من جدول المدير`,
      };
    }

    // 1C: Between two different zones using Manager's inter-zone fallback rule
    const baseMax = Math.max(
      computeZoneBaseFee(pickupZone, distanceKm),
      computeZoneBaseFee(deliveryZone, distanceKm)
    );
    const interZoneExtra = Math.max(0, pricing.interZoneFeeIqd || 0);
    const fee = clampWithSettings(baseMax + interZoneExtra + longDistanceExtraIqd, pricing);
    return {
      covered: true,
      distanceKm,
      deliveryFeeIqd: fee,
      pickupZoneId: pickupZone.id,
      pickupZoneName: pickupZone.name,
      deliveryZoneId: deliveryZone.id,
      deliveryZoneName: deliveryZone.name,
      zoneId: deliveryZone.id,
      zoneName: `${pickupZone.name} ← ${deliveryZone.name}`,
      longDistanceExtraIqd,
      pricingMode: 'inter_zone',
      breakdownLabel: `انتقال بين منطقتين (${pickupZone.name} ← ${deliveryZone.name})${
        longDistanceExtraIqd > 0 ? ' + مسافة بعيدة' : ''
      }`,
    };
  }

  // Case 2: At least one point is outside defined coverage zones
  if (!pricing.outsideZonesAllowed) {
    return {
      covered: false,
      reason: 'موقع الاستلام أو التسليم خارج نطاق المناطق المغطاة حالياً من الإدارة.',
      distanceKm,
      deliveryFeeIqd: 0,
      pickupZoneId: pickupZone?.id,
      pickupZoneName: pickupZone?.name,
      deliveryZoneId: deliveryZone?.id,
      deliveryZoneName: deliveryZone?.name,
      zoneId: deliveryZone?.id || pickupZone?.id,
      zoneName: deliveryZone?.name || pickupZone?.name,
      longDistanceExtraIqd: 0,
      pricingMode: 'global_distance',
      breakdownLabel: 'خارج نطاق التغطية',
    };
  }

  const knownZone = deliveryZone || pickupZone;
  const baseRaw = knownZone
    ? computeZoneBaseFee(knownZone, distanceKm)
    : pricing.baseFeeIqd + distanceKm * pricing.perKmFeeIqd;
  const surcharge = Math.max(0, pricing.outsideZoneSurchargeIqd || 0);
  const fee = clampWithSettings(baseRaw + surcharge + longDistanceExtraIqd, pricing);

  return {
    covered: true,
    distanceKm,
    deliveryFeeIqd: fee,
    pickupZoneId: pickupZone?.id,
    pickupZoneName: pickupZone?.name,
    deliveryZoneId: deliveryZone?.id,
    deliveryZoneName: deliveryZone?.name,
    zoneId: deliveryZone?.id || pickupZone?.id,
    zoneName: deliveryZone?.name || pickupZone?.name || 'خارج المناطق',
    longDistanceExtraIqd,
    pricingMode: longDistanceExtraIqd > 0 ? 'long_distance' : 'global_distance',
    breakdownLabel: `تسعيرة المسافات البعيدة وخارج المناطق${
      surcharge > 0 ? ` (+${formatIqd(surcharge)})` : ''
    }`,
  };
}

export function formatIqd(amount: number): string {
  return `${Math.round(amount).toLocaleString('en-US')} د.ع`;
}
