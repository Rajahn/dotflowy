import { createFileRoute } from "@tanstack/react-router";

import { validateOutlineSearch } from "../data/tags";

// The outline at the top level. The root route renders the workbench for this
// route and `/$nodeId` and keeps it mounted across both (its view comes from
// the active tab, not the route); the route itself renders nothing.
export const Route = createFileRoute("/")({
  component: () => null,
  validateSearch: validateOutlineSearch,
});
