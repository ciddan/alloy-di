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

const features = [
  {
    tag: "Build-time",
    title: "Static resolution",
    desc: "Alloy scans your source at build time to emit a static dependency graph — no reflection, minimal runtime.",
    icon: "cpu",
  },
  {
    tag: "Safety",
    title: "Errors caught at build time",
    desc: "Circular dependencies and duplicate registrations fail the build — not a request in production.",
    icon: "check",
  },
  {
    tag: "Code-split",
    title: "First-class lazy loading",
    desc: "Granular code-splitting per service via Lazy() and dynamic imports. Pay only for what's needed.",
    icon: "layers",
  },
  {
    tag: "Safety",
    title: "Fully type-safe",
    desc: "Generates TypeScript definitions for every service identifier. Your IDE knows the whole graph.",
    icon: "shield",
  },
  {
    tag: null,
    title: "Visualized graph",
    desc: "Because the whole graph is known ahead of time, Alloy emits a Mermaid diagram of your services.",
    icon: "graph",
  },
  {
    tag: null,
    title: "Framework agnostic",
    desc: "Works with React, Vue, Svelte, or vanilla TypeScript. It's just a Vite plugin.",
    icon: "puzzle",
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
  { num: "Automock", label: "Test container", link: "/guide/testing" },
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
      <div v-for="f in features" :key="f.title" class="feature-card">
        <span v-if="f.tag" class="feature-tag">{{ f.tag }}</span>
        <div class="feature-art">
          <svg
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <!-- Static resolution: a chip resolving an internal graph -->
            <template v-if="f.icon === 'cpu'">
              <rect class="art-fill" x="13" y="13" width="22" height="22" rx="5" />
              <path
                d="M19 7v6M29 7v6M19 35v6M29 35v6M7 19h6M7 29h6M35 19h6M35 29h6"
              />
              <path d="M22 21.5l5 -1M21 23l3.5 4.5M28 21l-2.5 6" />
              <circle class="art-fill" cx="20" cy="21" r="2.2" />
              <circle class="art-fill" cx="29" cy="20" r="2.2" />
              <circle class="art-key" cx="25" cy="29" r="2.8" />
            </template>
            <!-- Lazy loading: a bundle splitting into dynamically imported chunks -->
            <template v-else-if="f.icon === 'layers'">
              <rect class="art-fill" x="6" y="15" width="18" height="18" rx="4" />
              <path d="M24 21l7 -6" stroke-dasharray="2.5 3" />
              <path d="M24 27l7 6" stroke-dasharray="2.5 3" />
              <rect x="31" y="8" width="11" height="11" rx="3" />
              <rect x="31" y="29" width="11" height="11" rx="3" />
            </template>
            <!-- Framework agnostic: a plug-in puzzle piece -->
            <template v-else-if="f.icon === 'puzzle'">
              <g transform="scale(2)">
                <path
                  class="art-fill"
                  vector-effect="non-scaling-stroke"
                  d="M4 7h3a1 1 0 0 0 1 -1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0 -1 1v3a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-1a2 2 0 0 0 -4 0v1a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h1a2 2 0 0 0 0 -4h-1a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1z"
                />
              </g>
            </template>
            <!-- Errors caught at build time: a shield with a check -->
            <template v-else-if="f.icon === 'check'">
              <path
                class="art-fill"
                d="M24 5l15 5v10c0 10 -6.5 16.5 -15 20.5c-8.5 -4 -15 -10.5 -15 -20.5v-10z"
              />
              <path d="M16 24l5.5 5.5l11 -12" />
            </template>
            <!-- Visualized graph: a small dependency DAG -->
            <template v-else-if="f.icon === 'graph'">
              <path d="M10 14L24 24L10 36M24 24L38 14M24 24L38 36" />
              <circle class="art-fill" cx="10" cy="14" r="3.2" />
              <circle class="art-fill" cx="10" cy="36" r="3.2" />
              <circle class="art-fill" cx="38" cy="14" r="3.2" />
              <circle class="art-fill" cx="38" cy="36" r="3.2" />
              <circle class="art-key" cx="24" cy="24" r="4" />
            </template>
            <!-- Fully type-safe: a code/type glyph -->
            <template v-else>
              <path d="M18 16L9 24l9 8" />
              <path d="M30 16l9 8l-9 8" />
              <path d="M26 13l-4 22" />
            </template>
          </svg>
        </div>
        <p class="feature-title">{{ f.title }}</p>
        <p class="feature-desc">{{ f.desc }}</p>
      </div>
    </div>
  </div>
</template>
