interface FunFactsProps {
  currentFact: string;
  progress: number;
}

const R = 10;
const C = 2 * Math.PI * R;

export function FunFacts({ currentFact, progress }: FunFactsProps) {
  if (!currentFact) return null;

  return (
    <div className="max-w-[700px] mx-auto mt-5 py-5 px-6 bg-white border border-gray-300 rounded-xl relative max-[480px]:mx-3">
      <div className="font-bold text-dominos-blue text-base mb-2.5">
        Dr Katie says:
      </div>
      <svg
        className="absolute top-4 right-4 w-6 h-6"
        viewBox="0 0 24 24"
      >
        <circle
          cx="12"
          cy="12"
          r={R}
          fill="none"
          stroke="#ccc"
          strokeWidth="2.5"
          strokeDasharray={C}
          strokeDashoffset={C * progress}
          className="origin-center -rotate-90"
        />
      </svg>
      <div className="text-gray-700 text-[0.95rem] leading-relaxed transition-opacity duration-300">
        {currentFact}
      </div>
    </div>
  );
}
