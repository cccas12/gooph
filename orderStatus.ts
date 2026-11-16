import type { OrderStatus, SenderType, VehicleType } from '../types';

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; colorClass: string; stepIndex: number }
> = {
  pending: {
    label: 'بانتظار قبول مندوب',
    colorClass: 'text-amber-700 bg-amber-50 border-amber-200',
    stepIndex: 0,
  },
  accepted: {
    label: 'تم قبول الطلب — المندوب متجه للاستلام',
    colorClass: 'text-sky-700 bg-sky-50 border-sky-200',
    stepIndex: 1,
  },
  picked_up: {
    label: 'تم استلام الغرض',
    colorClass: 'text-indigo-700 bg-indigo-50 border-indigo-200',
    stepIndex: 2,
  },
  on_the_way: {
    label: 'في الطريق إلى المستلم',
    colorClass: 'text-cyan-800 bg-cyan-50 border-cyan-300',
    stepIndex: 3,
  },
  delivered: {
    label: 'تم التسليم بنجاح',
    colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    stepIndex: 4,
  },
  cancelled: {
    label: 'ملغى',
    colorClass: 'text-rose-700 bg-rose-50 border-rose-200',
    stepIndex: -1,
  },
};

export const SENDER_TYPE_LABELS: Record<SenderType, string> = {
  individual: 'طلب شخصي',
  shop: 'محل / مطعم / متجر',
};

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  motorcycle: 'دراجة نارية',
  car: 'سيارة',
  bicycle: 'دراجة هوائية',
};
