import { d as client, j as jsxRuntimeExports, r as reactExports, M as Mic, X, P as Play, b as Pause, S as Square } from "./index-Bc-77dlz.js";
const EMPTY = {
  visible: false,
  noteId: null,
  title: "",
  subtitle: "",
  status: "recording",
  startedAt: Date.now(),
  tone: "record"
};
function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1e3));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function Button({
  onClick,
  children,
  tone = "ghost",
  title
}) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-medium transition-colors";
  const styles = tone === "primary" ? "bg-primary text-white hover:bg-primaryHover px-3 py-1.5" : tone === "danger" ? "bg-red-600 text-white hover:bg-red-700 px-3 py-1.5" : "px-2.5 py-1.5 text-inkSoft hover:bg-pill hover:text-ink";
  return /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", title, onClick, className: `${base} ${styles}`, children });
}
function NotifyApp() {
  const [state, setState] = reactExports.useState(EMPTY);
  const [now, setNow] = reactExports.useState(Date.now());
  const [pausedTotal, setPausedTotal] = reactExports.useState(0);
  const pausedAt = reactExports.useRef(null);
  reactExports.useEffect(() => {
    const off = window.notifyApi.onState((s) => setState(s));
    return () => off();
  }, []);
  reactExports.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1e3);
    return () => window.clearInterval(id);
  }, []);
  reactExports.useEffect(() => {
    if (!state.visible) {
      pausedAt.current = null;
      setPausedTotal(0);
      return;
    }
    if (state.status === "paused") {
      if (pausedAt.current === null) pausedAt.current = Date.now();
    } else if (pausedAt.current !== null) {
      const span = Date.now() - pausedAt.current;
      pausedAt.current = null;
      setPausedTotal((t) => t + span);
    }
  }, [state.status, state.visible, state.startedAt]);
  if (!state.visible) return null;
  const paused = state.status === "paused";
  const act = (a) => {
    void window.notifyApi.action(a);
  };
  const toneStyles = state.tone === "warn" ? "border-amber-300 bg-amber-50" : state.tone === "info" ? "border-hairline bg-surface" : "border-hairline bg-surface";
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "p-2", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      className: `w-full rounded-xl2 border shadow-pop ${toneStyles}`,
      style: { WebkitAppRegion: "drag" },
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start gap-3 px-3.5 pb-2.5 pt-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "span",
            {
              className: `mt-[3px] flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${paused ? "bg-amber-100 text-amber-700" : "bg-liveSoft text-liveInk"}`,
              children: /* @__PURE__ */ jsxRuntimeExports.jsx(Mic, { size: 15 })
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "min-w-0 flex-1", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "truncate text-[13px] font-semibold text-ink", children: state.title || (paused ? "Kayıt duraklatıldı" : "Kayıt başladı") }),
              !paused && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "live-dot h-[7px] w-[7px] shrink-0 rounded-full bg-live" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "mt-0.5 truncate text-[11.5px] text-faint", children: [
              paused ? "Duraklatıldı" : clock(now - state.startedAt - pausedTotal),
              state.subtitle ? ` • ${state.subtitle}` : ""
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { WebkitAppRegion: "no-drag" }, children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              title: "Kapat (kayıt sürer)",
              onClick: () => act("open"),
              className: "inline-flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-pill hover:text-ink",
              children: /* @__PURE__ */ jsxRuntimeExports.jsx(X, { size: 14 })
            }
          ) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "div",
          {
            className: "flex items-center justify-end gap-1.5 border-t border-hairlineSoft px-3 py-2",
            style: { WebkitAppRegion: "no-drag" },
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs(
                Button,
                {
                  onClick: () => act(paused ? "resume" : "pause"),
                  title: paused ? "Devam et" : "Duraklat",
                  children: [
                    paused ? /* @__PURE__ */ jsxRuntimeExports.jsx(Play, { size: 13 }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Pause, { size: 13 }),
                    paused ? "Devam" : "Duraklat"
                  ]
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { onClick: () => act("stop"), tone: "primary", title: "Kaydı bitir ve notu kaydet", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Square, { size: 12 }),
                "Durdur"
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { onClick: () => act("cancel"), tone: "danger", title: "Kaydı iptal et (boşsa not silinir)", children: "İptal" })
            ]
          }
        )
      ]
    }
  ) });
}
client.createRoot(document.getElementById("notify-root")).render(/* @__PURE__ */ jsxRuntimeExports.jsx(NotifyApp, {}));
