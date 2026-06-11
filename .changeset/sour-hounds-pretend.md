---
"alloy-di": patch
---

Fix duplicate service registration checks so Alloy compares stable service
identities instead of class names alone. Libraries and apps can now define
services with the same class name without triggering false duplicate errors,
while true identity collisions still fail the build.
