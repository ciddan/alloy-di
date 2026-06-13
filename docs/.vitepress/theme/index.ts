import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import AlloyHome from "./components/AlloyHome.vue";
import MermaidDiagram from "./components/MermaidDiagram.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("AlloyHome", AlloyHome);
    app.component("MermaidDiagram", MermaidDiagram);
  },
} satisfies Theme;
