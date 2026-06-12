---
"alloy-di": patch
---

Stop retrying deterministic lazy-import validation failures. When a lazy
importer resolved successfully but did not yield a class constructor, the
validation error was thrown inside the retry loop, so it was retried with
full exponential backoff and finally re-wrapped as "Failed to import lazy
dependency", burying the actual "Lazy importer did not return a class"
diagnosis. Retries now apply only to the dynamic import itself; post-import
validation fails immediately with the original message.
