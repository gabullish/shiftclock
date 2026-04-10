// use-drag-scroll.tsx — pointer-capture drag scroll for the timeline canvas.
// Uses setPointerCapture so the drag stays active even when the pointer leaves the element.

import { useRef, useState } from "react";

const DRAG_THRESHOLD = 5; // px — below this we treat it as a click, not a drag

export function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const startX    = useRef(0);
  const scrollLeft = useRef(0);
  const dragged   = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    ref.current.setPointerCapture(e.pointerId);
    setIsDragging(true);
    startX.current    = e.pageX - ref.current.offsetLeft;
    scrollLeft.current = ref.current.scrollLeft;
    dragged.current   = false;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !ref.current) return;
    const x    = e.pageX - ref.current.offsetLeft;
    const walk = (x - startX.current) * 2.5;
    if (Math.abs(walk) > DRAG_THRESHOLD) dragged.current = true;
    ref.current.scrollLeft = scrollLeft.current - walk;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    ref.current.releasePointerCapture(e.pointerId);
    setIsDragging(false);
    dragged.current = false;
  };

  // Call this in onPointerDownCapture on interactive children to let clicks through
  const stopDrag = (e: React.PointerEvent) => {
    if (dragged.current) e.stopPropagation();
  };

  return {
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave: onPointerUp,
    stopDrag,
    isDragging,
  };
}
