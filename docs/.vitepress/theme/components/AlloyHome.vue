<script setup lang="ts">
import { ref } from "vue";
import { withBase } from "vitepress";

const installCmd = "pnpm add -D alloy-di";
const copied = ref(false);

function copyInstall() {
  navigator.clipboard?.writeText(installCmd).then(() => {
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
  });
}

/* Decorative dependency-graph (DAG) for the hero backdrop.
 * Laid out left→right in three layers, like a resolved graph. */
const gnodes = [
  { x: 150, y: 92, r: 4 },
  { x: 150, y: 214, r: 4 },
  { x: 272, y: 56, r: 4 },
  { x: 272, y: 150, r: 6, key: true },
  { x: 272, y: 252, r: 4 },
  { x: 392, y: 104, r: 5, key: true },
  { x: 392, y: 206, r: 4 },
  { x: 392, y: 300, r: 4 },
  { x: 452, y: 58, r: 3 },
];
const gedges: [number, number][] = [
  [0, 2],
  [0, 3],
  [1, 3],
  [1, 4],
  [2, 5],
  [3, 5],
  [3, 6],
  [4, 6],
  [4, 7],
  [5, 8],
  [6, 7],
  [2, 8],
];

// A feature's category owns both its eyebrow label and its accent hue, so the
// colour always maps to meaning (and is defined in exactly one place).
const categories = {
  buildtime: { label: "Build-time", color: "blue" },
  safety: { label: "Safety", color: "teal" },
  performance: { label: "Performance", color: "amber" },
  compatibility: { label: "Compatibility", color: "violet" },
};

const features = [
  {
    category: "performance",
    title: "First-class lazy loading",
    desc: "Granular code-splitting per service via Lazy() and dynamic imports. Pay only for what's needed.",
    icon: "layers",
  },
  {
    category: "compatibility",
    title: "Framework agnostic",
    desc: "Works with React, Vue, Svelte, or vanilla TypeScript. It's just a Vite plugin.",
    icon: "puzzle",
  },
  {
    category: "buildtime",
    title: "Static resolution",
    desc: "Alloy scans your source at build time to emit a static dependency graph — no reflection, minimal runtime.",
    icon: "cpu",
  },
  {
    category: "buildtime",
    title: "Visualized graph",
    desc: "Because the whole graph is known ahead of time, Alloy emits a Mermaid diagram of your services.",
    icon: "graph",
  },
  {
    category: "safety",
    title: "Errors caught at build time",
    desc: "Circular dependencies and duplicate registrations fail the build — not a request in production.",
    icon: "check",
  },
  {
    category: "safety",
    title: "Fully type-safe",
    desc: "Generates TypeScript definitions for every service identifier. Your IDE knows the whole graph.",
    icon: "shield",
  },
];

// Quick-nav strip under the hero — wayfinding into the guides, deliberately a
// different register from the feature cards (which pitch what Alloy is).
const benefits = [
  {
    num: "Setup",
    label: "5-minute quickstart",
    link: "/guide/getting-started",
  },
  { num: "Lazy", label: "Code-split services", link: "/guide/lazy-loading" },
  {
    num: "Graph",
    label: "Inspect dependencies",
    link: "/guide/visualization",
  },
  { num: "Test", label: "Easy mocking", link: "/guide/testing" },
];
</script>

<template>
  <div class="alloy-home">
    <!-- HERO -->
    <section class="alloy-hero">
      <!-- layered backdrop: grid + glow + dependency graph -->
      <div class="hero-bg" aria-hidden="true">
        <div class="hero-grid-lines" />
        <div class="hero-glow" />
        <svg
          class="hero-graph"
          viewBox="0 0 520 360"
          preserveAspectRatio="xMidYMid slice"
        >
          <g class="graph-edges">
            <line
              v-for="([a, b], i) in gedges"
              :key="`e${i}`"
              :x1="gnodes[a].x"
              :y1="gnodes[a].y"
              :x2="gnodes[b].x"
              :y2="gnodes[b].y"
              :style="{ animationDelay: `${i * 0.18}s` }"
            />
          </g>
          <g class="graph-nodes">
            <circle
              v-for="(n, i) in gnodes"
              :key="`n${i}`"
              :cx="n.x"
              :cy="n.y"
              :r="n.r"
              :class="{ 'is-key': n.key }"
              :style="{ animationDelay: `${i * 0.22}s` }"
            />
          </g>
        </svg>
      </div>

      <div class="hero-grid">
        <div class="hero-content">
          <div class="hero-eyebrow">
            <span class="hero-eyebrow-dot" />
            Vite Plugin · DI Framework
          </div>
          <h1 class="hero-headline">Build-time</h1>
          <h1 class="hero-headline hero-headline--accent">
            Dependency Injection.
          </h1>
          <p class="hero-desc">
            Build-time safety, zero runtime reflection. Alloy resolves your
            dependency graph at build time — generating a static, type-safe
            container that ships nothing it doesn't use.
          </p>
          <div class="hero-ctas">
            <a class="btn-primary" :href="withBase('/guide/getting-started')">
              Get started →
            </a>
            <a
              class="btn-secondary"
              :href="withBase('/guide/what-is-alloy#why-alloy')"
            >
              Why Alloy?
            </a>
            <button
              class="btn-install"
              type="button"
              @click="copyInstall"
              :aria-label="`Copy install command: ${installCmd}`"
            >
              <span class="btn-install-prompt">$</span>
              {{ copied ? "copied to clipboard" : installCmd }}
            </button>
          </div>
        </div>

        <div class="hero-code">
          <div class="code-window">
            <div class="code-bar">
              <span class="code-dot" />
              <span class="code-dot" />
              <span class="code-dot" />
              <span class="code-label">vite.config.ts</span>
            </div>
            <pre
              class="code-body"
            ><span class="ck">import</span> <span class="ct">{ defineConfig }</span> <span class="ck">from</span> <span class="cs">'vite'</span>
