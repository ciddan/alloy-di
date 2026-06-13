<script setup lang="ts">
import { withBase } from "vitepress";

withDefaults(
  defineProps<{
    href: string;
    variant?: "primary" | "secondary";
  }>(),
  { variant: "primary" },
);
</script>

<template>
  <a
    :class="variant === 'secondary' ? 'btn-secondary' : 'btn-primary'"
    :href="withBase(href)"
  >
    <slot />
  </a>
</template>
