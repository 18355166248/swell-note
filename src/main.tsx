import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { DesktopAppFrame } from "@/components/desktop/desktop-app-frame";
import App from "./App";
import { registerServiceWorker } from "@/services/pwa/register";
import { preloadNoteRenderers } from "@/lib/preload-note-renderers";

if (import.meta.env.PROD) registerServiceWorker();
// 趁 vault 初始化（读本地缓存、连远端）还在跑的时候把编辑器等大 chunk 的请求提前发出去。
preloadNoteRenderers();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <AppErrorBoundary>
        <TooltipProvider delayDuration={400}>
          <DesktopAppFrame>
            <App />
          </DesktopAppFrame>
        </TooltipProvider>
      </AppErrorBoundary>
    </HashRouter>
  </React.StrictMode>,
);
