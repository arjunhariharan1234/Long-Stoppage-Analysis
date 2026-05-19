import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import { ZeptoApp } from "./zepto/ZeptoApp";
import "./index.css";
// FT Design System styles. Package exports map points to ./dist/styles.css but the file
// actually lives at dist/dist/styles.css, so we import via the real path.
import "../node_modules/ft-design-system/dist/dist/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Routes>
        <Route path="/" element={<ZeptoApp />} />
        <Route path="/zepto" element={<ZeptoApp />} />
        <Route path="/jsw" element={<App />} />
        <Route path="*" element={<ZeptoApp />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
