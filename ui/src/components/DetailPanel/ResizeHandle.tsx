import { useCallback, useRef } from "react";
import { useAppStore } from "../../stores/appStore";

export function ResizeHandle() {
  const setDetailHeight = useAppStore((s) => s.setDetailHeight);
  const dragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";

      const handleMouseMove = (e: MouseEvent) => {
        if (!dragging.current) return;
        const content = document.querySelector(".content");
        if (!content) return;
        const rect = content.getBoundingClientRect();
        const newHeight = rect.bottom - e.clientY;
        const clamped = Math.max(100, Math.min(newHeight, rect.height - 100));
        setDetailHeight(clamped);
      };

      const handleMouseUp = () => {
        dragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [setDetailHeight]
  );

  return (
    <div
      className={`resize-handle${dragging.current ? " dragging" : ""}`}
      onMouseDown={onMouseDown}
    />
  );
}
