import { createFileRoute } from "@tanstack/react-router";

import { validateOutlineSearch } from "../data/tags";
import { Workbench } from "../workbench/Workbench";

export const Route = createFileRoute("/")({
  component: HomePage,
  validateSearch: validateOutlineSearch,
});

function HomePage() {
  return <Workbench rootId={null} />;
}
