<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <div class="alloy-divider">
    <span class="alloy-divider-line" />
    <span class="alloy-divider-label">{{ label }}</span>
    <span class="alloy-divider-line" />
  </div>
</template>
