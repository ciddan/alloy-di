<script setup lang="ts">
import { ref } from "vue";

const installCmd = "pnpm add -D alloy-di";
const copied = ref(false);

function copyInstall() {
  navigator.clipboard?.writeText(installCmd).then(() => {
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
  });
}
</script>

<template>
  <button
    class="btn-install"
    type="button"
    @click="copyInstall"
    :aria-label="`Copy install command: ${installCmd}`"
  >
    <span class="btn-install-prompt">$</span>
    {{ copied ? "copied to clipboard" : installCmd }}
  </button>
</template>
