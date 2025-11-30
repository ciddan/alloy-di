---
layout: home

hero:
  name: Alloy
  text: Compile-time Dependency Injection for Vite
  tagline: High-performance, reflection-free DI that scales.
  image:
    src: /logo.svg
    alt: Alloy
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Why Alloy?
      link: /guide/what-is-alloy
    - theme: alt
      text: View on GitHub
      link: https://github.com/ciddan/alloy-di

features:
  - title: Compile-time Resolution
    details: Scans your code at build time to generate a static dependency graph. Zero runtime reflection.
    icon:
      src: /rolldown.svg
      width: 32px
      height: 32px
  - title: First-class Lazy Loading
    details: Granular code-splitting for services and their dependencies via `Lazy()` and dynamic imports.
    icon:
      src: /package.svg
      width: 32px
      height: 32px
  - title: Framework Agnostic
    details: Works with any framework (React, Vue, Svelte) or vanilla TS. It's just a Vite plugin.
    icon:
      src: /vite.svg
      width: 32px
      height: 32px
  - title: Type Safe
    details: Built with TypeScript in mind. Generates type definitions for your service identifiers.
    icon:
      src: /TypeScript.svg
      width: 32px
      height: 32px
---
