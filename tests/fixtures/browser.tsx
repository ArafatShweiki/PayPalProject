// Import through Vite's source transform so the harness and application resolve
// the same optimized React modules, including after a cold dependency rebuild.
import React from "react";
import { createRoot } from "react-dom/client";
export { React, createRoot };
