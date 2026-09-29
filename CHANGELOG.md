# Changelog

## 2026-09-29 — Caleb's dedicated GHH runtime

- Deploy the web UI from `CalWtr/ghh-webui` at `/home/caleb/services/ghh-webui`, served on port 8081 by a NixOS-defined service.
- Point first-time browser defaults and the Settings placeholder to the deployed GHH model's UUID on dedicated Relative port 2708; previously saved endpoints remain user-controlled in localStorage and need updating manually.
- Document the checkout, service names, and browser-origin requirements. NixOS declarations are staged without a switch.
