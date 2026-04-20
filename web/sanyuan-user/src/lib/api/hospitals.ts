import { getJson } from '@/lib/api';

export type InterventionHospital = {
  id: number;
  name: string;
  department: string;
  address: string;
  phone: string;
  rating: number;
  specialties: string[];
  experts: number;
  latitude: number;
  longitude: number;
};

/** 登录用户可拉取的示范医院列表（含经纬度，用于距离排序） */
export async function fetchInterventionHospitals(): Promise<InterventionHospital[]> {
  return getJson<InterventionHospital[]>('/api/user/intervention/hospitals');
}
