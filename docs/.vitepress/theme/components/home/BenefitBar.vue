<script setup lang="ts">
import { withBase } from "vitepress";

defineProps<{
  items: { num: string; label: string; link?: string }[];
}>();
</script>

<template>
  <div class="alloy-benefits">
    <component
      v-for="b in items"
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
</template>
