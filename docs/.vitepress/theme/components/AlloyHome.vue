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
    category: "buildtime",
    title: "Static resolution",
    desc: "Alloy scans your source at build time to emit a static dependency graph — no reflection, minimal runtime.",
    icon: "cpu",
  },
  {
    category: "safety",
    title: "Errors caught at build time",
    desc: "Circular dependencies and duplicate registrations fail the build — not a request in production.",
    icon: "check",
  },
  {
    category: "performance",
    title: "First-class lazy loading",
    desc: "Granular code-splitting per service via Lazy() and dynamic imports. Pay only for what's needed.",
    icon: "layers",
  },
  {
    category: "safety",
    title: "Fully type-safe",
    desc: "Generates TypeScript definitions for every service identifier. Your IDE knows the whole graph.",
    icon: "shield",
  },
  {
    category: "buildtime",
    title: "Visualized graph",
    desc: "Because the whole graph is known ahead of time, Alloy emits a Mermaid diagram of your services.",
    icon: "graph",
  },
  {
    category: "compatibility",
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
      <div
        v-for="f in features"
        :key="f.title"
        class="feature-card"
        :class="`fc-${categories[f.category].color}`"
      >
        <div class="feature-body">
          <span class="feature-tag">{{ categories[f.category].label }}</span>
          <p class="feature-title">{{ f.title }}</p>
          <p class="feature-desc">{{ f.desc }}</p>
        </div>
        <div class="feature-art">
          <svg
            viewBox="0 0 60 96"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <!-- Static resolution: source files resolved through a chip -->
            <template v-if="f.icon === 'cpu'">
              <rect class="art-soft" x="11" y="8" width="16" height="19" rx="2.5" />
              <rect class="art-soft" x="33" y="8" width="16" height="19" rx="2.5" />
              <path class="art-muted" d="M15 14.5h8M15 18.5h6M37 14.5h8M37 18.5h6" />
              <path d="M19 27v6M41 27v6" />
              <path d="M15.5 31.5l3.5 3.5l3.5 -3.5M37.5 31.5l3.5 3.5l3.5 -3.5" />
              <rect class="art-fill" x="12" y="40" width="36" height="34" rx="6" />
              <path
                d="M22 36v4M38 36v4M22 74v4M38 74v4M8 49h4M8 65h4M48 49h4M48 65h4"
              />
              <path class="art-muted" d="M23 52l7 5M37 52l-7 5M30 57v9" />
              <circle class="art-soft" cx="23" cy="52" r="3" />
              <circle class="art-soft" cx="37" cy="52" r="3" />
              <circle class="art-solid" cx="30" cy="57" r="3.5" />
              <circle class="art-soft" cx="30" cy="66" r="3" />
            </template>

            <!-- Errors caught at build time: a build checklist, one failure caught -->
            <template v-else-if="f.icon === 'check'">
              <rect class="art-fill" x="9" y="9" width="42" height="78" rx="7" />
              <circle class="art-soft" cx="20" cy="25" r="5.5" />
              <path d="M17 25l2.2 2.2l4 -4.6" />
              <path class="art-muted" d="M31 25h13" />
              <circle class="art-soft" cx="20" cy="42" r="5.5" />
              <path d="M17 42l2.2 2.2l4 -4.6" />
              <path class="art-muted" d="M31 42h13" />
              <circle class="art-solid" cx="20" cy="59" r="5.5" />
              <path class="art-knock" d="M17.6 56.6l4.8 4.8M22.4 56.6l-4.8 4.8" />
              <path class="art-muted" d="M31 59h9" />
              <circle class="art-soft" cx="20" cy="76" r="5.5" />
              <path d="M17 76l2.2 2.2l4 -4.6" />
              <path class="art-muted" d="M31 76h13" />
            </template>

            <!-- Performance: code loaded on demand, fast (lightning) -->
            <template v-else-if="f.icon === 'layers'">
              <rect class="art-fill" x="13" y="6" width="34" height="20" rx="5" />
              <path class="art-muted" d="M19 12h22M19 17h14M19 21h18" />
              <g transform="translate(11 29) scale(1.7)">
                <path
                  class="art-solid"
                  d="M13 2L3 14h9l-1 8l10 -12h-9l1 -8z"
                />
              </g>
              <path d="M22 73l-6 9M38 73l6 9" stroke-dasharray="2.5 3" />
              <rect class="art-soft" x="5" y="82" width="18" height="12" rx="3" />
              <rect class="art-soft" x="37" y="82" width="18" height="12" rx="3" />
            </template>

            <!-- Fully type-safe: a typed code editor -->
            <template v-else-if="f.icon === 'shield'">
              <rect class="art-fill" x="9" y="9" width="42" height="78" rx="7" />
              <circle class="art-solid" cx="16" cy="18" r="1.8" />
              <circle class="art-soft" cx="22" cy="18" r="1.8" />
              <circle class="art-soft" cx="28" cy="18" r="1.8" />
              <path class="art-muted" d="M9 26h42" />
              <path class="art-muted" d="M15 35h9" />
              <rect class="art-soft" x="27" y="31.5" width="14" height="7" rx="3.5" />
              <path d="M19 48l-5 5l5 5M33 48l5 5l-5 5M30 46l-4 14" />
              <path class="art-muted" d="M15 70h22M15 77h13" />
            </template>

            <!-- Visualized graph: a vertical dependency DAG -->
            <template v-else-if="f.icon === 'graph'">
              <path
                class="art-muted"
                d="M30 12L17 38M30 12L43 38M17 38L17 64M43 38L43 64M17 38L43 64M17 64L30 86M43 64L30 86"
              />
              <circle class="art-soft" cx="30" cy="12" r="5" />
              <circle class="art-fill" cx="17" cy="38" r="5" />
              <circle class="art-fill" cx="43" cy="38" r="5" />
              <circle class="art-fill" cx="17" cy="64" r="5" />
              <circle class="art-fill" cx="43" cy="64" r="5" />
              <circle class="art-solid" cx="30" cy="86" r="6" />
            </template>

            <!-- Framework agnostic: a hub plugging into many frameworks -->
            <template v-else>
              <path class="art-muted" d="M30 38v-18M30 58v18M20 48h-4M40 48h4" />
              <rect class="art-soft" x="21" y="4" width="18" height="16" rx="4" />
              <rect class="art-soft" x="21" y="76" width="18" height="16" rx="4" />
              <rect class="art-soft" x="0" y="40" width="16" height="16" rx="4" />
              <rect class="art-soft" x="44" y="40" width="16" height="16" rx="4" />
              <path
                class="art-muted"
                d="M26 12h8M26 84h8M4 48h8M48 48h8"
              />
              <rect class="art-fill" x="20" y="38" width="20" height="20" rx="6" />
              <circle class="art-solid" cx="30" cy="48" r="4" />
              <path class="art-knock" d="M30 45v6M27 48h6" />
            </template>
          </svg>
        </div>
      </div>
    </div>
  </div>
</template>
