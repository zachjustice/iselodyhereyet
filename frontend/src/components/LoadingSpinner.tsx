export function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-15 px-5">
      <div className="w-10 h-10 border-4 border-gray-300 border-t-dominos-blue rounded-full animate-spin" />
      <div className="mt-4 text-gray-400 text-sm">
        Checking delivery status...
      </div>
    </div>
  );
}
