<template>
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
</template>
