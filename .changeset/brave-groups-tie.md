---
"alloy-di": patch
---

Fix service scanning so Alloy only recognizes `@Injectable` and `@Singleton`
decorators that resolve back to `alloy-di/runtime`. Aliased imports, namespace
imports, and local re-exports still work, while unrelated decorators with the
same names are ignored.
