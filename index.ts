// index.ts - Cleaned version without logs
import "dotenv/config";
import { graph } from "./src/memory_agent/graph.js";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";

const STORE_DIR = "./.langgraph_api";
const STORE_FILE = path.join(STORE_DIR, ".langgraph_api/.langgraphjs_api.store.json");

if (!fs.existsSync(STORE_DIR)) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

async function loadStoreFromFile(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  
  if (fs.existsSync(STORE_FILE)) {
    try {
      const fileData = fs.readFileSync(STORE_FILE, "utf-8");
      const parsed = JSON.parse(fileData);
      
      if (parsed.json?.data) {
        for (const [namespaceStr, items] of parsed.json.data) {
          for (const [key, item] of items as any) {
            await store.put(item.namespace, item.key, item.value);
          }
        }
      }
    } catch (error) {
      // Silently fail and start fresh
    }
  }
  return store;
}

async function saveStoreToFile(store: InMemoryStore, userId: string) {
  try {
    const allData: any[] = [];
    
    try {
      const bookingResults = await store.search(["booking", userId], { limit: 100 });
      if (bookingResults.length > 0) {
        const bookingItems = bookingResults.map(r => [r.key, {
          value: r.value,
          key: r.key,
          namespace: ["booking", userId],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }]);
        allData.push([`booking:${userId}`, bookingItems]);
      }
    } catch (e) {}
    
    try {
      const memoryResults = await store.search(["memories", userId], { limit: 100 });
      if (memoryResults.length > 0) {
        const memoryItems = memoryResults.map(r => [r.key, {
          value: r.value,
          key: r.key,
          namespace: ["memories", userId],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }]);
        allData.push([`memories:${userId}`, memoryItems]);
      }
    } catch (e) {}
    
    const storeData = { json: { data: allData, vectors: [] } };
    fs.writeFileSync(STORE_FILE, JSON.stringify(storeData), "utf-8");
  } catch (error) {}
}

const store = await loadStoreFromFile();
const checkpointer = new MemorySaver();
const userId = "user_demo_test";

const config: any = {
  configurable: {
    thread_id: userId,
    userId: userId,
    model: "claude-sonnet-4-5-20250929",
  },
  store: store,
};

let conversationState: any = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function loadProgress() {
  try {
    const results = await store.search(["booking", userId], { limit: 1 });
    if (results && results.length > 0) {
      const savedProgress = results[0].value;
      return {
        messages: [],
        userInput: "",
        bookingProgress: {
          completedSteps: savedProgress.completedSteps || [],
          ...savedProgress.data,
        },
        availableLocations: savedProgress.availableLocations || [],
        availablePlans: savedProgress.availablePlans || [],
      };
    }
  } catch (error) {}
  
  return {
    messages: [],
    userInput: "",
    bookingProgress: { completedSteps: [] },
    availableLocations: [],
    availablePlans: [],
  };
}

async function chat(userInput: string) {
  const input = userInput.toLowerCase();
  
  if (input === "exit") {
    await saveStoreToFile(store, userId);
    rl.close();
    process.exit(0);
  }

  if (input === "restart") {
    try {
      const results = await store.search(["booking", userId], { limit: 10 });
      for (const result of results) {
        await store.delete(["booking", userId], result.key);
      }
      if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
    } catch (error) {}
    
    conversationState = {
      messages: [],
      userInput: "",
      bookingProgress: { completedSteps: [] },
      availableLocations: [],
      availablePlans: [],
    };
    
    await runGraph(conversationState, userInput);
    return;
  }

  if (!conversationState.messages) conversationState.messages = [];
  conversationState.messages.push(new HumanMessage({ content: userInput }));
  conversationState.userInput = userInput;
  
  await runGraph(conversationState, userInput);
}

async function runGraph(state: any, userInput: string) {
  try {
    const stream = await graph.stream(
      { ...state, userInput },
      { ...config, checkpointer }
    );

    let lastState = state;
    
    for await (const event of stream as any) {
      const nodeKey = Object.keys(event)[0];
      if (nodeKey && event[nodeKey]) {
        lastState = { ...lastState, ...event[nodeKey] };
        
        if (event[nodeKey].messages) {
          for (const msg of event[nodeKey].messages) {
            if (msg.constructor.name === "AIMessage") {
              process.stdout.write(`\n🤖 Assistant:\n${msg.content}\n`);
            }
          }
        }
      }
    }
    
    conversationState = lastState;
    await saveStoreToFile(store, userId);
  } catch (error: any) {
    if (error.message?.includes("interrupt") || error.name === "GraphInterrupt") {
      // Debug: log the entire error to see its structure
      console.log("🔍 Interrupt error structure:", JSON.stringify(error, null, 2));
      
      // Try different possible locations for the message
      const interruptMessage = error.value?.message || error.message || error.value;
      
      if (interruptMessage && typeof interruptMessage === 'string' && interruptMessage !== 'interrupt') {
        process.stdout.write(`\n🤖 Assistant:\n${interruptMessage}\n`);
      }
      conversationState.userInput = "";
    }
  }
}

function prompt() {
  rl.question("\n👤 You: ", async (input) => {
    if (input.trim()) {
      await chat(input.trim());
    }
    prompt();
  });
}

(async () => {
  conversationState = await loadProgress();
  const initialInput = (conversationState.bookingProgress?.completedSteps?.length > 0) ? "" : "start";
  await runGraph(conversationState, initialInput);
  prompt();
})();