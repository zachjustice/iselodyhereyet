import { useRef, useCallback } from "react";

interface HeaderProps {
  onBellClick: () => void;
  showBell: boolean;
}

export function Header({ onBellClick, showBell }: HeaderProps) {
  const bellRef = useRef<HTMLButtonElement>(null);

  const handleBellClick = useCallback(() => {
    const el = bellRef.current;
    if (el) {
      el.classList.remove("animate-jingle");
      void el.offsetHeight;
      el.classList.add("animate-jingle");
      el.addEventListener("animationend", () => el.classList.remove("animate-jingle"), { once: true });
    }
    onBellClick();
  }, [onBellClick]);

  return (
    <div className="bg-dominos-blue py-3.5 px-5 text-center relative max-[480px]:py-2.5 max-[480px]:px-4">
      <h1 className="text-white text-[1.3rem] font-bold tracking-[0.5px] max-[480px]:text-[1.05rem]">
        Track Your Order
      </h1>
      {showBell && (
        <button
          ref={bellRef}
          onClick={handleBellClick}
          className="absolute right-4 top-1/2 -translate-y-1/2 bg-transparent border-none text-xl cursor-pointer p-1 leading-none"
          aria-label="Enable notifications"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
      )}
    </div>
  );
}
