/** 肝病–糖尿病–脑卒中 多模态协同：抽象配图（SVG，无外链资源） */
export function HeroIllustration({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 520 300"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="sjy-line" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#5eead4" stopOpacity="0.15" />
          <stop offset="50%" stopColor="#a5f3fc" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="sjy-node-a" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fb923c" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="sjy-node-b" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id="sjy-node-c" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.45" />
        </linearGradient>
        <filter id="sjy-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 网格 */}
      <path
        d="M40 220h440M40 240h440M40 260h440M80 180v100M160 180v100M240 180v100M320 180v100M400 180v100"
        stroke="white"
        strokeOpacity="0.06"
        strokeWidth="1"
      />

      {/* 多模态波形 */}
      <path
        d="M32 168c28-18 52-52 78-48 34 6 38 62 72 58 30-4 34-48 64-52 22-3 42 28 64 26 18-2 30-22 48-24 26-4 50 36 78 28"
        stroke="url(#sjy-line)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#sjy-glow)"
      />
      <path
        d="M32 188c24 8 48-36 76-30 32 8 36 58 70 52 28-4 40-42 68-46 24-3 46 34 72 30 20-2 36-18 54-20"
        stroke="white"
        strokeOpacity="0.18"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* 联线：三病协同 */}
      <path
        d="M148 118c42 22 88 22 130 0M178 152c22 38 78 38 100 0M148 118c-8 38 18 78 58 88M278 118c8 38-18 78-58 88"
        stroke="white"
        strokeOpacity="0.12"
        strokeWidth="1.25"
      />

      {/* 中心：融合 / 预测 */}
      <circle cx="260" cy="128" r="36" fill="white" fillOpacity="0.08" stroke="white" strokeOpacity="0.22" />
      <circle cx="260" cy="128" r="22" fill="white" fillOpacity="0.12" />
      <path
        d="M248 128c8-10 18-14 28-10 10 4 16 14 14 24-2 12-12 20-24 20-14 0-24-12-22-26"
        stroke="#99f6e4"
        strokeWidth="2"
        strokeLinecap="round"
        strokeOpacity="0.85"
      />

      {/* 肝病（代谢） */}
      <g transform="translate(118 72)">
        <ellipse cx="32" cy="40" rx="28" ry="34" fill="url(#sjy-node-a)" fillOpacity="0.35" />
        <path
          d="M18 28c10-8 24-8 34 2 8 10 8 26-2 36-10 10-26 10-36 0"
          stroke="url(#sjy-node-a)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="32" cy="38" r="5" fill="white" fillOpacity="0.35" />
      </g>

      {/* 血糖 / 代谢节律 */}
      <g transform="translate(228 52)">
        <rect x="8" y="8" width="56" height="56" rx="14" fill="url(#sjy-node-b)" fillOpacity="0.28" />
        <path
          d="M22 48c6-14 18-22 30-18 10 4 14 16 8 26"
          stroke="#ecfeff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeOpacity="0.9"
        />
        <circle cx="36" cy="26" r="4" fill="white" fillOpacity="0.5" />
      </g>

      {/* 脑卒中 / 神经 */}
      <g transform="translate(352 68)">
        <path
          d="M8 36c6-18 22-28 40-26 18 2 32 16 34 34 2 20-10 38-28 44-6 2-12 2-18 0"
          fill="url(#sjy-node-c)"
          fillOpacity="0.32"
        />
        <path
          d="M16 32c10-12 26-16 40-10M24 52c8 10 22 12 34 6"
          stroke="#e0e7ff"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeOpacity="0.75"
        />
      </g>

      {/* 图例 */}
      <g fontSize="11" fill="white" fillOpacity="0.55" fontFamily="system-ui, sans-serif">
        <circle cx="56" cy="278" r="4" fill="#fb923c" fillOpacity="0.85" />
        <text x="66" y="281.5">
          肝病风险
        </text>
        <circle cx="188" cy="278" r="4" fill="#22d3ee" fillOpacity="0.9" />
        <text x="198" y="281.5">
          糖尿病风险
        </text>
        <circle cx="332" cy="278" r="4" fill="#a78bfa" fillOpacity="0.9" />
        <text x="342" y="281.5">
          脑卒中风险
        </text>
      </g>
    </svg>
  )
}
