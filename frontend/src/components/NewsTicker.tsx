import { useRef, useEffect, useCallback, useState } from "react";
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
  const tickerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [copies, setCopies] = useState(10);
  const [scrollStyle, setScrollStyle] = useState<React.CSSProperties>({});

  const msg =
    !updatedAt ? "" :
    stage === 5
      ? `\u00A0\u00A0\uD83D\uDC76\u00A0\u00A0She's here! Born at ${formatTickerTime(updatedAt)}\u00A0\u00A0`
      : `\u00A0\u00A0\uD83D\uDC76\u00A0\u00A0Latest official update: ${STAGE_LABELS[stage] ?? ""} as of ${formatTickerTime(updatedAt)}\u00A0\u00A0`;

  const recalculate = useCallback(() => {
    const ticker = tickerRef.current;
    const track = trackRef.current;
    if (!ticker || !track || !msg) return;

    // Measure one span's width
    const firstSpan = track.querySelector("span");
    if (!firstSpan) return;
    const msgWidth = firstSpan.offsetWidth;
    const viewWidth = ticker.offsetWidth;

    const copiesNeeded = Math.max(2, Math.ceil(viewWidth / (msgWidth || 1)) + 1);
    setCopies(copiesNeeded * 2);

    const totalWidth = msgWidth * copiesNeeded;
    const duration = copiesNeeded * 20;
    setScrollStyle({
      "--scroll-distance": `-${totalWidth}px`,
      animation: `ticker-scroll ${duration}s linear infinite`,
    } as React.CSSProperties);
  }, [msg]);

  useEffect(() => {
    recalculate();
    window.addEventListener("resize", recalculate);
    return () => window.removeEventListener("resize", recalculate);
  }, [recalculate]);

  if (!updatedAt) return null;

  return (
    <div ref={tickerRef} className="bg-white border-y-2 border-dominos-red overflow-hidden whitespace-nowrap h-9 leading-9 max-[480px]:h-[30px] max-[480px]:leading-[30px]">
      <div ref={trackRef} className="inline-flex" style={scrollStyle}>
        {Array.from({ length: copies }, (_, i) => (
          <span key={i} className="text-dominos-blue text-[0.9rem] font-semibold max-[480px]:text-[0.75rem]">
            {msg}
          </span>
        ))}
      </div>
    </div>
  );
}
