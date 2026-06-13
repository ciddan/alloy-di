import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Alloy",
  description: "Compile-time Dependency Injection for Vite",
  base: "/",
  head: [
    ["link", { rel: "icon", href: "/favicon.ico", sizes: "48x48" }],
    [
      "link",
      { rel: "icon", href: "/logo.svg", sizes: "any", type: "image/svg+xml" },
    ],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    [
      "link",
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
    ],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
    ["meta", { name: "theme-color", content: "#0D1117" }],
  ],
  appearance: "dark",
  markdown: {
    // Render ```mermaid fences through the <MermaidDiagram> component.
    // The source is base64-encoded so multi-line content survives as an attribute.
    config(md) {
      const fence = md.renderer.rules.fence;
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token.info.trim() === "mermaid") {
          const encoded = Buffer.from(token.content, "utf-8").toString(
            "base64",
          );
          return `<MermaidDiagram code-base64="${encoded}"></MermaidDiagram>`;
        }
        return fence
          ? fence(tokens, idx, options, env, self)
          : self.renderToken(tokens, idx, options);
      };
    },
  },
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Guide", link: "/guide/what-is-alloy" },
      { text: "API", link: "/api/" },
      { text: "Config", link: "/config/" },
      {
        text: "Examples",
        link: "https://github.com/ciddan/alloy-di/tree/main/packages/examples",
      },
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "What is Alloy?", link: "/guide/what-is-alloy" },
          { text: "Getting Started", link: "/guide/getting-started" },
        ],
      },
      {
        text: "Configuration",
        items: [
          { text: "Overview", link: "/config/" },
          { text: "Vite Plugin", link: "/config/vite-plugin" },
          { text: "Rollup Plugin", link: "/config/rollup-plugin" },
        ],
      },
      {
        text: "Core Concepts",
        items: [
          { text: "Lazy Loading", link: "/guide/lazy-loading" },
          { text: "Dependency Graph", link: "/guide/visualization" },
          { text: "Internal Libraries", link: "/guide/libraries" },
          { text: "Testing & Mocking", link: "/guide/testing" },
        ],
      },
      {
        text: "Advanced",
        items: [
          { text: "Plugin Architecture", link: "/advanced/architecture" },
        ],
      },
      {
        text: "Reference",
        items: [{ text: "API Surface", link: "/api/" }],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/ciddan/alloy-di" },
    ],
  },
});
