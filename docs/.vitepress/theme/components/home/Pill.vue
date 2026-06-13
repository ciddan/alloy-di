<script setup lang="ts">
import type { Component } from "vue";

withDefaults(
  defineProps<{
    icon?: Component;
    dot?: boolean;
    color?: "accent" | "blue" | "teal" | "amber" | "violet";
    size?: "sm" | "md";
  }>(),
  { color: "accent", size: "md", dot: false },
);
</script>

<template>
  <span class="pill" :class="[`pill--${color}`, `pill--${size}`]">
    <span v-if="dot" class="pill-dot" />
    <component v-else-if="icon" :is="icon" class="pill-icon" />
    <slot />
  </span>
</template>
