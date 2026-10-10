import { createFileRoute } from "@tanstack/react-router";

import { validateOutlineSearch } from "../data/tags";

// The outline zoomed into one bullet. Rendered by the root route's workbench,
// which projects its active tab onto this URL; see routes/index.tsx.
export const Route = createFileRoute("/$nodeId")({
  component: () => null,
  validateSearch: validateOutlineSearch,
});
