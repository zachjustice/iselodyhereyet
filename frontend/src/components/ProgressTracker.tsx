import { Stage } from "./Stage";
import { STAGE_LABELS, STAGE_COUNT } from "../types";

interface ProgressTrackerProps {
  stage: number;
  updatedAt: number;
  message: string;
}

function formatTimestamp(epoch: number): string {
  const d = new Date(epoch);
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(d);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${get("weekday")} ${get("month")} ${get("day")} ${get("hour")}:${get("minute")} ${get("dayPeriod")} ${get("timeZoneName")}`;
}

export function ProgressTracker({
  stage,
  updatedAt,
  message,
}: ProgressTrackerProps) {
  const subtitle =
    stage === 5
      ? (() => {
          const d = new Date(updatedAt);
          const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
          const month = d.toLocaleDateString("en-US", { month: "long" });
          const day = d.getDate();
          const year = d.getFullYear();
          return `Elody Ann Justice was born on <strong>${weekday}, ${month} ${day}, ${year}</strong>`;
        })()
      : `Estimated delivery <strong>April 12th - April 14th</strong>`;

  return (
    <>
      <div className="max-w-[700px] mx-auto mt-7.5 px-6 text-center max-[480px]:mt-5 max-[480px]:mx-2 max-[480px]:px-3">
        <h2 className="text-dominos-blue text-3xl font-black uppercase tracking-wide mb-1 max-[480px]:text-2xl">
          Elody's Tracker
        </h2>
        <div
          className="text-dominos-blue text-base mb-5 max-[480px]:text-sm"
          dangerouslySetInnerHTML={{ __html: subtitle }}
        />
        <div className="flex rounded-[30px] h-[55px] bg-dominos-light-blue max-[480px]:h-[45px]">
          {Array.from({ length: STAGE_COUNT }, (_, i) => {
            const stageNum = i + 1;
            return (
              <Stage
                key={stageNum}
                label={STAGE_LABELS[stageNum]}
                stageNum={stageNum}
                isActive={stageNum === stage}
                isComplete={stageNum < stage}
                isFirst={stageNum === 1}
                isLast={stageNum === STAGE_COUNT}
              />
            );
          })}
        </div>
        {message && (
          <div className="text-dominos-blue text-[0.95rem] font-semibold mt-4">
            {message}
          </div>
        )}
      </div>
      {updatedAt > 0 && (
        <div className="text-center py-2 px-5 text-gray-400 text-xs max-w-[700px] mx-auto">
          Last Updated: {formatTimestamp(updatedAt)}
        </div>
      )}
    </>
  );
}
