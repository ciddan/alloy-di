import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Alloy",
  description: "Compile-time Dependency Injection for Vite",
  head: [
    ["link", { rel: "icon", href: "/favicon.ico", sizes: "48x48" }],
    [
      "link",
      { rel: "icon", href: "/logo.svg", sizes: "any", type: "image/svg+xml" },
    ],
  ],
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Guide", link: "/guide/what-is-alloy" },
      { text: "API", link: "/api/" },
      { text: "Config", link: "/config/" },
      {
        text: "Examples",
        link: "https://github.com/upn/alloy/tree/main/packages/examples",
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

    socialLinks: [{ icon: "github", link: "https://github.com/upn/alloy" }],
  },
});
