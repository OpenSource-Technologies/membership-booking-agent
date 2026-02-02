import { LangGraphRunnableConfig } from "@langchain/langgraph";
import { ensureConfiguration } from "./configuration.js";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getStoreFromConfigOrThrow } from "./utils.js";

/**
 * Initialize tools for membership booking
 */
export function initializeBookingTools(config?: LangGraphRunnableConfig) {
  
  /**
   * Save booking progress to database
   */
  async function saveBookingProgress(opts: {
    step: string;
    data?: Record<string, any>;
  }): Promise<string> {
    // console.log("\n💾 [saveBookingProgress] Saving progress...");
    // console.log("   Step:", opts.step);
    // console.log("   Data:", opts.data);

    const { step, data } = opts;
    
    if (!config || !config.store) {
      throw new Error("Config or store not provided");
    }

    const configurable = ensureConfiguration(config);
    const store = getStoreFromConfigOrThrow(config);

    // Fetch existing progress
    let progress: any = { completedSteps: [], data: {} };
    try {
      const existing = await store.get(["booking", configurable.userId], "progress");
      if (existing?.value) {
        progress = existing.value;
        console.log("   Found existing progress:", progress);
      }
    } catch (error) {
      console.log("   No existing progress, creating new");
    }

    // Add step to completed steps (avoid duplicates)
    if (!progress.completedSteps.includes(step)) {
      progress.completedSteps.push(step);
    }

    // Merge new data
    progress.data = { ...progress.data, ...data };
    progress.lastUpdated = new Date().toISOString();

    // Save to database
    await store.put(["booking", configurable.userId], "progress", progress);

    // console.log("✅ [saveBookingProgress] Progress saved successfully");
    // console.log("   Completed steps:", progress.completedSteps);
    
    return `Booking progress saved: ${step}`;
  }

  /**
   * Clear booking progress (start over)
   */
  async function clearBookingProgress(): Promise<string> {
    console.log("\n🗑️  [clearBookingProgress] Clearing progress...");
    
    if (!config || !config.store) {
      throw new Error("Config or store not provided");
    }

    const configurable = ensureConfiguration(config);
    const store = getStoreFromConfigOrThrow(config);

    try {
      await store.delete(["booking", configurable.userId], "progress");
      console.log("✅ [clearBookingProgress] Progress cleared");
      return "Booking progress cleared. Starting fresh!";
    } catch (error) {
      console.log("❌ [clearBookingProgress] Error:", error);
      return "Progress cleared.";
    }
  }

  const saveProgressTool = tool(saveBookingProgress, {
    name: "saveBookingProgress",
    description: "Save the current booking progress so the user can resume later. Call this after each major step is completed.",
    schema: z.object({
      step: z.string().describe("Step name (e.g., 'selectLocation', 'selectPlan', 'collectClientInfo')"),
      data: z.record(z.any()).optional().describe("Additional data to save (locationId, planId, etc.)"),
    }),
  });

  const clearProgressTool = tool(clearBookingProgress, {
    name: "clearBookingProgress",
    description: "Clear all booking progress and start over. Use when user explicitly wants to restart the booking process.",
    schema: z.object({}),
  });

  return [saveProgressTool, clearProgressTool];
}