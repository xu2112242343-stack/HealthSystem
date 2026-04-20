import type { SVGProps } from 'react';

/**
 * 肝脏简笔图：左大叶、右小叶、顶弧连贯；中间镰状分隔线。
 * 线稿无填充，与 lucide（24×24、stroke 2、圆角端点）一致。
 */
export function LiverIcon({ className, strokeWidth = 2, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M4.5 16.5C3.5 13 3.5 9 5.5 6.5C7.5 4 11 4 14.5 5.5C18 7 20.5 10 20.5 12.5C20.5 15 18 18 14.5 18.5C11 19 7 18 5.5 17.5C4.5 17 4.5 16.5 4.5 16.5Z" />
      <path d="M11.5 5.5Q11 12 11.3 17.5" />
    </svg>
  );
}
