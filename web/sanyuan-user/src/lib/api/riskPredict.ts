import { postJson } from '@/lib/api';

export type RiskPredictDisease = {
  id: 'liver' | 'diabetes' | 'stroke';
  shortName: string;
  fullName: string;
  probability: number;
  score: number;
  risk: 'low' | 'medium' | 'high';
  riskLabel: string;
  /** 与响应体顶层 ``source`` 中对应 id 字段一致，如脑卒中：heuristic / multimodal_img 等 */
  sourceTag?: string;
  topFactors: {
    name: string;
    value: number;
    current?: string;
    reference?: string;
    /** 后端可选：问卷 | 检验 | 影像 */
    modality?: string;
  }[];
};

export type StrokeImageStatus = {
  pathPresent: boolean;
  fileReadable: boolean;
  hint: string;
};

export type PropagationEdgeDetail = {
  impact: number;
  association: number;
  causal: number;
  associationScore: number;
  causalScore: number;
  diagnosis: { code: string; label: string };
  decomposition?: {
    pairGeo?: number;
    direct?: number;
    indirect?: number;
    confounding?: number;
    confoundCosine?: number;
    mechanismCosine?: number;
  };
};

export type RiskPredictResponse = {
  /** 三病传播分项分值（%），顺序为：[糖尿病→脂肪肝, 脂肪肝→脑卒中, 糖尿病→脑卒中] */
  propagationScores: readonly [number, number, number];
  /** 逐边关联/因果双层解释，键为 diabetes-liver | liver-stroke | diabetes-stroke */
  propagationDetail?: Partial<
    Record<'diabetes-liver' | 'liver-stroke' | 'diabetes-stroke', PropagationEdgeDetail>
  >;
  compositeIndex: number;
  diseases: RiskPredictDisease[];
  source: Record<string, string>;
  /** 脑卒中影像是否进入 predict：pathPresent/fileReadable 与排查说明 */
  strokeImageStatus?: StrokeImageStatus;
};

/**
 * 单用户三病评估：与 FastAPI POST /api/risk/predict 对齐。
 * Body 可传问卷字段局部覆盖；省略时用服务端默认画像。
 */
export async function fetchRiskPredict(body?: Record<string, unknown>): Promise<RiskPredictResponse> {
  return postJson<RiskPredictResponse, Record<string, unknown> | undefined>(
    '/api/risk/predict',
    body ?? {},
  );
}
