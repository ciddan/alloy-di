---
"alloy-di": patch
---

Reject bare `@Injectable` / `@Singleton` (missing parentheses) instead of
silently replacing the decorated class. Applied without parentheses, the
decorator factory received the class itself, mistook it for a dependencies
thunk, and returned a decorator function that legacy decorator semantics then
substituted for the class — while the build-time scanner also skipped the
service entirely. The runtime now throws a `TypeError` pointing at the fix,
and the scanner emits a build warning with the file and line when it sees a
bare alloy decorator.
