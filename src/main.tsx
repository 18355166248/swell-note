import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import App from "./App";
import { registerServiceWorker } from "@/services/pwa/register";

if (import.meta.env.PROD) registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <AppErrorBoundary>
        <TooltipProvider delayDuration={400}>
          <App />
        </TooltipProvider>
      </AppErrorBoundary>
    </HashRouter>
  </React.StrictMode>,
);
