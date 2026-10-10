import { createRouter } from "@tanstack/react-router";

import { ErrorScreen } from "./components/error-screen";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    // A wide screen scrolls each workbench pane root, not the window
    // (docs/workbench/PLAN.md 2.3): a new navigation starts it at the top and
    // back/forward restores it, exactly as the window behaves.
    scrollToTopSelectors: ["[data-pane-scroll]"],
    defaultPreload: "intent",
    // A render error shows a humane screen and reports to Sentry (#227),
    // instead of a white page.
    defaultErrorComponent: ErrorScreen,
  });

  return router;
}
