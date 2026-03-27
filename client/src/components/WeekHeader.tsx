import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WeekHeader({ onDaySelect }: { onDaySelect?: (dayOfWeek: number) => void }) {
  const { toast } = useToast();
  const today = new Date();
  const currentDayIndex = today.getUTCDay();
  const currentWeekStart = new Date(today);
  currentWeekStart.setUTCDate(today.getUTCDate() - currentDayIndex);
  currentWeekStart.setUTCHours(0, 0, 0, 0);

  const handleDayClick = (dayIndex: number) => {
    const dayDate = new Date(currentWeekStart);
    dayDate.setUTCDate(currentWeekStart.getUTCDate() + dayIndex);

    // Check if the day is in the past
    const dayStart = new Date(dayDate);
    dayStart.setUTCHours(0, 0, 0, 0);
    const todayStart = new Date(today);
    todayStart.setUTCHours(0, 0, 0, 0);

    if (dayStart < todayStart) {
      toast({
        title: "Day already passed",
        description: "You cannot schedule for past days",
        variant: "destructive",
      });
      return;
    }

    if (dayIndex !== currentDayIndex && onDaySelect) {
      if (dayStart > todayStart) {
        toast({
          title: "Future week",
          description: `This is an upcoming week. Switching to ${DAYS[dayIndex]}...`,
        });
      }
      onDaySelect(dayIndex);
    }
  };

  return (
    <div className="flex justify-between gap-1">
      {DAYS.map((day, i) => {
        const isToday = i === currentDayIndex;
        return (
          <button
            key={day}
            onClick={() => handleDayClick(i)}
            className={cn(
              "flex-1 py-2 px-1 rounded text-xs font-medium transition-all relative",
              isToday
                ? "bg-primary text-primary-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            {day}
            {isToday && (
              <>
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
