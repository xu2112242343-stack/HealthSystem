import React, { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';

import type { HealthGuideArticle, HealthGuideImage } from '@/lib/api/healthGuides';

type HealthGuideArticlePageProps = {
  article: HealthGuideArticle;
  onBack: () => void;
};

/** 正文里嵌入的图片占位，如 <118_1.png> */
const CONTENT_IMAGE_PLACEHOLDER_RE = /<([^>\s]+\.(?:png|jpg|jpeg|gif|webp))>/gi;

type BodySegment =
  | { kind: 'text'; text: string }
  | { kind: 'img'; img: HealthGuideImage };

function keyifyFilename(s: string): string {
  return s.trim().toLowerCase().replace(/^.*[/\\]/, '');
}

function resolveImageByFilename(
  filename: string,
  lowerMap: Map<string, HealthGuideImage>,
  images: HealthGuideImage[],
): HealthGuideImage | undefined {
  const key = filename.trim().toLowerCase();
  const direct = lowerMap.get(key);
  if (direct) return direct;
  return images.find(
    (i) =>
      keyifyFilename(i.filename) === key ||
      i.filename.toLowerCase().endsWith(key) ||
      key.endsWith(i.filename.toLowerCase()),
  );
}

/** 将一段纯文本拆成段落：优先空行/换行；否则按中文句末标点切分 */
function textToParagraphs(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').trim();
  if (!raw) return [];

  if (/\n/.test(raw)) {
    const blocks = raw.split(/\n\s*\n+/);
    const out: string[] = [];
    for (const block of blocks) {
      const lines = block
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      if (lines.length) out.push(...lines);
    }
    return out.length ? out : [raw];
  }

  const bySentence = raw
    .split(/(?<=[。！？；])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (bySentence.length >= 2) return bySentence;
  return [raw];
}

function parseArticleBody(content: string, images: HealthGuideImage[]): {
  segments: BodySegment[];
  trailingImages: HealthGuideImage[];
} {
  const sorted = images.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const lowerMap = new Map(sorted.map((i) => [keyifyFilename(i.filename), i]));
  const usedIds = new Set<number>();
  const segments: BodySegment[] = [];

  let last = 0;
  const re = new RegExp(CONTENT_IMAGE_PLACEHOLDER_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      segments.push({ kind: 'text', text: content.slice(last, m.index) });
    }
    const fname = m[1];
    const img = resolveImageByFilename(fname, lowerMap, sorted);
    if (img) {
      usedIds.add(img.id);
      segments.push({ kind: 'img', img });
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    segments.push({ kind: 'text', text: content.slice(last) });
  }

  const trailingImages = sorted.filter((i) => !usedIds.has(i.id));
  return { segments, trailingImages };
}

function ArticleBodyFlow({ article }: { article: HealthGuideArticle }) {
  const { segments, trailingImages } = useMemo(
    () => parseArticleBody(article.content || '', article.images || []),
    [article.content, article.images],
  );

  const hasAny =
    segments.some((s) => s.kind === 'img') ||
    segments.some((s) => s.kind === 'text' && textToParagraphs(s.text).length > 0) ||
    trailingImages.length > 0;

  if (!hasAny) return <p className="text-gray-500">暂无正文内容</p>;

  return (
    <div className="space-y-6">
      {segments.map((seg, i) => {
        if (seg.kind === 'img') {
          return (
            <figure key={`inline-${seg.img.id}-${i}`} className="overflow-hidden rounded-xl border border-gray-100 bg-gray-50">
              <img
                src={seg.img.imageUrl}
                alt={seg.img.desc || article.title}
                className="max-h-[min(360px,50vh)] w-full object-contain"
                loading="lazy"
              />
              {seg.img.desc ? (
                <figcaption className="px-3 py-2 text-center text-xs text-gray-500">{seg.img.desc}</figcaption>
              ) : null}
            </figure>
          );
        }
        const paras = textToParagraphs(seg.text);
        if (!paras.length) return null;
        return (
          <div key={`text-${i}`} className="space-y-3">
            {paras.map((p, j) => (
              <p key={j} className="text-justify text-[15px] leading-7 text-gray-800">
                {p}
              </p>
            ))}
          </div>
        );
      })}

      {trailingImages.length > 0 ? (
        <div className="space-y-4 border-t border-gray-100 pt-6">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">其余配图</h4>
          {trailingImages.map((img) => (
            <figure key={`trail-${img.id}`} className="overflow-hidden rounded-xl border border-gray-100 bg-gray-50">
              <img
                src={img.imageUrl}
                alt={img.desc || article.title}
                className="max-h-[min(360px,50vh)] w-full object-contain"
                loading="lazy"
              />
              {img.desc ? (
                <figcaption className="px-3 py-2 text-center text-xs text-gray-500">{img.desc}</figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function HealthGuideArticlePage({ article, onBack }: HealthGuideArticlePageProps) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 pb-4 pt-5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </button>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              {article.type}
            </span>
            {article.riskLevel.map((rl) => (
              <span key={`page-${article.id}-rl-${rl}`} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {rl}
              </span>
            ))}
          </div>

          <h2 className="mt-3 text-xl font-bold leading-snug text-gray-900">{article.title}</h2>
          {article.summary ? <p className="mt-2 text-sm leading-relaxed text-gray-600">{article.summary}</p> : null}
        </div>
      </div>

      <div className="px-6 py-6">
        <div className="text-sm text-gray-800">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">正文</h3>
          <div className="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-4 sm:px-5 sm:py-5">
            <ArticleBodyFlow article={article} />
          </div>
        </div>

        {article.tags.length > 0 ? (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-gray-100 pt-5">
            {article.tags.map((tag) => (
              <span key={`page-${article.id}-tag-${tag}`} className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs text-teal-800">
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {article.source ? <p className="mt-4 text-xs text-gray-400">来源：{article.source}</p> : null}
      </div>
    </section>
  );
}

