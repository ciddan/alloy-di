// Shared, serialized mermaid renderer.
//
// mermaid is a global singleton and `render()` is not safe to call
// concurrently — parallel calls clobber each other's temporary render DOM
// (diagrams come out merged or blank). Every diagram on the page therefore
// goes through one module-level promise queue with unique ids.

type Mermaid = typeof import("mermaid").default;

let mermaidPromise: Promise<Mermaid> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;
let currentTheme: "dark" | "neutral" | null = null;

function load(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

export function renderMermaid(code: string, isDark: boolean): Promise<string> {
  const run = queue.then(async () => {
    const mermaid = await load();
    const theme = isDark ? "dark" : "neutral";
    if (theme !== currentTheme) {
      mermaid.initialize({
        startOnLoad: false,
        theme,
        securityLevel: "loose",
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        sequence: { useMaxWidth: true },
        flowchart: { useMaxWidth: true },
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
