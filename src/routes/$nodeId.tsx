import { createFileRoute } from "@tanstack/react-router";

import { validateOutlineSearch } from "../data/tags";
import { Workbench } from "../workbench/Workbench";

export const Route = createFileRoute("/$nodeId")({
  component: ZoomedPage,
  validateSearch: validateOutlineSearch,
});

function ZoomedPage() {
  const { nodeId } = Route.useParams();
  return <Workbench rootId={nodeId} />;
}
