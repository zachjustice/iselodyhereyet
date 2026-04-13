export function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-15 px-5">
      <div className="w-10 h-10 border-4 border-[#ddd] border-t-dominos-blue rounded-full animate-spin-fast" />
      <div className="mt-4 text-[#888] text-[0.9rem]">
        Checking delivery status...
      </div>
    </div>
  );
}
