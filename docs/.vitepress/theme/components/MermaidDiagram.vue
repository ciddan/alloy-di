<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue";
import { useData } from "vitepress";
import { renderMermaid } from "./mermaid-renderer";

// `code` is raw source; `codeBase64` is UTF-8 base64 (used by the ```mermaid
// markdown fence transform so multi-line content survives as an attribute).
const props = defineProps<{ code?: string; codeBase64?: string }>();
const { isDark } = useData();

const source = computed(() => {
  if (props.codeBase64) {
    const binary = atob(props.codeBase64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return props.code ?? "";
});

const host = ref<HTMLElement | null>(null);
const failed = ref(false);

async function render() {
  if (typeof window === "undefined" || !host.value) {
    return;
  }
  try {
    const svg = await renderMermaid(source.value, isDark.value);
    if (host.value) {
      host.value.innerHTML = svg;
    }
    failed.value = false;
  } catch {
    failed.value = true;
  }
}

onMounted(render);
watch([isDark, source], render);
</script>

<template>
  <div class="mermaid-diagram">
    <div v-show="!failed" ref="host" class="mermaid-diagram__canvas" />
    <pre v-if="failed" class="mermaid-diagram__fallback">{{ source }}</pre>
  </div>
</template>

<style scoped>
.mermaid-diagram {
  margin: 20px 0;
  padding: 20px;
  border: 0.5px solid var(--alloy-border, rgba(142, 175, 194, 0.12));
  border-radius: 10px;
  background: var(--alloy-bg-soft, #131920);
  overflow-x: auto;
}
.mermaid-diagram__canvas :deep(svg) {
  display: block;
  margin: 0 auto;
  max-width: 100%;
  height: auto;
}
/* Give label text room so descenders (g/p) are never clipped. */
.mermaid-diagram__canvas :deep(.nodeLabel),
.mermaid-diagram__canvas :deep(.edgeLabel),
.mermaid-diagram__canvas :deep(.messageText),
.mermaid-diagram__canvas :deep(.actor tspan) {
  line-height: 1.5;
}
.mermaid-diagram__canvas :deep(foreignObject) {
  overflow: visible;
}
.mermaid-diagram__fallback {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}
</style>
