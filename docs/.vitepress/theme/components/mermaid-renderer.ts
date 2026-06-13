// Shared, serialized mermaid renderer.
//
// mermaid is a global singleton and `render()` is not safe to call
// concurrently — parallel calls clobber each other's temporary render DOM
// (diagrams come out merged or blank). Every diagram on the page therefore
// goes through one module-level promise queue with unique ids.

type Mermaid = typeof import("mermaid").default;

const FONT = "JetBrains Mono, ui-monospace, monospace";

// Brand-matched mermaid `base` theme variables. These drive the diagram chrome
// (surface, lines, edge labels, fonts) and fully style the sequence diagrams.
// The dependency-graph nodes/edges carry their own inline styles from the
// generated .mmd, so these mostly affect labels and the surrounding canvas.
const DARK_VARS = {
  darkMode: true,
  background: "#0d1117",
  fontFamily: FONT,
  fontSize: "13px",
  primaryColor: "#131920",
  primaryBorderColor: "#3b6ea5",
  primaryTextColor: "#c8d8e4",
  secondaryColor: "#1a2430",
  secondaryBorderColor: "#3b6ea5",
  secondaryTextColor: "#c8d8e4",
  tertiaryColor: "#131920",
  tertiaryBorderColor: "rgba(142,175,194,0.25)",
  tertiaryTextColor: "#c8d8e4",
  lineColor: "#7c93a6",
  textColor: "#c8d8e4",
  edgeLabelBackground: "#0d1117",
  // sequence diagrams
  actorBkg: "#131920",
  actorBorder: "#3b6ea5",
  actorTextColor: "#e8f0f7",
  actorLineColor: "#5a7488",
  signalColor: "#8eafc2",
  signalTextColor: "#c8d8e4",
  labelBoxBkgColor: "#131920",
  labelBoxBorderColor: "#3b6ea5",
  labelTextColor: "#c8d8e4",
  loopTextColor: "#c8d8e4",
  activationBkgColor: "#1a2430",
  activationBorderColor: "#3b6ea5",
  noteBkgColor: "#1a2430",
  noteBorderColor: "#3b6ea5",
  noteTextColor: "#c8d8e4",
  sequenceNumberColor: "#0d1117",
};

const LIGHT_VARS = {
  darkMode: false,
  background: "#ffffff",
  fontFamily: FONT,
  fontSize: "13px",
  primaryColor: "#f4f7fa",
  primaryBorderColor: "#3b6ea5",
  primaryTextColor: "#16222e",
  secondaryColor: "#eef3f8",
  secondaryBorderColor: "#3b6ea5",
  secondaryTextColor: "#16222e",
  tertiaryColor: "#f4f7fa",
  tertiaryBorderColor: "rgba(40,70,100,0.26)",
  tertiaryTextColor: "#16222e",
  lineColor: "#5a7488",
  textColor: "#2f4250",
  edgeLabelBackground: "#ffffff",
  // sequence diagrams
  actorBkg: "#f4f7fa",
  actorBorder: "#3b6ea5",
  actorTextColor: "#16222e",
  actorLineColor: "#8197a6",
  signalColor: "#5a7488",
  signalTextColor: "#2f4250",
  labelBoxBkgColor: "#f4f7fa",
  labelBoxBorderColor: "#3b6ea5",
  labelTextColor: "#2f4250",
  loopTextColor: "#2f4250",
  activationBkgColor: "#eef3f8",
  activationBorderColor: "#3b6ea5",
  noteBkgColor: "#eef3f8",
  noteBorderColor: "#3b6ea5",
  noteTextColor: "#2f4250",
  sequenceNumberColor: "#ffffff",
};

let mermaidPromise: Promise<Mermaid> | null = null;
let fontPromise: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;
let currentTheme: "dark" | "light" | null = null;

function load(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

// mermaid measures label boxes from the rendered font. If JetBrains Mono is
// still loading, boxes are sized for the fallback font and clip descenders
// (g/p) once the real font swaps in — so wait for it before rendering.
function ensureFont(): Promise<void> {
  if (!fontPromise) {
    fontPromise = (async () => {
      const fonts = (globalThis as { document?: { fonts?: FontFaceSet } })
        .document?.fonts;
      if (!fonts?.load) {
        return;
      }
      try {
        await fonts.load('13px "JetBrains Mono"');
        await fonts.ready;
      } catch {
        /* fall back to whatever is available */
      }
    })();
  }
  return fontPromise;
}

export function renderMermaid(code: string, isDark: boolean): Promise<string> {
  const run = queue.then(async () => {
    const mermaid = await load();
    await ensureFont();
    const theme = isDark ? "dark" : "light";
    if (theme !== currentTheme) {
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        securityLevel: "loose",
        fontFamily: FONT,
        themeVariables: isDark ? DARK_VARS : LIGHT_VARS,
        flowchart: { useMaxWidth: true, htmlLabels: true, padding: 14 },
        sequence: { useMaxWidth: true },
      });
      currentTheme = theme;
    }
    const { svg } = await mermaid.render(`alloy-mmd-${counter++}`, code);
    return svg;
  });
  // Keep the queue chained even if an individual render rejects.
  queue = run.catch(() => undefined);
  return run;
}
