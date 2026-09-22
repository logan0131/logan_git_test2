import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useT } from "../i18n";

/**
 * Small "?" button that opens an explanation popover. `text` is a block of
 * lines; lines starting with "- " become list items, others paragraphs.
 */
export function HelpTip({ text, title }: { text: string; title?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const place = useCallback(() => {
    const button = buttonRef.current;
    const popover = popoverRef.current;
    if (!button || !popover) return;
    const rect = button.getBoundingClientRect();
    const width = popover.offsetWidth || 320;
    const height = popover.offsetHeight || 200;
    const margin = 8;
    let left = rect.left;
    if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - width);
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - 6);
    setStyle({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const blocks: Array<{ kind: "p" | "li"; text: string }> = lines.map((line) =>
    line.startsWith("- ") ? { kind: "li", text: line.slice(2) } : { kind: "p", text: line },
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`help-tip${open ? " open" : ""}`}
        aria-label={t("help.title")}
        title={t("help.title")}
        onClick={(event) => {
          // Inside a <summary>, a click would also toggle the section.
          event.preventDefault();
          event.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      {open && (
        <div ref={popoverRef} className="help-popover" style={style} role="dialog">
          <b>{title ?? t("help.title")}</b>
          {blocks.map((block, i) =>
            block.kind === "li" ? (
              <div key={i} className="help-li">
                {block.text}
              </div>
            ) : (
              <p key={i}>{block.text}</p>
            ),
          )}
        </div>
      )}
    </>
  );
}
