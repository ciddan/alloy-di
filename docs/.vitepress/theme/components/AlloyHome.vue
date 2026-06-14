<script setup lang="ts">
import Hero from "./home/Hero.vue";
import BenefitBar from "./home/BenefitBar.vue";
import SectionDivider from "./home/SectionDivider.vue";
import FeatureCard from "./home/FeatureCard.vue";
import IconChip from "./home/icons/IconChip.vue";
import IconCheck from "./home/icons/IconCheck.vue";
import IconBolt from "./home/icons/IconBolt.vue";
import IconGraph from "./home/icons/IconGraph.vue";
import IconPuzzle from "./home/icons/IconPuzzle.vue";
import IconBrackets from "./home/icons/IconBrackets.vue";

// A feature's category owns both its eyebrow label and its accent hue, so the
// colour always maps to meaning (and is defined in exactly one place).
const categories = {
  buildtime: { label: "Build-time", color: "blue" },
  safety: { label: "Safety", color: "teal" },
  performance: { label: "Performance", color: "amber" },
  compatibility: { label: "Compatibility", color: "violet" },
} as const;

const features = [
  {
    category: "performance",
    title: "First-class lazy loading",
    desc: "Granular code-splitting per service via Lazy() and dynamic imports. Pay only for what's needed.",
    icon: IconBolt,
  },
  {
    category: "compatibility",
    title: "Bundler & Framework agnostic",
    desc: "Use Alloy with Vite, webpack, or Rspack, and keep the same generated container across React, Vue, Svelte, or plain TypeScript apps.",
    icon: IconPuzzle,
  },
  {
    category: "buildtime",
    title: "Static resolution",
    desc: "Alloy scans your source at build time to emit a static dependency graph — no reflection, minimal runtime.",
    icon: IconChip,
  },
  {
    category: "buildtime",
    title: "Visualized graph",
    desc: "Because the whole graph is known ahead of time, Alloy emits a Mermaid diagram of your services.",
    icon: IconGraph,
  },
  {
    category: "safety",
    title: "Errors caught at build time",
    desc: "Circular dependencies and duplicate registrations fail the build — not a request in production.",
    icon: IconCheck,
  },
  {
    category: "safety",
    title: "Fully type-safe",
    desc: "Generates TypeScript definitions for every service identifier. Your IDE knows the whole graph.",
    icon: IconBrackets,
  },
] as const;

// Quick-nav strip under the hero — wayfinding into the guides, deliberately a
// different register from the feature cards (which pitch what Alloy is).
const benefits = [
  {
    num: "Setup",
    label: "5-minute quickstart",
    link: "/guide/getting-started",
  },
  { num: "Lazy", label: "Code-split services", link: "/guide/lazy-loading" },
  { num: "Graph", label: "Inspect dependencies", link: "/guide/visualization" },
  { num: "Test", label: "Easy mocking", link: "/guide/testing" },
];
</script>

<template>
  <div class="alloy-home">
    <Hero />
    <BenefitBar :items="benefits" />
    <SectionDivider label="Core capabilities" />
    <div class="alloy-features">
      <FeatureCard
        v-for="f in features"
        :key="f.title"
        :category="categories[f.category].label"
        :color="categories[f.category].color"
        :icon="f.icon"
        :heading="f.title"
        :text="f.desc"
      />
    </div>
  </div>
</template>
