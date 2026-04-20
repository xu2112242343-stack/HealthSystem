import { getApiBaseUrl, getJson } from '@/lib/api';

export type HealthGuideImage = {
  id: number;
  filename: string;
  mimeType: string;
  desc?: string | null;
  sortOrder: number;
  imageUrl: string;
};

export type HealthGuideArticle = {
  id: number;
  title: string;
  summary: string;
  content: string;
  disease: string[];
  type: string;
  tags: string[];
  riskLevel: string[];
  source?: string | null;
  images: HealthGuideImage[];
};

function withImageBase(rows: HealthGuideArticle[]): HealthGuideArticle[] {
  const base = getApiBaseUrl();
  return rows.map((r) => ({
    ...r,
    images: (r.images || []).map((img) => ({
      ...img,
      imageUrl:
        img.imageUrl.startsWith('http://') || img.imageUrl.startsWith('https://')
          ? img.imageUrl
          : `${base}${img.imageUrl}`,
    })),
  }));
}

/** 全量列表（管理/调试或自选筛选可用原接口）。 */
export async function fetchHealthGuides(): Promise<HealthGuideArticle[]> {
  const rows = await getJson<HealthGuideArticle[]>('/api/user/intervention/guides');
  return withImageBase(rows);
}

/** 按三病分层规则推荐：全低则认知+饮食/运动全文；有中/高则病种+文章风险标签匹配。 */
export async function fetchHealthGuidesRecommended(): Promise<HealthGuideArticle[]> {
  const rows = await getJson<HealthGuideArticle[]>('/api/user/intervention/guides/recommended');
  return withImageBase(rows);
}

