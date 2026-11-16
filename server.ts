import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  calculateZoneDeliveryQuote,
  haversineDistanceKm,
  type AccountStatus,
  type BackupInfo,
  type DeliveryZone,
  type Driver,
  type Order,
  type OrderStatus,
  type PricingSettings,
  type SenderType,
  type Shop,
  type UserAccount,
  type UserRole,
  type VehicleType,
  type ZonePricingMode,
  type ZoneRouteRate,
} from './src/types.ts';

interface StoredUser extends UserAccount {
  passwordHash: string;
}

interface DatabaseSchema {
  users: StoredUser[];
  shops: Shop[];
  drivers: Driver[];
  orders: Order[];
  zones: DeliveryZone[];
  routeRates: ZoneRouteRate[];
  settings: PricingSettings;
  migrationVersion?: number;
}

interface SessionPayload {
  userId: string;
  role: UserRole;
  exp: number;
}

interface AuthedRequest extends Request {
  authUser?: StoredUser;
}

const PORT = Number(process.env.PORT || 3000);
const IS_VERCEL = Boolean(process.env.VERCEL);
const SOURCE_DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_DIR = IS_VERCEL ? path.join('/tmp', 'waselha-data') : SOURCE_DATA_DIR;
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'waselha-db.json');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(BACKUPS_DIR, { recursive: true });

if (IS_VERCEL && !fs.existsSync(DB_FILE)) {
  const seedDbFile = path.join(SOURCE_DATA_DIR, 'waselha-db.json');
  if (fs.existsSync(seedDbFile)) {
    fs.copyFileSync(seedDbFile, DB_FILE);
  }
}

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET !== 'CHANGE_ME_IN_PRODUCTION') {
    return process.env.SESSION_SECRET;
  }
  if (fs.existsSync(SECRET_FILE)) {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, generated, 'utf8');
  return generated;
}

const SESSION_SECRET = getSessionSecret();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function signToken(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.userId || !parsed.role || typeof parsed.exp !== 'number') return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizePhone(phone: string): string {
  const ascii = phone
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s\-()]/g, '')
    .trim();
  if (ascii.startsWith('+964')) return `0${ascii.slice(4)}`;
  if (ascii.startsWith('00964')) return `0${ascii.slice(5)}`;
  return ascii;
}

