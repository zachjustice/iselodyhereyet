import { STAGE_LABELS } from "../types";

interface NewsTickerProps {
  stage: number;
  updatedAt: number;
}

function formatTickerTime(epoch: number): string {
  return new Date(epoch).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function NewsTicker({ stage, updatedAt }: NewsTickerProps) {
  if (!updatedAt) return null;

  const time = formatTickerTime(updatedAt);
  const label = STAGE_LABELS[stage] ?? "";
  const msg =
    stage === 5
      ? `\u00A0\u00A0\uD83D\uDC76\u00A0\u00A0She's here! Born at ${time}\u00A0\u00A0`
      : `\u00A0\u00A0\uD83D\uDC76\u00A0\u00A0Latest official update: ${label} as of ${time}\u00A0\u00A0`;

  // Repeat the message enough times for seamless scroll
  const repetitions = 10;
  const spans = Array.from({ length: repetitions }, (_, i) => (
    <span key={i} className="text-dominos-blue text-sm font-semibold">
      {msg}
    </span>
  ));

  return (
    <div className="bg-white border-y-2 border-dominos-red overflow-hidden whitespace-nowrap h-9 leading-9">
      <div className="inline-flex animate-ticker-scroll">{spans}</div>
    </div>
  );
}
