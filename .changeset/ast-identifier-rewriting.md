---
"alloy-di": patch
---

Rewrite dependency-expression identifiers by AST position instead of a
`\b`-regex text replacement. The regex never matched `$`-prefixed class names
(leaving the generated module referencing an unimported or wrong binding) and
rewrote matching text inside string literals and property names — a renamed
identifier could corrupt a lazy `import('/src/Api')` specifier or an
`m.Api` export access. Expressions are now parsed and only true identifier
references are rewritten; shorthand object properties expand
(`{ Api }` -> `{ Api: Api_1 }`) so keys survive renames.
