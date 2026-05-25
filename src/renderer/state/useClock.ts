import { useEffect, useState } from 'react';

/** 1Hz wall-clock tick. Drives "x분 전" relative time labels on cards. */
export function useClock(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