<span class="ck">import</span> <span class="ct">{ alloy }</span> <span class="ck">from</span> <span class="cs">'alloy-di/vite'</span>

<span class="ck">export default</span> <span class="cf">defineConfig</span>(<span class="ct">{</span>
  <span class="ct">plugins:</span> [
    <span class="cf">alloy</span>(<span class="ct">{</span>
      <span class="ct">providers:</span> [<span class="cs">'src/providers.ts'</span>],
    <span class="ct">}</span>),
  ],
<span class="ct">}</span>)</pre>
          </div>
        </div>
      </div>
    </section>

    <!-- BENEFITS (quick-nav strip under the hero) -->
    <div class="alloy-benefits">
      <component
        v-for="b in benefits"
        :is="b.link ? 'a' : 'div'"
        :key="b.label"
        :href="b.link ? withBase(b.link) : undefined"
        class="benefit"
        :class="{ 'benefit--link': b.link }"
      >
        <div class="benefit-num">{{ b.num }}</div>
        <div class="benefit-label">
          {{ b.label }}<span v-if="b.link" class="benefit-arrow">→</span>
        </div>
      </component>
    </div>

    <!-- DIVIDER -->
    <div class="alloy-divider">
      <span class="alloy-divider-line" />
      <span class="alloy-divider-label">Core capabilities</span>
      <span class="alloy-divider-line" />
    </div>

    <!-- FEATURES -->
    <div class="alloy-features">
      <div
        v-for="f in features"
        :key="f.title"
        class="feature-card"
        :class="`fc-${categories[f.category].color}`"
      >
        <div class="feature-body">
          <span class="feature-tag">
            <svg
              class="feature-tag-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <template v-if="f.icon === 'cpu'">
                <path
                  d="M5 6a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1z"
                />
                <path d="M9 9h6v6h-6z" />
                <path
                  d="M3 10h2M3 14h2M10 3v2M14 3v2M21 10h-2M21 14h-2M14 21v-2M10 21v-2"
                />
              </template>
              <template v-else-if="f.icon === 'check'">
                <circle cx="12" cy="12" r="9" />
                <path d="M8.5 12l2.5 2.5l4.5 -5" />
              </template>
              <template v-else-if="f.icon === 'layers'">
                <path d="M13 2L3 14h9l-1 8l10 -12h-9l1 -8z" />
              </template>
              <template v-else-if="f.icon === 'graph'">
                <circle cx="6" cy="6" r="2.5" />
                <circle cx="6" cy="18" r="2.5" />
                <circle cx="18" cy="12" r="2.5" />
                <path d="M8.2 7.2l7.6 3.6M8.2 16.8l7.6 -3.6" />
              </template>
              <template v-else-if="f.icon === 'puzzle'">
                <path
                  d="M4 7h3a1 1 0 0 0 1 -1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0 -1 1v3a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-1a2 2 0 0 0 -4 0v1a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h1a2 2 0 0 0 0 -4h-1a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1z"
                />
              </template>
              <template v-else>
                <path d="M8 9l-4 3l4 3" />
                <path d="M16 9l4 3l-4 3" />
                <path d="M13 7l-2 10" />
              </template>
            </svg>
            {{ categories[f.category].label }}
          </span>
          <p class="feature-title">{{ f.title }}</p>
          <p class="feature-desc">{{ f.desc }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
