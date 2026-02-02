// Define the configurable parameters for the agent
import { Annotation, LangGraphRunnableConfig } from "@langchain/langgraph";
import { SYSTEM_PROMPT } from "./prompts.js";

export const ConfigurationAnnotation = Annotation.Root({
  userId: Annotation<string>(),
  model: Annotation<string>(),
  systemPrompt: Annotation<string>(),
});

export type Configuration = typeof ConfigurationAnnotation.State;

export function ensureConfiguration(config?: LangGraphRunnableConfig) {
  // console.log("📋 [Configuration] Starting configuration check...");
  // console.log("📋 [Configuration] Raw config received:", config);
  
  const configurable = config?.configurable || {};
  //  console.log("📋 [Configuration] Extracted configurable:", configurable);
  
  const finalConfig = {
    userId: configurable?.userId || "user_demo_test",
    model: configurable?.model || "claude-sonnet-4-5-20250929",
    systemPrompt: configurable?.systemPrompt || SYSTEM_PROMPT,
  };
  
  // console.log("✅ [Configuration] Final configuration:");
  // console.log("   - userId:", finalConfig.userId);
  // console.log("   - model:", finalConfig.model);
  // console.log("   - systemPrompt length:", finalConfig.systemPrompt.length, "characters");
  // console.log("   - Using defaults:", {
  //   userId: !configurable?.userId,
  //   model: !configurable?.model,
  //   systemPrompt: !configurable?.systemPrompt
  // });
  
  return finalConfig;
}