import React, { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';

import type { HealthGuideArticle, HealthGuideImage } from '@/lib/api/healthGuides';

type HealthGuideArticleModalProps = {
  article: HealthGuideArticle | null;
  onClose: () => void;
};

/** 正文里嵌入的图片占位，如 <118_1.png> */
const CONTENT_IMAGE_PLACEHOLDER_RE = /<([^>\s]+\.(?:png|jpg|jpeg|gif|webp))>/gi;

type BodySegment =
  | { kind: 'text'; text: string }
  | { kind: 'img'; img: HealthGuideImage };

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
      Keyify(i.filename) === key ||
      i.filename.toLowerCase().endsWith(key) ||
      key.endsWith(i.filename.toLowerCase()),
  );
}

function Keyify(s: string): string {
  return s.trim().toLowerCase().replace(/^.*[/\\]/, '');
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

  const bySentence = raw.split(/(?<=[。！？；])\s*/).map((s) => s.trim()).filter(Boolean);
  if (bySentence.length >= 2) return bySentence;
  return [raw];
}

function parseArticleBody(content: string, images: HealthGuideImage[]): {
  segments: BodySegment[];
  trailingImages: HealthGuideImage[];
} {
  const sorted = images
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const lowerMap = new Map(sorted.map((i) => [Keyify(i.filename), i]));
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

function ArticleBodyFlow({
  article,
}: {
  article: HealthGuideArticle;
}) {
  const { segments, trailingImages } = useMemo(
    () => parseArticleBody(article.content || '', article.images || []),
    [article.content, article.images],
  );

  const hasAny =
    segments.some((s) => s.kind === 'img') ||
    segments.some((s) => s.kind === 'text' && textToParagraphs(s.text).length > 0) ||
    trailingImages.length > 0;

  if (!hasAny) {
    return <p className="text-gray-500">暂无正文内容</p>;
  }

  return (
    <div className="space-y-6">
      {segments.map((seg, i) => {
        if (seg.kind === 'img') {
          return (
            <figure
              key={`inline-${seg.img.id}-${i}`}
              className="overflow-hidden rounded-xl border border-gray-100 bg-gray-50"
            >
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
              <p key={j} className="text-justify text-base leading-7 text-gray-800">
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

export function HealthGuideArticleModal({ article, onClose }: HealthGuideArticleModalProps) {
  useEffect(() => {
    if (!article) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [article, onClose]);

  useEffect(() => {
    if (!article) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [article]);

  if (!article) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="health-guide-modal-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative shrink-0 border-b border-gray-100 px-6 pb-4 pt-6 pr-14">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              {article.type}
            </span>
            {article.riskLevel.map((rl) => (
              <span
                key={`modal-${article.id}-rl-${rl}`}
                className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
              >
                {rl}
              </span>
            ))}
          </div>
          <h2 id="health-guide-modal-title" className="mt-3 text-xl font-bold leading-snug text-gray-900">
            {article.title}
          </h2>
          {article.summary ? (
            <p className="mt-2 text-sm leading-relaxed text-gray-600">{article.summary}</p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="text-sm text-gray-800">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">正文</h3>
            <div className="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-4 sm:px-5 sm:py-5">
              <ArticleBodyFlow article={article} />
            </div>
          </div>

          {article.tags.length > 0 ? (
            <div className="mt-6 flex flex-wrap gap-2 border-t border-gray-100 pt-5">
              {article.tags.map((tag) => (
                <span
                  key={`modal-${article.id}-tag-${tag}`}
                  className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs text-teal-800"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          {article.source ? (
            <p className="mt-4 text-xs text-gray-400">来源：{article.source}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