function createDefaultZones(now: string): DeliveryZone[] {
  return [
    {
      id: 'zone_karrada',
      name: 'الكرادة',
      city: 'بغداد',
      centerLat: 33.3068,
      centerLng: 44.4285,
      radiusKm: 4.5,
      pricingMode: 'fixed',
      fixedFeeIqd: 3000,
      baseFeeIqd: 2000,
      perKmFeeIqd: 500,
      isCovered: true,
      isActive: true,
      notes: 'الكرادة داخل وخارج وساحة كهرمانة',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'zone_mansour',
      name: 'المنصور',
      city: 'بغداد',
      centerLat: 33.3152,
      centerLng: 44.3468,
      radiusKm: 4.5,
      pricingMode: 'fixed',
      fixedFeeIqd: 3500,
      baseFeeIqd: 2000,
      perKmFeeIqd: 500,
      isCovered: true,
      isActive: true,
      notes: '14 رمضان والأميرات والدراغ',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'zone_jadriya',
      name: 'الجادرية',
      city: 'بغداد',
      centerLat: 33.2856,
      centerLng: 44.3822,
      radiusKm: 4.0,
      pricingMode: 'fixed',
      fixedFeeIqd: 3500,
      baseFeeIqd: 2000,
      perKmFeeIqd: 500,
      isCovered: true,
      isActive: true,
      notes: 'الجادرية والجامعة',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'zone_zayouna',
      name: 'زيونة',
      city: 'بغداد',
      centerLat: 33.3389,
      centerLng: 44.4552,
      radiusKm: 4.5,
      pricingMode: 'distance',
      fixedFeeIqd: 4000,
      baseFeeIqd: 2500,
      perKmFeeIqd: 600,
      isCovered: true,
      isActive: true,
      notes: 'شارع الربيعي ومحيطه',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'zone_yarmouk',
      name: 'اليرموك والحارثية',
      city: 'بغداد',
      centerLat: 33.301,
      centerLng: 44.335,
      radiusKm: 4.0,
      pricingMode: 'fixed',
      fixedFeeIqd: 3500,
      baseFeeIqd: 2000,
      perKmFeeIqd: 500,
      isCovered: true,
      isActive: true,
      notes: 'اليرموك والحارثية والقادسية',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'zone_adhamiya',
      name: 'الأعظمية',
      city: 'بغداد',
      centerLat: 33.3712,
      centerLng: 44.3755,
      radiusKm: 4.5,
      pricingMode: 'distance',
      fixedFeeIqd: 4500,
      baseFeeIqd: 2500,
      perKmFeeIqd: 650,
      isCovered: true,
      isActive: true,
      notes: 'شارع الضباط والأخطل والسفينة',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function createDefaultRouteRates(now: string, zones: DeliveryZone[]): ZoneRouteRate[] {
  const byId = new Map(zones.map((z) => [z.id, z]));
  const pairs: Array<[string, string, number, string]> = [
    ['zone_karrada', 'zone_mansour', 5000, 'مسار مباشر الكرادة ↔ المنصور'],
    ['zone_karrada', 'zone_jadriya', 3500, 'مسار قريب الكرادة ↔ الجادرية'],
    ['zone_mansour', 'zone_yarmouk', 3500, 'مسار قريب المنصور ↔ اليرموك والحارثية'],
    ['zone_karrada', 'zone_zayouna', 4500, 'مسار الكرادة ↔ زيونة'],
    ['zone_mansour', 'zone_adhamiya', 6000, 'مسار المنصور ↔ الأعظمية'],
  ];

  const out: ZoneRouteRate[] = [];
  for (const [fromId, toId, feeIqd, notes] of pairs) {
    const f = byId.get(fromId);
    const t = byId.get(toId);
    if (!f || !t) continue;
    out.push({
      id: `rt_${fromId}_${toId}`,
      fromZoneId: f.id,
      toZoneId: t.id,
      fromZoneName: f.name,
      toZoneName: t.name,
      feeIqd,
      bidirectional: true,
      isActive: true,
      notes,
      createdAt: now,
      updatedAt: now,
    });
  }
  return out;
}

function createInitialDatabase(): DatabaseSchema {
  const now = new Date().toISOString();
  const earlier1 = new Date(Date.now() - 1000 * 60 * 180).toISOString();
  const earlier2 = new Date(Date.now() - 1000 * 60 * 65).toISOString();
  const earlier3 = new Date(Date.now() - 1000 * 60 * 20).toISOString();

  const superAdminId = 'usr_super_admin_07716736168';
  const driverUser1Id = 'usr_drv_hussein';
  const driverUser2Id = 'usr_drv_ali';
  const customer1Id = 'usr_cust_mustafa';
  const shopSenderId = 'usr_cust_karrada_fashion';

  const driver1Id = 'drv_hussein_kaabi';
  const driver2Id = 'drv_ali_dulaimi';

  const settings: PricingSettings = {
    baseFeeIqd: 2000,
    perKmFeeIqd: 500,
    minFeeIqd: 2000,
    maxFeeIqd: 20000,
    interZoneFeeIqd: 1500,
    longDistanceThresholdKm: 8,
    longDistancePerKmFeeIqd: 500,
    platformCommissionPct: 25,
    outsideZonesAllowed: true,
    outsideZoneSurchargeIqd: 2000,
    appName: 'وصلها - WASELHA',
    supportPhone: '07716736168',
    maintenanceMode: false,
    updatedAt: now,
  };

  const zones = createDefaultZones(now);
  const routeRates = createDefaultRouteRates(now, zones);

  const users: StoredUser[] = [
    {
      id: superAdminId,
      name: 'المدير العام - وصلها',
      phone: '07716736168',
      role: 'super_admin',
      status: 'active',
      passwordHash: hashPassword('20032003hasanali'),
      createdAt: earlier1,
    },
    {
      id: driverUser1Id,
      name: 'حسين الكعبي',
      phone: '07701112233',
      role: 'driver',
      status: 'active',
      driverId: driver1Id,
      passwordHash: hashPassword('123456'),
      createdAt: earlier1,
    },
    {
      id: driverUser2Id,
      name: 'علي الدليمي',
      phone: '07802223344',
      role: 'driver',
      status: 'active',
      driverId: driver2Id,
      passwordHash: hashPassword('123456'),
      createdAt: earlier1,
    },
    {
      id: customer1Id,
      name: 'مصطفى الجبوري',
      phone: '07719998877',
      role: 'customer',
      status: 'active',
      passwordHash: hashPassword('123456'),
      createdAt: earlier1,
    },
    {
      id: shopSenderId,
      name: 'أزياء النخبة - الكرادة',
      phone: '07705556677',
      role: 'customer',
      status: 'active',
      passwordHash: hashPassword('123456'),
      createdAt: earlier1,
    },
  ];

  const drivers: Driver[] = [
    {
      id: driver1Id,
      ownerId: driverUser1Id,
      name: 'حسين الكعبي',
      phone: '07701112233',
      vehicleType: 'motorcycle',
      plateNumber: 'بغداد 48219',
      isOnline: true,
      status: 'active',
      lat: 33.3128,
      lng: 44.3661,
      completedCount: 1,
      earningsIqd: 3000,
      createdAt: earlier1,
      updatedAt: now,
    },
    {
      id: driver2Id,
      ownerId: driverUser2Id,
      name: 'علي الدليمي',
      phone: '07802223344',
      vehicleType: 'car',
      plateNumber: 'بغداد 91503 أ',
      isOnline: true,
      status: 'active',
      lat: 33.321,
      lng: 44.412,
      completedCount: 0,
      earningsIqd: 0,
      createdAt: earlier1,
      updatedAt: now,
    },
  ];

  // Exact 25% platform / 75% driver commission calculation on freelance parcel deliveries
  const orders: Order[] = [
    {
      id: 'ord_seed_1001',
      trackingCode: 'WSH-1001',
      customerId: shopSenderId,
      senderType: 'shop',
      senderName: 'أزياء النخبة - الكرادة',
      senderPhone: '07705556677',
      recipientName: 'سارة علي',
      recipientPhone: '07721110022',
      itemName: 'طرد ملابس مغلف',
      itemDescription: 'حقيبة قماشية صغيرة، يُرجى الاتصال قبل الوصول',
      driverId: driver1Id,
      driverName: 'حسين الكعبي',
      driverPhone: '07701112233',
      pickupZoneId: 'zone_karrada',
      pickupZoneName: 'الكرادة',
      deliveryZoneId: 'zone_jadriya',
      deliveryZoneName: 'الجادرية',
      zoneId: 'zone_jadriya',
      zoneName: 'الكرادة ← الجادرية',
      pricingBreakdown: 'أجرة مسار (الكرادة ← الجادرية) من جدول المدير',
      pickupAddress: 'بغداد - الكرادة داخل، قرب ساحة كهرمانة',
      pickupLat: 33.3068,
      pickupLng: 44.4285,
      deliveryAddress: 'بغداد - الجادرية، قرب جامعة بغداد',
      deliveryLat: 33.2856,
      deliveryLng: 44.3822,
      distanceKm: 4.8,
      notes: 'تسليم باليد للمستلم',
      deliveryFeeIqd: 4000,
      platformFeeIqd: 1000,
      driverNetIqd: 3000,
      status: 'delivered',
      createdAt: earlier1,
      updatedAt: earlier2,
    },
    {
      id: 'ord_seed_1002',
      trackingCode: 'WSH-1002',
      customerId: customer1Id,
      senderType: 'individual',
      senderName: 'مصطفى الجبوري',
      senderPhone: '07719998877',
      recipientName: 'مكتب المهندس طارق',
      recipientPhone: '07815554433',
      itemName: 'مغلف أوراق وعقود عمل',
      itemDescription: 'ظرف مستندات A4 يحتاج توصيل سريع وآمن',
      driverId: driver2Id,
      driverName: 'علي الدليمي',
      driverPhone: '07802223344',
      pickupZoneId: 'zone_mansour',
      pickupZoneName: 'المنصور',
      deliveryZoneId: 'zone_yarmouk',
      deliveryZoneName: 'اليرموك والحارثية',
      zoneId: 'zone_yarmouk',
      zoneName: 'المنصور ← اليرموك والحارثية',
      pricingBreakdown: 'أجرة مسار (المنصور ← اليرموك والحارثية) من جدول المدير',
      pickupAddress: 'بغداد - المنصور، شارع 14 رمضان',
      pickupLat: 33.3152,
      pickupLng: 44.3468,
      deliveryAddress: 'بغداد - اليرموك، قرب مستشفى اليرموك',
      deliveryLat: 33.2989,
      deliveryLng: 44.3315,
      distanceKm: 2.9,
      deliveryFeeIqd: 3500,
      platformFeeIqd: 875,
      driverNetIqd: 2625,
      status: 'on_the_way',
      createdAt: earlier2,
      updatedAt: earlier3,
    },
    {
      id: 'ord_seed_1003',
      trackingCode: 'WSH-1003',
      customerId: shopSenderId,
      senderType: 'shop',
      senderName: 'مخبوزات وحلويات بغداد',
      senderPhone: '07835559911',
      recipientName: 'أحمد حسن',
      recipientPhone: '07736667788',
      itemName: 'صندوق حلويات وهدايا',
      itemDescription: 'صندوق متوسط حساس يحتاج عناية أثناء النقل',
      pickupZoneId: 'zone_karrada',
      pickupZoneName: 'الكرادة',
      deliveryZoneId: 'zone_zayouna',
      deliveryZoneName: 'زيونة',
      zoneId: 'zone_zayouna',
      zoneName: 'الكرادة ← زيونة',
      pricingBreakdown: 'أجرة مسار (الكرادة ← زيونة) من جدول المدير',
      pickupAddress: 'بغداد - الكرادة خارج، قرب تقاطع المسبح',
      pickupLat: 33.3045,
      pickupLng: 44.432,
      deliveryAddress: 'بغداد - زيونة، شارع الربيعي',
      deliveryLat: 33.3389,
      deliveryLng: 44.4552,
      distanceKm: 5.1,
      deliveryFeeIqd: 4500,
      platformFeeIqd: 1125,
      driverNetIqd: 3375,
      status: 'pending',
      createdAt: earlier3,
      updatedAt: now,
    },
  ];

  return {
    users,
    shops: [],
    drivers,
    orders,
    zones,
    routeRates,
    settings,
    migrationVersion: 2,
  };
}

function ensureDatabaseMigrations(parsed: DatabaseSchema): boolean {
  let dirty = false;
  const now = new Date().toISOString();

  if (!Array.isArray(parsed.shops)) {
    parsed.shops = [];
    dirty = true;
  }

  if (!Array.isArray(parsed.zones) || parsed.zones.length === 0) {
    parsed.zones = createDefaultZones(now);
    dirty = true;
  }

  if (!Array.isArray(parsed.routeRates)) {
    parsed.routeRates = createDefaultRouteRates(now, parsed.zones);
    dirty = true;
  }

  if (parsed.migrationVersion !== 2) {
    parsed.settings = {
      baseFeeIqd: parsed.settings?.baseFeeIqd ?? 2000,
      perKmFeeIqd: parsed.settings?.perKmFeeIqd ?? 500,
      minFeeIqd: parsed.settings?.minFeeIqd ?? 2000,
      maxFeeIqd: parsed.settings?.maxFeeIqd ?? 20000,
      interZoneFeeIqd: parsed.settings?.interZoneFeeIqd ?? 1500,
      longDistanceThresholdKm: parsed.settings?.longDistanceThresholdKm ?? 8,
      longDistancePerKmFeeIqd: parsed.settings?.longDistancePerKmFeeIqd ?? 500,
      platformCommissionPct: 25,
      outsideZonesAllowed:
        typeof parsed.settings?.outsideZonesAllowed === 'boolean'
          ? parsed.settings.outsideZonesAllowed
          : true,
      outsideZoneSurchargeIqd: parsed.settings?.outsideZoneSurchargeIqd ?? 2000,
      appName: parsed.settings?.appName || 'وصلها - WASELHA',
      supportPhone: parsed.settings?.supportPhone || '07716736168',
      maintenanceMode: Boolean(parsed.settings?.maintenanceMode),
      updatedAt: now,
    };

    // Migrate any legacy e-commerce orders to freelance courier schema cleanly
    if (Array.isArray(parsed.orders)) {
      for (const raw of parsed.orders as unknown as Array<Record<string, unknown>>) {
        if (!raw.senderName) {
          raw.senderName = String(raw.customerName || 'مرسل');
          raw.senderPhone = String(raw.customerPhone || '');
          raw.senderType = raw.shopName ? 'shop' : 'individual';
        }
        if (!raw.recipientPhone) {
          raw.recipientPhone = String(raw.customerPhone || '');
        }
        if (!raw.itemName) {
          const items = Array.isArray(raw.items)
            ? (raw.items as Array<{ name?: string; quantity?: number }>)
            : [];
          raw.itemName =
            items.map((i) => `${i.name || 'غرض'} × ${i.quantity || 1}`).join('، ') || 'طرد للتوصيل';
        }
        if (raw.status === 'ready_for_pickup' || raw.status === 'preparing') {
          raw.status = 'pending';
        }
        const fee = Number(raw.deliveryFeeIqd || 0);
        raw.platformFeeIqd = Math.round((fee * 25) / 100);
        raw.driverNetIqd = fee - Number(raw.platformFeeIqd);
      }
    }

    parsed.migrationVersion = 2;
    dirty = true;
  }

  // Always guarantee Super Admin account 07716736168 exists & is active
  const adminExists = parsed.users.find((u) => normalizePhone(u.phone) === '07716736168');
  if (!adminExists) {
    parsed.users.unshift({
      id: 'usr_super_admin_07716736168',
      name: 'المدير العام - وصلها',
      phone: '07716736168',
      role: 'super_admin',
      status: 'active',
      passwordHash: hashPassword('20032003hasanali'),
      createdAt: now,
    });
    dirty = true;
  } else if (adminExists.role !== 'super_admin' || adminExists.status !== 'active') {
    adminExists.role = 'super_admin';
    adminExists.status = 'active';
    dirty = true;
  }

  return dirty;
}

function loadDatabase(): DatabaseSchema {
  if (!fs.existsSync(DB_FILE)) {
    const initial = createInitialDatabase();
    saveDatabase(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as DatabaseSchema;
    if (ensureDatabaseMigrations(parsed)) {
      saveDatabase(parsed);
    }
    return parsed;
  } catch {
    const initial = createInitialDatabase();
    saveDatabase(initial);
    return initial;
  }
}

function saveDatabase(data: DatabaseSchema): void {
  const tmpFile = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpFile, DB_FILE);
}

function createDatabaseBackup(reason: string, data: DatabaseSchema): BackupInfo {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'manual';
  const filename = `waselha-backup-${stamp}-${safeReason}.json`;
  const payload = {
    meta: {
      createdAt: new Date().toISOString(),
      reason: safeReason,
      ordersCount: data.orders.length,
      zonesCount: data.zones.length,
    },
    database: data,
  };
  const json = JSON.stringify(payload, null, 2);
  fs.writeFileSync(path.join(BACKUPS_DIR, filename), json, 'utf8');

  const files = fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
  for (const old of files.slice(20)) {
    try {
      fs.unlinkSync(path.join(BACKUPS_DIR, old));
    } catch {
      // ignore
    }
  }

  return {
    filename,
    sizeBytes: Buffer.byteLength(json, 'utf8'),
    createdAt: payload.meta.createdAt,
    reason: safeReason,
    ordersCount: data.orders.length,
    zonesCount: data.zones.length,
  };
}

function listDatabaseBackups(): BackupInfo[] {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  const files = fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  const out: BackupInfo[] = [];
  for (const filename of files) {
    try {
      const fullPath = path.join(BACKUPS_DIR, filename);
      const stat = fs.statSync(fullPath);
      const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as {
        meta?: { createdAt?: string; reason?: string; ordersCount?: number; zonesCount?: number };
      };
      out.push({
        filename,
        sizeBytes: stat.size,
        createdAt: parsed.meta?.createdAt || stat.mtime.toISOString(),
        reason: parsed.meta?.reason || 'snapshot',
        ordersCount: parsed.meta?.ordersCount ?? 0,
        zonesCount: parsed.meta?.zonesCount ?? 0,
      });
    } catch {
      // ignore
    }
  }
  return out;
}

let db: DatabaseSchema = loadDatabase();

const existingBackups = listDatabaseBackups();
const newestBackupMs = existingBackups[0] ? Date.parse(existingBackups[0].createdAt) : 0;
if (!newestBackupMs || Date.now() - newestBackupMs > 1000 * 60 * 60 * 12) {
  createDatabaseBackup('auto_startup', db);
}

// Login brute-force protection
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkLoginRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) return true;
  return entry.count < 10;
}

function recordFailedLogin(key: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + 1000 * 60 * 10 });
  } else {
    entry.count += 1;
  }
}

