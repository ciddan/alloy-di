<script setup lang="ts">
import type { Component } from "vue";
import Pill from "./Pill.vue";

defineProps<{
  category: string;
  heading: string;
  text: string;
  icon: Component;
  color: "blue" | "teal" | "amber" | "violet";
}>();
</script>

<template>
  <div class="feature-card" :class="`fc-${color}`">
    <div class="feature-body">
      <Pill :icon="icon" :color="color">{{ category }}</Pill>
      <p class="feature-title">{{ heading }}</p>
      <p class="feature-desc">{{ text }}</p>
    </div>
  </div>
</template>
