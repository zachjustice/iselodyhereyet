import { Header } from "./components/Header";
import { LoadingSpinner } from "./components/LoadingSpinner";
import { NewsTicker } from "./components/NewsTicker";
import { ProgressTracker } from "./components/ProgressTracker";
import { FunFacts } from "./components/FunFacts";
import { NotificationButton } from "./components/NotificationButton";
import { Confetti } from "./components/Confetti";
import { useStatus } from "./hooks/useStatus";
import { useFunFacts } from "./hooks/useFunFacts";
import { useNotifications } from "./hooks/useNotifications";
import { useTabNotification } from "./hooks/useTabNotification";
import funFacts from "./data/fun_facts.json";

export default function App() {
  const { stage, updatedAt, message, isLoading } = useStatus();
  const { currentFact, progress } = useFunFacts(funFacts);
  const { isSubscribed, isSupported, isIosNonStandalone, subscribe, error } =
    useNotifications();
  useTabNotification(stage, isLoading);

  const showBell =
    localStorage.getItem("notifyDismissed") === "1" &&
    (isSupported || isIosNonStandalone);

  return (
    <>
      <Header
        onBellClick={() => {
          localStorage.removeItem("notifyDismissed");
          window.location.reload();
        }}
        showBell={showBell}
      />
      {!isLoading && <NewsTicker stage={stage} updatedAt={updatedAt} />}
      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <>
          <ProgressTracker
            stage={stage}
            updatedAt={updatedAt}
            message={message}
          />
          <NotificationButton
            isSubscribed={isSubscribed}
            isSupported={isSupported}
            isIosNonStandalone={isIosNonStandalone}
            onSubscribe={subscribe}
            error={error}
          />
          <FunFacts currentFact={currentFact} progress={progress} />
          <Confetti stage={stage} isLoading={isLoading} />
        </>
      )}
    </>
  );
}
