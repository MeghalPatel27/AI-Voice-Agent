/**
 * Compatibility surface for Hume custom tools.
 * Canonical dispatcher: humeToolDispatcher.service.ts
 */
export { dispatchHumeToolCall as handleHumeToolCall } from "./humeToolDispatcher.service";
export {
  deliverStoredToolResult,
  resolveCallForTool,
} from "./humeToolDispatcher.service";
