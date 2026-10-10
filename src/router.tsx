import { createRouter } from "@tanstack/react-router";

import { ErrorScreen } from "./components/error-screen";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createRouter({
    routeTree,
    // Window scrolling only: a wide screen scrolls each workbench pane, and
    // the workbench restores those per tab view (docs/workbench/PLAN.md 2.3).
    scrollRestoration: true,
    defaultPreload: "intent",
    // A render error shows a humane screen and reports to Sentry (#227),
    // instead of a white page.
    defaultErrorComponent: ErrorScreen,
  });

  return router;
}
