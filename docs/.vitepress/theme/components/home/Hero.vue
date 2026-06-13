<script setup lang="ts">
import Button from "./Button.vue";
import InstallButton from "./InstallButton.vue";
import CodeBox from "./CodeBox.vue";
import Pill from "./Pill.vue";

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
</script>

<template>
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
        <Pill dot>Vite Plugin · DI Framework</Pill>
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
          <Button href="/guide/getting-started">Get started →</Button>
          <Button href="/guide/what-is-alloy#why-alloy" variant="secondary">
            Why Alloy?
          </Button>
          <InstallButton />
        </div>
      </div>

      <CodeBox />
    </div>
  </section>
</template>
