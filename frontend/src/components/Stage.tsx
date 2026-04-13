interface StageProps {
  label: string;
  stageNum: number;
  isActive: boolean;
  isComplete: boolean;
  isFirst: boolean;
  isLast: boolean;
}

export function Stage({
  label,
  stageNum,
  isActive,
  isComplete,
  isFirst,
  isLast,
}: StageProps) {
  const baseClasses =
    "flex-1 flex items-center justify-center relative z-[1] transition-all duration-400";

  const stateClasses = isActive
    ? "bg-dominos-red scale-x-[1.05] scale-y-[1.15] z-[3] shadow-[4px_4px_10px_4px_rgba(0,0,0,0.4)]"
    : isComplete
      ? "bg-dominos-red"
      : "bg-dominos-light-blue";

  const roundedClasses = isFirst
    ? "rounded-l-[30px]"
    : isLast
      ? "rounded-r-[30px]"
      : "";

  return (
    <div
      data-stage={stageNum}
      className={`${baseClasses} ${stateClasses} ${roundedClasses} segment-divider ${isActive && !isFirst ? "segment-active-left" : ""}`}
    >
      <span className="text-white text-[0.85rem] font-extrabold uppercase tracking-[0.5px] relative z-[2] max-[480px]:text-[0.55rem] max-[480px]:tracking-normal">
        {label}
      </span>
    </div>
  );
}