function clearFailedLogin(key: string): void {
  loginAttempts.delete(key);
}

// SSE real-time connected clients
const sseClients = new Set<Response>();

function broadcastRealtime(eventType: string, payload: Record<string, unknown> = {}) {
  const msg = `event: update\ndata: ${JSON.stringify({ type: eventType, ts: Date.now(), ...payload })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch {
      sseClients.delete(client);
    }
  }
}

function sanitizeUser(u: StoredUser): UserAccount {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    role: u.role,
    status: u.status,
    shopId: u.shopId,
    driverId: u.driverId,
    createdAt: u.createdAt,
  };
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      out[k] = v;
    }
  }
  return out;
}

function extractAuthUser(req: Request): StoredUser | undefined {
  const authHeader = req.headers.authorization;
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies.waselha_session || '';
  }
  if (!token) return undefined;
  const payload = verifyToken(token);
  if (!payload) return undefined;
  const user = db.users.find((u) => u.id === payload.userId);
  if (!user || user.status === 'suspended') return undefined;
  return user;
}

function requireAuth(roles?: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const user = extractAuthUser(req);
    if (!user) {
      res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً أو تم إيقاف الحساب.' });
      return;
    }
    if (roles && !roles.includes(user.role)) {
      res.status(403).json({ error: 'ليس لديك صلاحية للوصول إلى هذا القسم.' });
      return;
    }
    req.authUser = user;
    next();
  };
}

function setSessionCookie(res: Response, token: string, req: Request) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `waselha_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${60 * 60 * 24 * 7}`,
    isHttps ? 'SameSite=None; Secure' : 'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function patchHtmlForAppRoute(html: string, reqPath: string): string {
  let manifestPath = '/manifest.webmanifest';
  let pageTitle = 'وصلها - WASELHA | خدمة التوصيل الحر السريع';

  if (reqPath.startsWith('/customer')) {
    manifestPath = '/manifest-customer.json';
    pageTitle = 'وصلها للزبائن والمحلات - WASELHA CUSTOMER';
  } else if (reqPath.startsWith('/driver')) {
    manifestPath = '/manifest-driver.json';
    pageTitle = 'وصلها للمندوبين - WASELHA DRIVER';
  } else if (reqPath.startsWith('/manager')) {
    manifestPath = '/manifest-manager.json';
    pageTitle = 'وصلها للإدارة - WASELHA MANAGER';
  }

  let updated = html.replace(/<title>.*?<\/title>/i, `<title>${pageTitle}</title>`);
  if (updated.includes('rel="manifest"')) {
    updated = updated.replace(/href="[^"]*manifest[^"]*"/i, `href="${manifestPath}"`);
  } else {
    updated = updated.replace(
      '</head>',
      `  <link rel="manifest" href="${manifestPath}" />\n  </head>`
    );
  }
  return updated;
}

export async function createApp(options: { attachFrontend?: boolean } = {}) {
  const attachFrontend = options.attachFrontend ?? !IS_VERCEL;
  const app = express();
  app.set('trust proxy', 1);

  // Security headers & CORS for mobile Capacitor / decoupled web origins
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Accept, Cache-Control, X-Requested-With'
      );
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '10mb' }));
  app.use('/uploads', express.static(UPLOADS_DIR));

  app.get('/api/config/public', (_req, res) => {
    const googleMapsApiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
    res.json({
      googleMapsApiKey,
      appUrl: process.env.APP_URL || '',
    });
  });

  app.get('/api/health', (_req, res) => {
    const hasSuperAdmin = db.users.some(
      (u) => u.role === 'super_admin' && u.status === 'active'
    );
    res.json({
      ok: true,
      service: 'waselha-courier-api',
      dbConnected: fs.existsSync(DB_FILE) || db.users.length > 0,
      hasSuperAdmin,
      usersCount: db.users.length,
      zonesCount: db.zones.length,
      routeRatesCount: db.routeRates.length,
      ordersCount: db.orders.length,
      ts: new Date().toISOString(),
    });
  });

  // SSE Real-time Event Stream
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    if (IS_VERCEL) {
      res.end();
      return;
    }

    sseClients.add(res);

    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
        sseClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  // Public Bootstrap: active zones, inter-zone routes, pricing settings, live driver coordinates
  app.get('/api/bootstrap', (_req, res) => {
    const activeZones = db.zones.filter((z) => z.isActive);
    const activeRoutes = db.routeRates.filter((r) => r.isActive);
    const onlineDrivers = db.drivers
      .filter((d) => d.status === 'active' && d.isOnline)
      .map((d) => ({
        id: d.id,
        name: d.name,
        vehicleType: d.vehicleType,
        lat: d.lat,
        lng: d.lng,
      }));
    res.json({
      zones: activeZones,
      routeRates: activeRoutes,
      settings: db.settings,
      onlineDrivers,
    });
  });

  // Auth: Current Session
  app.get('/api/auth/me', (req: AuthedRequest, res) => {
    const user = extractAuthUser(req);
    if (!user) {
      res.json({ user: null });
      return;
    }
    const driver = user.driverId ? db.drivers.find((d) => d.id === user.driverId) : undefined;
    res.json({ user: sanitizeUser(user), driver });
  });

  // Auth: Phone & Password Login (Super Admin, Driver, Customer/Shop) with rate limiting
  const handleLogin = (req: Request, res: Response, requiredRole?: UserRole) => {
    const body = (req.body || {}) as {
      phone?: string;
      username?: string;
      identifier?: string;
      password?: string;
    };
    const rawPhone = body.phone || body.username || body.identifier || '';
    const password = body.password || '';
    if (!rawPhone || !password) {
      res.status(400).json({ error: 'يرجى إدخال رقم الهاتف وكلمة المرور.' });
      return;
    }
    const normalized = normalizePhone(rawPhone);
    const rateKey = `${req.ip || 'unknown'}:${normalized}`;
    if (!checkLoginRateLimit(rateKey)) {
      res.status(429).json({
        error: 'تم تجاوز الحد المسموح لمحاولات تسجيل الدخول. يرجى الانتظار 10 دقائق ثم المحاولة مجدداً.',
      });
      return;
    }

    const user = db.users.find((u) => normalizePhone(u.phone) === normalized);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      recordFailedLogin(rateKey);
      res.status(401).json({ error: 'رقم الهاتف أو كلمة المرور غير صحيحة.' });
      return;
    }
    if (user.status === 'suspended') {
      res.status(403).json({ error: 'تم إيقاف هذا الحساب من قبل الإدارة. يرجى التواصل مع الدعم.' });
      return;
    }
    if (requiredRole && user.role !== requiredRole) {
      res.status(403).json({ error: 'هذا الحساب لا يملك صلاحية المدير العام (Super Admin).' });
      return;
    }

    clearFailedLogin(rateKey);
    const token = signToken({
      userId: user.id,
      role: user.role,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
    });
    setSessionCookie(res, token, req);
    const driver = user.driverId ? db.drivers.find((d) => d.id === user.driverId) : undefined;
    res.json({ token, user: sanitizeUser(user), driver });
  };

  app.post('/api/auth/login', (req, res) => handleLogin(req, res));
  app.post('/api/admin/login', (req, res) => handleLogin(req, res, 'super_admin'));
  app.post('/api/super-admin/login', (req, res) => handleLogin(req, res, 'super_admin'));
  app.post('/api/auth/admin/login', (req, res) => handleLogin(req, res, 'super_admin'));

  app.post('/api/auth/logout', (req, res) => {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader(
      'Set-Cookie',
      `waselha_session=; Path=/; HttpOnly; Max-Age=0; ${isHttps ? 'SameSite=None; Secure' : 'SameSite=Lax'}`
    );
    res.json({ ok: true });
  });

  // Customer / Shop Sender Registration
  app.post('/api/auth/register-customer', (req, res) => {
    const { name, phone, password } = req.body as {
      name?: string;
      phone?: string;
      password?: string;
    };
    if (!name || name.trim().length < 2 || !phone || !password || password.length < 4) {
      res.status(400).json({
        error: 'يرجى إدخال الاسم ورقم الهاتف وكلمة المرور (4 أحرف على الأقل).',
      });
      return;
    }
    const normalized = normalizePhone(phone);
    if (normalized.length < 9) {
      res.status(400).json({ error: 'يرجى إدخال رقم هاتف عراقي صالح.' });
      return;
    }

    const existing = db.users.find((u) => normalizePhone(u.phone) === normalized);
    if (existing) {
      res.status(409).json({ error: 'رقم الهاتف مسجل مسبقاً في النظام. يمكنك تسجيل الدخول مباشرة.' });
      return;
    }

    const now = new Date().toISOString();
    const userId = `usr_cust_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const newUser: StoredUser = {
      id: userId,
      name: name.trim(),
      phone: normalized,
      role: 'customer',
      status: 'active',
      passwordHash: hashPassword(password),
      createdAt: now,
    };

    db.users.push(newUser);
    saveDatabase(db);
    broadcastRealtime('user_updated', { userId });

    const token = signToken({
      userId,
      role: 'customer',
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
    });
    setSessionCookie(res, token, req);
    res.status(201).json({ token, user: sanitizeUser(newUser) });
  });

  // Driver Registration
  app.post('/api/auth/register-driver', (req, res) => {
    const { name, phone, password, vehicleType, plateNumber } = req.body as {
      name?: string;
      phone?: string;
      password?: string;
      vehicleType?: VehicleType;
      plateNumber?: string;
    };
    if (!name || !phone || !password || password.length < 4) {
      res.status(400).json({ error: 'يرجى إكمال الاسم ورقم الهاتف وكلمة المرور (4 أحرف على الأقل).' });
      return;
    }
    const normalized = normalizePhone(phone);
    if (db.users.some((u) => normalizePhone(u.phone) === normalized)) {
      res.status(409).json({ error: 'رقم الهاتف مسجل مسبقاً في النظام.' });
      return;
    }
    const now = new Date().toISOString();
    const userId = `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
    const driverId = `drv_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
    const validVehicle: VehicleType =
      vehicleType === 'car' || vehicleType === 'bicycle' ? vehicleType : 'motorcycle';

    const newUser: StoredUser = {
      id: userId,
      name: name.trim(),
      phone: normalized,
      role: 'driver',
      status: 'active',
      driverId,
      passwordHash: hashPassword(password),
      createdAt: now,
    };

    const newDriver: Driver = {
      id: driverId,
      ownerId: userId,
      name: name.trim(),
      phone: normalized,
      vehicleType: validVehicle,
      plateNumber: (plateNumber || 'قيد التحديث').trim(),
      isOnline: true,
      status: 'active',
      lat: 33.3152,
      lng: 44.3661,
      completedCount: 0,
      earningsIqd: 0,
      createdAt: now,
      updatedAt: now,
    };

    db.users.push(newUser);
    db.drivers.push(newDriver);
    saveDatabase(db);
    broadcastRealtime('driver_updated', { driverId });

    const token = signToken({
      userId,
      role: 'driver',
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
    });
    setSessionCookie(res, token, req);
    res.status(201).json({ token, user: sanitizeUser(newUser), driver: newDriver });
  });

  // Google Maps Server Proxy
  app.post('/api/maps/reverse-geocode', async (req, res) => {
    const { lat, lng } = req.body as { lat?: number; lng?: number };
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({ error: 'إحداثيات الموقع غير صالحة.' });
      return;
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      res.json({ address: `موقع محدد (${lat.toFixed(4)}, ${lng.toFixed(4)})` });
      return;
    }
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ar&key=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(url);
      const data = (await resp.json()) as {
        results?: Array<{ formatted_address?: string }>;
      };
      const addr = data.results?.[0]?.formatted_address;
      res.json({ address: addr || `بغداد (${lat.toFixed(4)}, ${lng.toFixed(4)})` });
    } catch {
      res.json({ address: `موقع محدد (${lat.toFixed(4)}, ${lng.toFixed(4)})` });
    }
  });

  app.post('/api/maps/geocode', async (req, res) => {
    const { address } = req.body as { address?: string };
    if (!address || !address.trim()) {
      res.status(400).json({ error: 'يرجى كتابة العنوان للبحث.' });
      return;
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'خدمة البحث عن العنوان غير متوفرة حالياً.' });
      return;
    }
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=iq&language=ar&key=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(url);
      const data = (await resp.json()) as {
        results?: Array<{
          formatted_address?: string;
          geometry?: { location?: { lat: number; lng: number } };
        }>;
      };
      const first = data.results?.[0];
      if (!first?.geometry?.location) {
        res.status(404).json({ error: 'لم يتم العثور على العنوان المطلوب.' });
        return;
      }
      res.json({
        lat: first.geometry.location.lat,
        lng: first.geometry.location.lng,
        formattedAddress: first.formatted_address || address,
      });
    } catch {
      res.status(502).json({ error: 'تعذر الاتصال بخدمة تحديد المواقع.' });
    }
  });

  // Customer/Shop: Calculate delivery quote dynamically from pickup & delivery zones + manager's table
  app.post('/api/orders/quote', (req, res) => {
    const { pickupLat, pickupLng, deliveryLat, deliveryLng, distanceKmOverride } = req.body as {
      pickupLat?: number;
      pickupLng?: number;
      deliveryLat?: number;
      deliveryLng?: number;
      distanceKmOverride?: number;
    };
    if (
      typeof pickupLat !== 'number' ||
      typeof pickupLng !== 'number' ||
      typeof deliveryLat !== 'number' ||
      typeof deliveryLng !== 'number'
    ) {
      res.status(400).json({ error: 'يرجى تحديد موقع الاستلام وموقع التسليم على الخريطة.' });
      return;
    }
    const distKm =
      typeof distanceKmOverride === 'number' && distanceKmOverride > 0
        ? Math.round(distanceKmOverride * 100) / 100
        : haversineDistanceKm(pickupLat, pickupLng, deliveryLat, deliveryLng);

    const quote = calculateZoneDeliveryQuote({
      distanceKm: distKm,
      pickupLat,
      pickupLng,
      deliveryLat,
      deliveryLng,
      zones: db.zones,
      routeRates: db.routeRates,
      pricing: db.settings,
    });
    res.json({ quote, settings: db.settings });
  });

  // Customer/Shop: Create Freelance Courier Delivery Order
  app.post('/api/orders', (req: AuthedRequest, res) => {
    if (db.settings.maintenanceMode) {
      res.status(503).json({ error: 'التطبيق في وضع الصيانة المؤقت حالياً.' });
      return;
    }
    const {
      senderType,
      senderName,
      senderPhone,
      recipientName,
      recipientPhone,
      itemName,
      itemDescription,
      pickupAddress,
      pickupLat,
      pickupLng,
      deliveryAddress,
      deliveryLat,
      deliveryLng,
      notes,
      distanceKmOverride,
    } = req.body as {
      senderType?: SenderType;
      senderName?: string;
      senderPhone?: string;
      recipientName?: string;
      recipientPhone?: string;
      itemName?: string;
      itemDescription?: string;
      pickupAddress?: string;
      pickupLat?: number;
      pickupLng?: number;
      deliveryAddress?: string;
      deliveryLat?: number;
      deliveryLng?: number;
      notes?: string;
      distanceKmOverride?: number;
    };

    if (!itemName || itemName.trim().length < 2) {
      res.status(400).json({ error: 'يرجى كتابة اسم الغرض أو وصفه المطلوب توصيله.' });
      return;
    }
    if (!senderName || senderName.trim().length < 2) {
      res.status(400).json({ error: 'يرجى إدخال اسم المرسل أو المحل.' });
      return;
    }
    const normSenderPhone = normalizePhone(senderPhone || '');
    if (normSenderPhone.length < 9) {
      res.status(400).json({ error: 'يرجى إدخال رقم هاتف المرسل بشكل صحيح.' });
      return;
    }
    const normRecipientPhone = normalizePhone(recipientPhone || '');
    if (normRecipientPhone.length < 9) {
      res.status(400).json({ error: 'يرجى إدخال رقم هاتف المستلم بشكل صحيح.' });
      return;
    }
    if (!pickupAddress || pickupAddress.trim().length < 2) {
      res.status(400).json({ error: 'يرجى تحديد عنوان استلام الغرض.' });
      return;
    }
    if (!deliveryAddress || deliveryAddress.trim().length < 2) {
      res.status(400).json({ error: 'يرجى تحديد عنوان تسليم الغرض.' });
      return;
    }
    if (
      typeof pickupLat !== 'number' ||
      typeof pickupLng !== 'number' ||
      typeof deliveryLat !== 'number' ||
      typeof deliveryLng !== 'number'
    ) {
      res.status(400).json({ error: 'يرجى تحديد نقطتي الاستلام والتسليم على الخريطة.' });
      return;
    }

    const distKm =
      typeof distanceKmOverride === 'number' && distanceKmOverride > 0
        ? Math.round(distanceKmOverride * 100) / 100
        : haversineDistanceKm(pickupLat, pickupLng, deliveryLat, deliveryLng);

    const quote = calculateZoneDeliveryQuote({
      distanceKm: distKm,
      pickupLat,
      pickupLng,
      deliveryLat,
      deliveryLng,
      zones: db.zones,
      routeRates: db.routeRates,
      pricing: db.settings,
    });

    if (!quote.covered) {
      res.status(400).json({
        error: quote.reason || 'هذا المسار خارج نطاق مناطق التغطية المفعّلة حالياً.',
      });
      return;
    }

    const deliveryFeeIqd = quote.deliveryFeeIqd;
    const platformFeeIqd = Math.round((deliveryFeeIqd * db.settings.platformCommissionPct) / 100);
    const driverNetIqd = deliveryFeeIqd - platformFeeIqd;

    const authedUser = extractAuthUser(req);
    let senderUser = db.users.find((u) => normalizePhone(u.phone) === normSenderPhone);
    if (!senderUser) {
      senderUser = {
        id: `usr_cust_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
        name: senderName.trim(),
        phone: normSenderPhone,
        role: 'customer',
        status: 'active',
        passwordHash: hashPassword(crypto.randomBytes(12).toString('hex')),
        createdAt: new Date().toISOString(),
      };
      db.users.push(senderUser);
    } else if (senderUser.status === 'suspended') {
      res.status(403).json({ error: 'هذا الرقم موقوف مؤقتاً من إجراء طلبات التوصيل.' });
      return;
    }

    const now = new Date().toISOString();
    const trackingNum = 1001 + db.orders.length;
    const order: Order = {
      id: `ord_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      trackingCode: `WSH-${trackingNum}`,
      customerId: authedUser?.id || senderUser.id,
      senderType: senderType === 'shop' ? 'shop' : 'individual',
      senderName: senderName.trim(),
      senderPhone: normSenderPhone,
      recipientName: recipientName?.trim() || undefined,
      recipientPhone: normRecipientPhone,
      itemName: itemName.trim(),
      itemDescription: itemDescription?.trim() || undefined,
      rejectedByDriverIds: [],
      pickupZoneId: quote.pickupZoneId,
      pickupZoneName: quote.pickupZoneName,
      deliveryZoneId: quote.deliveryZoneId,
      deliveryZoneName: quote.deliveryZoneName,
      zoneId: quote.zoneId,
      zoneName: quote.zoneName,
      pricingBreakdown: quote.breakdownLabel,
      pickupAddress: pickupAddress.trim(),
      pickupLat,
      pickupLng,
      deliveryAddress: deliveryAddress.trim(),
      deliveryLat,
      deliveryLng,
      distanceKm: distKm,
      notes: notes?.trim() || undefined,
      deliveryFeeIqd,
      platformFeeIqd,
      driverNetIqd,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    db.orders.unshift(order);
    saveDatabase(db);
    broadcastRealtime('order_created', { orderId: order.id });
    res.status(201).json({ order });
  });

  // Track orders by phone (sender OR recipient), tracking code, or saved IDs
  app.get('/api/orders/track', (req, res) => {
    const phone = normalizePhone(String(req.query.phone || ''));
    const code = String(req.query.code || '').trim().toUpperCase();
    const idsRaw = String(req.query.ids || '').trim();

    let matches: Order[] = [];
    if (phone.length >= 6) {
      matches = db.orders.filter(
        (o) =>
          normalizePhone(o.senderPhone) === phone ||
          normalizePhone(o.recipientPhone) === phone
      );
    } else if (code) {
      matches = db.orders.filter(
        (o) => o.trackingCode.toUpperCase() === code || o.id.toUpperCase() === code
      );
    } else if (idsRaw) {
      const idSet = new Set(idsRaw.split(',').map((s) => s.trim()).filter(Boolean));
      matches = db.orders.filter((o) => idSet.has(o.id));
    }
    res.json({ orders: matches });
  });

  // ==================== DRIVER ROUTES ====================
  app.get('/api/driver/orders', requireAuth(['driver', 'super_admin']), (req: AuthedRequest, res) => {
    const driver = db.drivers.find((d) => d.ownerId === req.authUser!.id);
    if (!driver && req.authUser!.role !== 'super_admin') {
      res.status(404).json({ error: 'ملف المندوب غير موجود.' });
      return;
    }
    const available = db.orders.filter(
      (o) =>
        o.status === 'pending' &&
        !o.driverId &&
        (!driver || !(o.rejectedByDriverIds || []).includes(driver.id))
    );
    const mine = driver
      ? db.orders.filter((o) => o.driverId === driver.id)
      : db.orders.filter((o) => Boolean(o.driverId));
    res.json({ driver, available, mine });
  });

  app.post(
    '/api/driver/orders/:id/accept',
    requireAuth(['driver']),
    (req: AuthedRequest, res) => {
      const driver = db.drivers.find((d) => d.ownerId === req.authUser!.id);
      if (!driver || driver.status === 'suspended') {
        res.status(403).json({ error: 'حساب المندوب غير مفعل.' });
        return;
      }
      const order = db.orders.find((o) => o.id === req.params.id);
      if (!order) {
        res.status(404).json({ error: 'الطلب غير موجود.' });
        return;
      }
      if (order.driverId) {
        res.status(409).json({ error: 'تم قبول هذا الطلب من قبل مندوب آخر.' });
        return;
      }
      if (order.status === 'cancelled' || order.status === 'delivered') {
        res.status(400).json({ error: 'لا يمكن قبول طلب منتهي.' });
        return;
      }

      order.driverId = driver.id;
      order.driverName = driver.name;
      order.driverPhone = driver.phone;
      order.status = 'accepted';
      order.updatedAt = new Date().toISOString();
      saveDatabase(db);
      broadcastRealtime('order_updated', { orderId: order.id });
      res.json({ order });
    }
  );

  app.post(
    '/api/driver/orders/:id/reject',
    requireAuth(['driver']),
    (req: AuthedRequest, res) => {
      const driver = db.drivers.find((d) => d.ownerId === req.authUser!.id);
      if (!driver || driver.status === 'suspended') {
        res.status(403).json({ error: 'حساب المندوب غير مفعل.' });
        return;
      }
      const order = db.orders.find((o) => o.id === req.params.id);
      if (!order) {
        res.status(404).json({ error: 'الطلب غير موجود.' });
        return;
      }
      if (!Array.isArray(order.rejectedByDriverIds)) {
        order.rejectedByDriverIds = [];
      }
      if (!order.rejectedByDriverIds.includes(driver.id)) {
        order.rejectedByDriverIds.push(driver.id);
      }
      order.updatedAt = new Date().toISOString();
      saveDatabase(db);
      res.json({ ok: true });
    }
  );

  app.patch(
    '/api/driver/orders/:id/status',
    requireAuth(['driver']),
    (req: AuthedRequest, res) => {
      const driver = db.drivers.find((d) => d.ownerId === req.authUser!.id);
      const order = db.orders.find((o) => o.id === req.params.id);
      if (!driver || !order) {
        res.status(404).json({ error: 'الطلب أو المندوب غير موجود.' });
        return;
      }
      if (order.driverId !== driver.id) {
        res.status(403).json({ error: 'هذا الطلب ليس مسنداً لك.' });
        return;
      }
      if (order.status === 'delivered' || order.status === 'cancelled') {
        res.status(400).json({ error: 'هذا الطلب مكتمل أو ملغى بالفعل.' });
        return;
      }

      const { status } = req.body as { status?: OrderStatus };
      const allowed: OrderStatus[] = ['accepted', 'picked_up', 'on_the_way', 'delivered'];
      if (!status || !allowed.includes(status)) {
        res.status(400).json({ error: 'حالة التوصيل غير صالحة.' });
        return;
      }

      order.status = status;
      order.updatedAt = new Date().toISOString();

      if (status === 'delivered') {
        driver.completedCount += 1;
        driver.earningsIqd += order.driverNetIqd;
        driver.updatedAt = order.updatedAt;
      }

      saveDatabase(db);
      broadcastRealtime('order_updated', { orderId: order.id });
      broadcastRealtime('driver_updated', { driverId: driver.id });
      res.json({ order, driver });
    }
  );

  app.patch('/api/driver/profile', requireAuth(['driver']), (req: AuthedRequest, res) => {
    const driver = db.drivers.find((d) => d.ownerId === req.authUser!.id);
    if (!driver) {
      res.status(404).json({ error: 'ملف المندوب غير موجود.' });
      return;
    }
    const { isOnline, lat, lng } = req.body as {
      isOnline?: boolean;
      lat?: number;
      lng?: number;
    };
    if (typeof isOnline === 'boolean') driver.isOnline = isOnline;
    if (typeof lat === 'number' && Number.isFinite(lat)) driver.lat = lat;
    if (typeof lng === 'number' && Number.isFinite(lng)) driver.lng = lng;
    driver.updatedAt = new Date().toISOString();
    saveDatabase(db);
    broadcastRealtime('driver_updated', { driverId: driver.id });
    res.json({ driver });
  });

  // ==================== SUPER ADMIN ROUTES ====================
  app.get('/api/admin/overview', requireAuth(['super_admin']), (_req, res) => {
    const deliveredOrders = db.orders.filter((o) => o.status === 'delivered');
    const totalDeliveryFeesIqd = deliveredOrders.reduce((sum, o) => sum + o.deliveryFeeIqd, 0);
    const totalPlatformRevenueIqd = deliveredOrders.reduce((sum, o) => sum + o.platformFeeIqd, 0);
    const totalDriverEarningsIqd = deliveredOrders.reduce((sum, o) => sum + o.driverNetIqd, 0);

    const statusCounts: Record<string, number> = {
      pending: 0,
      accepted: 0,
      picked_up: 0,
      on_the_way: 0,
      delivered: 0,
      cancelled: 0,
    };
    for (const o of db.orders) {
      statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    }

    const zonePerformance = db.zones.map((z) => {
      const zoneOrders = db.orders.filter(
        (o) => o.deliveryZoneId === z.id || o.pickupZoneId === z.id || o.zoneId === z.id
      );
      const completed = zoneOrders.filter((o) => o.status === 'delivered');
      return {
        id: z.id,
        name: z.name,
        ordersCount: zoneOrders.length,
        revenueIqd: completed.reduce((acc, o) => acc + o.deliveryFeeIqd, 0),
      };
    });

    res.json({
      users: db.users.map(sanitizeUser),
      drivers: db.drivers,
      orders: db.orders,
      zones: db.zones,
      routeRates: db.routeRates,
      settings: db.settings,
      backups: listDatabaseBackups(),
      analytics: {
        totalOrders: db.orders.length,
        deliveredCount: deliveredOrders.length,
        activeCount: db.orders.filter((o) => !['delivered', 'cancelled'].includes(o.status)).length,
        totalDeliveryFeesIqd,
        totalPlatformRevenueIqd,
        totalDriverEarningsIqd,
        statusCounts,
        zonePerformance,
      },
    });
  });

  // Zones & Coverage Management (Super Admin Only)
  app.get('/api/admin/zones', requireAuth(['super_admin']), (_req, res) => {
    res.json({ zones: db.zones });
  });

  app.post('/api/admin/zones', requireAuth(['super_admin']), (req, res) => {
    const {
      name,
      city,
      centerLat,
      centerLng,
      radiusKm,
      pricingMode,
      fixedFeeIqd,
      baseFeeIqd,
      perKmFeeIqd,
      isCovered,
      isActive,
      notes,
    } = req.body as Partial<DeliveryZone>;

    if (!name || name.trim().length < 2) {
      res.status(400).json({ error: 'يرجى إدخال اسم المنطقة أو الحي.' });
      return;
    }
    const latNum = Number(centerLat);
    const lngNum = Number(centerLng);
    const radNum = Number(radiusKm);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum) || !Number.isFinite(radNum) || radNum <= 0) {
      res.status(400).json({ error: 'يرجى تحديد مركز المنطقة ونصف قطر التغطية بالكيلومتر.' });
      return;
    }

    const mode: ZonePricingMode = pricingMode === 'fixed' ? 'fixed' : 'distance';
    const now = new Date().toISOString();
    const zone: DeliveryZone = {
      id: `zone_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
      name: name.trim(),
      city: (city || 'بغداد').trim(),
      centerLat: latNum,
      centerLng: lngNum,
      radiusKm: Math.min(200, Math.max(0.5, Math.round(radNum * 10) / 10)),
      pricingMode: mode,
      fixedFeeIqd: Math.max(0, Math.round(Number(fixedFeeIqd ?? db.settings.baseFeeIqd))),
      baseFeeIqd: Math.max(0, Math.round(Number(baseFeeIqd ?? db.settings.baseFeeIqd))),
      perKmFeeIqd: Math.max(0, Math.round(Number(perKmFeeIqd ?? db.settings.perKmFeeIqd))),
      isCovered: typeof isCovered === 'boolean' ? isCovered : true,
      isActive: typeof isActive === 'boolean' ? isActive : true,
      notes: typeof notes === 'string' && notes.trim() ? notes.trim() : undefined,
      createdAt: now,
      updatedAt: now,
    };

    db.zones.unshift(zone);
    saveDatabase(db);
    broadcastRealtime('zones_updated', { zoneId: zone.id });
    res.status(201).json({ zone });
  });

  app.patch('/api/admin/zones/:id', requireAuth(['super_admin']), (req, res) => {
    const zone = db.zones.find((z) => z.id === req.params.id);
    if (!zone) {
      res.status(404).json({ error: 'المنطقة غير موجودة.' });
      return;
    }
    const {
      name,
      city,
      centerLat,
      centerLng,
      radiusKm,
      pricingMode,
      fixedFeeIqd,
      baseFeeIqd,
      perKmFeeIqd,
      isCovered,
      isActive,
      notes,
    } = req.body as Partial<DeliveryZone>;

    if (typeof name === 'string' && name.trim().length >= 2) {
      zone.name = name.trim();
      for (const r of db.routeRates) {
        if (r.fromZoneId === zone.id) r.fromZoneName = zone.name;
        if (r.toZoneId === zone.id) r.toZoneName = zone.name;
      }
    }
    if (typeof city === 'string' && city.trim().length >= 2) zone.city = city.trim();
    if (typeof centerLat === 'number' && Number.isFinite(centerLat)) zone.centerLat = centerLat;
    if (typeof centerLng === 'number' && Number.isFinite(centerLng)) zone.centerLng = centerLng;
    if (typeof radiusKm === 'number' && Number.isFinite(radiusKm) && radiusKm > 0) {
      zone.radiusKm = Math.min(200, Math.max(0.5, Math.round(radiusKm * 10) / 10));
    }
    if (pricingMode === 'fixed' || pricingMode === 'distance') zone.pricingMode = pricingMode;
    if (typeof fixedFeeIqd === 'number' && Number.isFinite(fixedFeeIqd) && fixedFeeIqd >= 0) {
      zone.fixedFeeIqd = Math.round(fixedFeeIqd);
    }
    if (typeof baseFeeIqd === 'number' && Number.isFinite(baseFeeIqd) && baseFeeIqd >= 0) {
      zone.baseFeeIqd = Math.round(baseFeeIqd);
    }
    if (typeof perKmFeeIqd === 'number' && Number.isFinite(perKmFeeIqd) && perKmFeeIqd >= 0) {
      zone.perKmFeeIqd = Math.round(perKmFeeIqd);
    }
    if (typeof isCovered === 'boolean') zone.isCovered = isCovered;
    if (typeof isActive === 'boolean') zone.isActive = isActive;
    if (typeof notes === 'string') zone.notes = notes.trim() || undefined;

    zone.updatedAt = new Date().toISOString();
    saveDatabase(db);
    broadcastRealtime('zones_updated', { zoneId: zone.id });
    res.json({ zone });
  });

  app.delete('/api/admin/zones/:id', requireAuth(['super_admin']), (req, res) => {
    const idx = db.zones.findIndex((z) => z.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'المنطقة غير موجودة.' });
      return;
    }
    const [removed] = db.zones.splice(idx, 1);
    db.routeRates = db.routeRates.filter(
      (r) => r.fromZoneId !== removed.id && r.toZoneId !== removed.id
    );
    saveDatabase(db);
    broadcastRealtime('zones_updated', { zoneId: removed.id });
    res.json({ ok: true });
  });

  // Inter-Zone Route Rates Matrix CRUD (Super Admin Only)
  app.get('/api/admin/routes', requireAuth(['super_admin']), (_req, res) => {
    res.json({ routeRates: db.routeRates });
  });

  app.post('/api/admin/routes', requireAuth(['super_admin']), (req, res) => {
    const { fromZoneId, toZoneId, feeIqd, bidirectional, isActive, notes } = req.body as Partial<ZoneRouteRate>;
    const fromZone = db.zones.find((z) => z.id === fromZoneId);
    const toZone = db.zones.find((z) => z.id === toZoneId);
    if (!fromZone || !toZone) {
      res.status(400).json({ error: 'يرجى اختيار منطقة الاستلام ومنطقة التسليم بشكل صحيح.' });
      return;
    }
    if (fromZone.id === toZone.id) {
      res.status(400).json({ error: 'للتوصيل داخل نفس المنطقة، عدّل أجرة المنطقة مباشرة.' });
      return;
    }
    const feeNum = Number(feeIqd);
    if (!Number.isFinite(feeNum) || feeNum < 0) {
      res.status(400).json({ error: 'يرجى إدخال أجرة صحيحة بالدينار العراقي.' });
      return;
    }

    const now = new Date().toISOString();
    const existing = db.routeRates.find(
      (r) =>
        (r.fromZoneId === fromZone.id && r.toZoneId === toZone.id) ||
        (r.bidirectional && r.fromZoneId === toZone.id && r.toZoneId === fromZone.id)
    );
    if (existing) {
      existing.fromZoneId = fromZone.id;
      existing.toZoneId = toZone.id;
      existing.fromZoneName = fromZone.name;
      existing.toZoneName = toZone.name;
      existing.feeIqd = Math.round(feeNum);
      existing.bidirectional = typeof bidirectional === 'boolean' ? bidirectional : existing.bidirectional;
      existing.isActive = typeof isActive === 'boolean' ? isActive : true;
      if (typeof notes === 'string') existing.notes = notes.trim() || undefined;
      existing.updatedAt = now;
      saveDatabase(db);
      broadcastRealtime('routes_updated', { routeId: existing.id });
      res.status(200).json({ route: existing });
      return;
    }

    const route: ZoneRouteRate = {
      id: `rt_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
      fromZoneId: fromZone.id,
      toZoneId: toZone.id,
      fromZoneName: fromZone.name,
      toZoneName: toZone.name,
      feeIqd: Math.round(feeNum),
      bidirectional: typeof bidirectional === 'boolean' ? bidirectional : true,
      isActive: typeof isActive === 'boolean' ? isActive : true,
      notes: typeof notes === 'string' && notes.trim() ? notes.trim() : undefined,
      createdAt: now,
      updatedAt: now,
    };
    db.routeRates.unshift(route);
    saveDatabase(db);
    broadcastRealtime('routes_updated', { routeId: route.id });
    res.status(201).json({ route });
  });

  app.patch('/api/admin/routes/:id', requireAuth(['super_admin']), (req, res) => {
    const route = db.routeRates.find((r) => r.id === req.params.id);
    if (!route) {
      res.status(404).json({ error: 'قاعدة المسار غير موجودة.' });
      return;
    }
    const { feeIqd, bidirectional, isActive, notes } = req.body as Partial<ZoneRouteRate>;
    if (typeof feeIqd === 'number' && Number.isFinite(feeIqd) && feeIqd >= 0) {
      route.feeIqd = Math.round(feeIqd);
    }
    if (typeof bidirectional === 'boolean') route.bidirectional = bidirectional;
    if (typeof isActive === 'boolean') route.isActive = isActive;
    if (typeof notes === 'string') route.notes = notes.trim() || undefined;
    route.updatedAt = new Date().toISOString();
    saveDatabase(db);
    broadcastRealtime('routes_updated', { routeId: route.id });
    res.json({ route });
  });

  app.delete('/api/admin/routes/:id', requireAuth(['super_admin']), (req, res) => {
    const idx = db.routeRates.findIndex((r) => r.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'قاعدة المسار غير موجودة.' });
      return;
    }
    const [removed] = db.routeRates.splice(idx, 1);
    saveDatabase(db);
    broadcastRealtime('routes_updated', { routeId: removed.id });
    res.json({ ok: true });
  });

  app.patch('/api/admin/users/:id/status', requireAuth(['super_admin']), (req, res) => {
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) {
      res.status(404).json({ error: 'المستخدم غير موجود.' });
      return;
    }
    if (user.role === 'super_admin') {
      res.status(400).json({ error: 'لا يمكن إيقاف حساب المدير العام الرئيسي.' });
      return;
    }
    const { status } = req.body as { status?: AccountStatus };
    if (status !== 'active' && status !== 'suspended') {
      res.status(400).json({ error: 'الحالة غير صالحة.' });
      return;
    }
    user.status = status;
    if (user.driverId) {
      const driver = db.drivers.find((d) => d.id === user.driverId);
      if (driver) {
        driver.status = status;
        driver.updatedAt = new Date().toISOString();
      }
    }
    saveDatabase(db);
    broadcastRealtime('user_updated', { userId: user.id });
    res.json({ user: sanitizeUser(user) });
  });

  app.patch('/api/admin/drivers/:id/status', requireAuth(['super_admin']), (req, res) => {
    const driver = db.drivers.find((d) => d.id === req.params.id);
    if (!driver) {
      res.status(404).json({ error: 'المندوب غير موجود.' });
      return;
    }
    const { status } = req.body as { status?: AccountStatus };
    if (status !== 'active' && status !== 'suspended') {
      res.status(400).json({ error: 'الحالة غير صالحة.' });
      return;
    }
    driver.status = status;
    driver.updatedAt = new Date().toISOString();
    const owner = db.users.find((u) => u.id === driver.ownerId);
    if (owner && owner.role !== 'super_admin') owner.status = status;
    saveDatabase(db);
    broadcastRealtime('driver_updated', { driverId: driver.id });
    res.json({ driver });
  });

  app.patch('/api/admin/orders/:id', requireAuth(['super_admin']), (req, res) => {
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'الطلب غير موجود.' });
      return;
    }
    const { status, driverId } = req.body as { status?: OrderStatus; driverId?: string };
    const prevStatus = order.status;
    if (driverId) {
      const driver = db.drivers.find((d) => d.id === driverId && d.status === 'active');
      if (!driver) {
        res.status(404).json({ error: 'المندوب غير موجود أو موقوف.' });
        return;
      }
      order.driverId = driver.id;
      order.driverName = driver.name;
      order.driverPhone = driver.phone;
      if (order.status === 'pending') {
        order.status = 'accepted';
      }
    }
    if (status) {
      order.status = status;
      if (status === 'delivered' && prevStatus !== 'delivered' && order.driverId) {
        const drv = db.drivers.find((d) => d.id === order.driverId);
        if (drv) {
          drv.completedCount += 1;
          drv.earningsIqd += order.driverNetIqd;
          drv.updatedAt = new Date().toISOString();
        }
      }
    }
    order.updatedAt = new Date().toISOString();
    saveDatabase(db);
    broadcastRealtime('order_updated', { orderId: order.id });
    res.json({ order });
  });

  // Dynamic Pricing Rules (100% under Manager control - no forced hardcoded bounds)
  app.put('/api/admin/pricing', requireAuth(['super_admin']), (req, res) => {
    const {
      baseFeeIqd,
      perKmFeeIqd,
      minFeeIqd,
      maxFeeIqd,
      interZoneFeeIqd,
      longDistanceThresholdKm,
      longDistancePerKmFeeIqd,
      platformCommissionPct,
      outsideZonesAllowed,
      outsideZoneSurchargeIqd,
      appName,
      supportPhone,
      maintenanceMode,
    } = req.body as Partial<PricingSettings>;

    const nextMin = Math.max(0, Math.min(500000, Number(minFeeIqd ?? db.settings.minFeeIqd)));
    const nextMax = Math.max(nextMin, Math.min(500000, Number(maxFeeIqd ?? db.settings.maxFeeIqd)));
    const nextBase = Math.max(0, Math.min(500000, Number(baseFeeIqd ?? db.settings.baseFeeIqd)));
    const nextPerKm = Math.max(0, Math.min(50000, Number(perKmFeeIqd ?? db.settings.perKmFeeIqd)));
    const nextInterZone = Math.max(0, Math.min(250000, Number(interZoneFeeIqd ?? db.settings.interZoneFeeIqd)));
    const nextLongThresh = Math.max(0, Math.min(200, Number(longDistanceThresholdKm ?? db.settings.longDistanceThresholdKm)));
    const nextLongPerKm = Math.max(0, Math.min(50000, Number(longDistancePerKmFeeIqd ?? db.settings.longDistancePerKmFeeIqd)));
    const nextComm = Math.max(0, Math.min(50, Number(platformCommissionPct ?? db.settings.platformCommissionPct)));
    const nextSurcharge = Math.max(
      0,
      Math.min(250000, Number(outsideZoneSurchargeIqd ?? db.settings.outsideZoneSurchargeIqd))
    );

    db.settings = {
      baseFeeIqd: Math.round(nextBase),
      perKmFeeIqd: Math.round(nextPerKm),
      minFeeIqd: Math.round(nextMin),
      maxFeeIqd: Math.round(nextMax),
      interZoneFeeIqd: Math.round(nextInterZone),
      longDistanceThresholdKm: Math.round(nextLongThresh * 10) / 10,
      longDistancePerKmFeeIqd: Math.round(nextLongPerKm),
      platformCommissionPct: Math.round(nextComm * 10) / 10,
      outsideZonesAllowed:
        typeof outsideZonesAllowed === 'boolean'
          ? outsideZonesAllowed
          : db.settings.outsideZonesAllowed,
      outsideZoneSurchargeIqd: Math.round(nextSurcharge),
      appName: typeof appName === 'string' && appName.trim() ? appName.trim() : db.settings.appName,
      supportPhone:
        typeof supportPhone === 'string' && supportPhone.trim()
          ? supportPhone.trim()
          : db.settings.supportPhone,
      maintenanceMode:
        typeof maintenanceMode === 'boolean' ? maintenanceMode : db.settings.maintenanceMode,
      updatedAt: new Date().toISOString(),
    };

    saveDatabase(db);
    broadcastRealtime('pricing_updated', { settings: db.settings });
    res.json({ settings: db.settings });
  });

  // Backups & Disaster Recovery (Super Admin Only)
  app.get('/api/admin/backups', requireAuth(['super_admin']), (_req, res) => {
    res.json({ backups: listDatabaseBackups() });
  });

  app.post('/api/admin/backups', requireAuth(['super_admin']), (_req, res) => {
    const info = createDatabaseBackup('manual_admin', db);
    res.status(201).json({ backup: info, backups: listDatabaseBackups() });
  });

  app.get('/api/admin/backups/:filename', requireAuth(['super_admin']), (req, res) => {
    const rawName = String(req.params.filename || '');
    const safeName = path.basename(rawName);
    if (!safeName.endsWith('.json') || safeName !== rawName) {
      res.status(400).json({ error: 'اسم ملف النسخة الاحتياطية غير صالح.' });
      return;
    }
    const filePath = path.join(BACKUPS_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'النسخة الاحتياطية غير موجودة.' });
      return;
    }
    res.download(filePath, safeName);
  });

  app.post('/api/admin/backups/restore', requireAuth(['super_admin']), (req, res) => {
    const { filename, snapshot } = req.body as {
      filename?: string;
      snapshot?: { database?: DatabaseSchema } | DatabaseSchema;
    };

    try {
      let targetDb: DatabaseSchema | undefined;
      if (filename) {
        const safeName = path.basename(filename);
        const filePath = path.join(BACKUPS_DIR, safeName);
        if (!fs.existsSync(filePath)) {
          res.status(404).json({ error: 'ملف النسخة الاحتياطية غير موجود.' });
          return;
        }
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
          database?: DatabaseSchema;
        };
        targetDb = parsed.database;
      } else if (snapshot) {
        targetDb =
          'database' in snapshot && snapshot.database
            ? snapshot.database
            : (snapshot as DatabaseSchema);
      }

      if (
        !targetDb ||
        !Array.isArray(targetDb.users) ||
        !Array.isArray(targetDb.orders) ||
        !targetDb.settings
      ) {
        res.status(400).json({ error: 'بنية ملف النسخة الاحتياطية غير صالحة.' });
        return;
      }

      createDatabaseBackup('pre_restore', db);
      ensureDatabaseMigrations(targetDb);
      db = targetDb;
      saveDatabase(db);
      broadcastRealtime('database_restored', { ts: Date.now() });
      res.json({ ok: true, backups: listDatabaseBackups() });
    } catch {
      res.status(400).json({ error: 'تعذر استعادة النسخة الاحتياطية.' });
    }
  });

  // Direct APK & Project Backup Downloads
  const DOWNLOADS_DIR = path.resolve(process.cwd(), 'downloads');
  const DOWNLOAD_ALIASES: Record<string, string> = {
    'waselha-customer.apk': 'WASELHA CUSTOMER.apk',
    'waselha customer.apk': 'WASELHA CUSTOMER.apk',
    'waselha_customer.apk': 'WASELHA CUSTOMER.apk',
    'waselha-driver.apk': 'WASELHA DRIVER.apk',
    'waselha driver.apk': 'WASELHA DRIVER.apk',
    'waselha_driver.apk': 'WASELHA DRIVER.apk',
    'waselha-manager.apk': 'WASELHA MANAGER.apk',
    'waselha manager.apk': 'WASELHA MANAGER.apk',
    'waselha_manager.apk': 'WASELHA MANAGER.apk',
    'waselha-project-backup.zip': 'waselha-project-backup.tar.gz',
    'waselha-project-backup.tar.gz': 'waselha-project-backup.tar.gz',
  };
  app.get('/downloads', (_req, res) => {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    const files = fs
      .readdirSync(DOWNLOADS_DIR)
      .filter((name) => {
        const full = path.join(DOWNLOADS_DIR, name);
        return fs.existsSync(full) && fs.statSync(full).isFile();
      })
      .map((name) => ({
        name,
        url: `/downloads/${encodeURIComponent(name)}`,
        sizeBytes: fs.statSync(path.join(DOWNLOADS_DIR, name)).size,
      }));
    res.json({ ok: true, files });
  });
  app.get('/downloads/:filename', (req, res) => {
    let rawName = String(req.params.filename || '');
    try {
      rawName = decodeURIComponent(rawName);
    } catch {
      // Keep raw string if malformed URI sequence
    }
    const normalized = rawName.replace(/\+/g, ' ').trim();
    const safeBase = path.basename(normalized);
    const resolvedName = DOWNLOAD_ALIASES[safeBase.toLowerCase()] || safeBase;
    const filePath = path.join(DOWNLOADS_DIR, resolvedName);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.status(404).json({ error: 'الملف المطلوب غير موجود.' });
      return;
    }
    if (resolvedName.toLowerCase().endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    } else if (resolvedName.toLowerCase().endsWith('.tar.gz')) {
      res.setHeader('Content-Type', 'application/gzip');
    }
    res.download(filePath, resolvedName);
  });

  // Ensure unmatched /api/* endpoints always return JSON 404 instead of SPA HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'مسار API المطلوب غير موجود.' });
  });

  // Frontend Serving
  if (attachFrontend) {
    const isProductionRuntime =
      process.env.NODE_ENV === 'production' ||
      Boolean(
        process.env.RAILWAY_ENVIRONMENT ||
          process.env.RAILWAY_PROJECT_ID ||
          process.env.RAILWAY_STATIC_URL ||
          process.env.RENDER
      );
    if (!isProductionRuntime) {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true, hmr: false, ws: false },
        appType: 'spa',
      });

      app.get('/@vite/client', async (_req, res, next) => {
        try {
          const result = await vite.transformRequest('/@vite/client');
          if (!result) {
            next();
            return;
          }
          const safeCode = result.code
            .replace(
              'let wsTransport = createWebSocketModuleRunnerTransport({',
              'let wsTransport = true ? { async connect() {}, async disconnect() {}, send() {} } : createWebSocketModuleRunnerTransport({'
            )
            .replace(
              'else throw new SendBeforeConnectError("send was called before connect");',
              'else return;'
            );
          res.status(200).set({ 'Content-Type': 'application/javascript; charset=utf-8' }).end(safeCode);
        } catch (err) {
          next(err);
        }
      });

      app.get(['/customer', '/customer/*', '/driver', '/driver/*', '/manager', '/manager/*'], async (req, res, next) => {
        try {
          const indexPath = path.resolve(process.cwd(), 'index.html');
          let html = fs.readFileSync(indexPath, 'utf8');
          html = await vite.transformIndexHtml(req.originalUrl, html);
          html = patchHtmlForAppRoute(html, req.path);
          res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
        } catch (err) {
          next(err);
        }
      });

      app.use(vite.middlewares);
    } else {
      const appTargets: Array<{ prefix: string; dir: string }> = [
        { prefix: '/customer', dir: path.resolve(process.cwd(), 'dist-customer') },
        { prefix: '/driver', dir: path.resolve(process.cwd(), 'dist-driver') },
        { prefix: '/manager', dir: path.resolve(process.cwd(), 'dist-manager') },
      ];
      for (const target of appTargets) {
        if (!fs.existsSync(path.join(target.dir, 'index.html'))) continue;
        app.use(target.prefix, express.static(target.dir));
        app.get([target.prefix, `${target.prefix}/*`], (req, res) => {
          if (path.extname(req.path)) {
            res.status(404).json({ error: 'الملف المطلوب غير موجود.' });
            return;
          }
          const indexFile = path.join(target.dir, 'index.html');
          const rawHtml = fs.readFileSync(indexFile, 'utf8');
          res.status(200).set({ 'Content-Type': 'text/html' }).send(patchHtmlForAppRoute(rawHtml, req.path));
        });
      }

      const distPath = path.resolve(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        if (req.path.startsWith('/api/') || req.path.startsWith('/assets/') || path.extname(req.path)) {
          res.status(404).json({ error: 'الملف المطلوب غير موجود.' });
          return;
        }
        const indexFile = path.join(distPath, 'index.html');
        const rawHtml = fs.readFileSync(indexFile, 'utf8');
        res.status(200).set({ 'Content-Type': 'text/html' }).send(patchHtmlForAppRoute(rawHtml, req.path));
      });
    }
  }

  return app;
}

async function startServer() {
  const app = await createApp({ attachFrontend: true });
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`WASELHA courier server listening on http://0.0.0.0:${PORT}`);
  });
}

if (!IS_VERCEL) {
  startServer().catch((err) => {
    console.error('Failed to start WASELHA server:', err);
    process.exit(1);
  });
}
