import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ColourOption {
  value: string;
  /** Swatch colour (CSS colour). Omit for a neutral entry such as "(keep)". */
  hex?: string;
  label: string;
  sub?: string;
  disabled?: boolean;
}

/**
 * Drop-down that shows a colour swatch next to every entry. Native <select>
 * options cannot carry swatches (macOS renders them as OS menus), so the list
 * is a portal-positioned popover under the trigger button.
 */
export function ColourSelect({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  title,
  filterable,
  className,
}: {
  value: string;
  options: ColourOption[];
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  title?: string;
  /** Show a text filter when the list is long. */
  filterable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [placement, setPlacement] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const current = options.find((option) => option.value === value);

  const updatePlacement = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const width = Math.max(rect.width, 240);
    const left = Math.min(rect.left, Math.max(8, window.innerWidth - width - 8));
    if (spaceBelow < 240 && rect.top > spaceBelow) setPlacement({ left, bottom: window.innerHeight - rect.top + 4, width });
    else setPlacement({ left, top: rect.bottom + 4, width });
  };

  useLayoutEffect(() => {
    if (open) updatePlacement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Scrolling (including the browser scrolling the focused trigger into
    // view right after it opens) just moves the popover along with the trigger.
    const onScroll = (event: Event) => {
      if (popoverRef.current?.contains(event.target as Node | null)) return;
      updatePlacement();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const needle = filter.trim().toLowerCase();
  const visible = needle ? options.filter((o) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(needle)) : options;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`colour-select-trigger${className ? ` ${className}` : ""}`}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setFilter("");
          setOpen((prev) => !prev);
        }}
      >
        {current?.hex ? <span className="swatch" style={{ background: current.hex, width: 16, height: 16 }} /> : <span className="swatch neutral" style={{ width: 16, height: 16 }} />}
        <span className="colour-select-label">{current ? current.label : placeholder}</span>
        <span className="colour-select-chevron">▾</span>
      </button>
      {open &&
        placement &&
        createPortal(
          <div
            ref={popoverRef}
            className="colour-select-popover"
            role="listbox"
            style={{ left: placement.left, top: placement.top, bottom: placement.bottom, width: placement.width }}
          >
            {filterable && options.length > 8 && (
              <input
                type="text"
                className="colour-select-filter"
                value={filter}
                placeholder="…"
                autoFocus
                onChange={(e) => setFilter(e.target.value)}
              />
            )}
            <div className="colour-select-list">
              {visible.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  className={`colour-option${option.value === value ? " active" : ""}`}
                  disabled={option.disabled}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  {option.hex ? <span className="swatch" style={{ background: option.hex, width: 18, height: 18 }} /> : <span className="swatch neutral" style={{ width: 18, height: 18 }} />}
                  <span className="colour-option-label">{option.label}</span>
                  {option.sub && <span className="colour-option-sub">{option.sub}</span>}
                </button>
              ))}
              {visible.length === 0 && <div className="muted colour-option-empty">–</div>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
