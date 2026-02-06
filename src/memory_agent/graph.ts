import {
  LangGraphRunnableConfig,
  START,
  StateGraph,
  END,
  interrupt,
  InMemoryStore,
  MemorySaver,
} from "@langchain/langgraph";
import type { HumanInterrupt, HumanResponse } from "@langchain/langgraph/prebuilt";
import { BaseMessage, AIMessage, HumanMessage } from "@langchain/core/messages";
import { initChatModel } from "langchain/chat_models/universal";
import { StateAnnotation } from "./state.js";
import {
  ConfigurationAnnotation,
  ensureConfiguration,
} from "./configuration.js";
import { getStoreFromConfigOrThrow } from "./utils.js";
import fetch from "cross-fetch";
import * as crypto from "crypto";
import express from "express";
import cors from "cors";
import type { Request, Response } from "express";

// Initialize the language model
const checkpointer = new MemorySaver();
const memorySTore = new InMemoryStore();
const userId = "user_demo_test";

// ⭐ Load persisted store data from file
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadStoreFromFile() {
  // Try multiple possible locations for the store file
  
  const searchPaths = [
    path.join(process.cwd(), '.langgraph_api', '.langgraphjs_api.store.json'),
    path.join(__dirname, '.langgraph_api', '.langgraphjs_api.store.json'),
    path.join(__dirname, '..', '.langgraph_api', '.langgraphjs_api.store.json'),
    path.join(__dirname, '../..', '.langgraph_api', '.langgraphjs_api.store.json'),
  ];

  


  console.log("🔍 [loadStoreFromFile] Searching for store file...");
  console.log("   Current working directory:", process.cwd());
  console.log("   __dirname:", __dirname);
  
  let storePath: string | null = null;
  
  for (const tryPath of searchPaths) {
    console.log(`   Trying: ${tryPath}`);
    if (fs.existsSync(tryPath)) {
      storePath = tryPath;
      console.log(`   ✅ Found at: ${tryPath}`);
      break;
    }
  }
  
  if (!storePath) {
    console.log("ℹ️  [loadStoreFromFile] No .langgraphjs_api.store file found in any location");
    console.log("   Checked paths:", possiblePaths);
    return;
  }
  
  try {
    console.log("📂 [loadStoreFromFile] Reading .langgraphjs_api.store file from:", storePath);
    const fileContent = fs.readFileSync(storePath, 'utf-8');
    const storeData = JSON.parse(fileContent);
    
    console.log("📊 [loadStoreFromFile] Parsed store data");
    console.log("   Data structure:", Object.keys(storeData));
    
    // Load data into memorySTore
    if (storeData.json && storeData.json.data) {
      console.log("   Found", storeData.json.data.length, "namespaces");
      
      for (const [namespaceKey, items] of storeData.json.data) {
        console.log(`   - Loading namespace: ${namespaceKey}`);
        
        // Parse namespace (e.g., "booking:user_demo_test" -> ["booking", "user_demo_test"])
        const namespace = namespaceKey.split(':');
        
        for (const [key, itemData] of items) {
          console.log(`     - Loading key: ${key}`);
          await memorySTore.put(namespace, key, itemData.value);
        }
      }
      
      console.log("✅ [loadStoreFromFile] Store data loaded successfully!");
      
      // Verify the data was loaded
      const results = await memorySTore.search(["booking", userId], { limit: 1 });
      // console.log("✅ [loadStoreFromFile] Verification - found", results?.length || 0, "items for user_demo_test");
      
      if (results && results.length > 0) {
        // console.log("   Sample data:", JSON.stringify(results[0], null, 2));
      }
    } else {
      console.log("⚠️  [loadStoreFromFile] Store file has no data");
    }
  } catch (error) {
    console.error("❌ [loadStoreFromFile] Error loading store:", error);
  }
}

// Load store data immediately
await loadStoreFromFile();

// ⭐ Function to save store data back to file
async function saveStoreToFile() {
  const storePath = path.join(process.cwd(), '.langgraphjs_api.store');
  
  try {
    // Get all data from the store
    const allData: any[] = [];
    
    // Search for all booking data
    const results = await memorySTore.search(["booking"], { limit: 100 });
    
    if (results && results.length > 0) {
      // Group by namespace
      const namespaceMap = new Map();
      
      for (const result of results) {
        const namespaceKey = result.namespace.join(':');
        
        if (!namespaceMap.has(namespaceKey)) {
          namespaceMap.set(namespaceKey, []);
        }
        
        namespaceMap.get(namespaceKey).push([
          result.key,
          {
            value: result.value,
            key: result.key,
            namespace: result.namespace,
            createdAt: result.created_at || new Date().toISOString(),
            updatedAt: result.updated_at || new Date().toISOString()
          }
        ]);
      }
      
      // Convert to array format
      for (const [namespaceKey, items] of namespaceMap.entries()) {
        allData.push([namespaceKey, items]);
      }
    }
    
    // Create the store file structure
    const storeData = {
      json: {
        data: allData,
        vectors: []
      },
      meta: {
        values: {
          data: ["map", {"0.1": ["map", {"0.1.createdAt": ["Date"], "0.1.updatedAt": ["Date"]}]}],
          vectors: ["map"]
        },
        v: 1
      }
    };
    
    // Write to file
    fs.writeFileSync(storePath, JSON.stringify(storeData, null, 2), 'utf-8');
    console.log("✅ [saveStoreToFile] Store data saved to file");
  } catch (error) {
    console.error("❌ [saveStoreToFile] Error saving store:", error);
  }
}


import dotenv from 'dotenv';
import { SYSTEM_PROMPT } from "./prompts.js";
dotenv.config();


// ============================================================================
// BOULEVARD API CLIENT
// ============================================================================

const { URL_CLIENT, URL_ADMIN, BLVD_API_KEY, BLVD_BUSINESS_ID, BLVD_API_SECRET } = process.env;

async function generate_guest_auth_header(api_key: string) {
  const payload = `${api_key}:`;
  const http_basic_credentials = Buffer.from(payload, "utf8").toString("base64");
  return http_basic_credentials;
}

async function generate_admin_auth_header() {
  const prefix = "blvd-admin-v1";
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${prefix}${BLVD_BUSINESS_ID}${timestamp}`;
  
  if (!BLVD_API_SECRET) throw new Error("Missing BLVD_API_SECRET");
  if (!BLVD_API_KEY) throw new Error("Missing BLVD_API_KEY");
  if (!BLVD_BUSINESS_ID) throw new Error("Missing BLVD_BUSINESS_ID");
  
  const raw_key = Buffer.from(BLVD_API_SECRET, "base64");
  const signature = crypto
    .createHmac("sha256", raw_key)
    .update(payload, "utf8")
    .digest("base64");
  const token = `${signature}${payload}`;
  const http_basic_payload = `${BLVD_API_KEY}:${token}`;
  const http_basic_credentials = Buffer.from(http_basic_payload, "utf8").toString("base64");
  return http_basic_credentials;
}
async function gql(query: string, requestType: "CLIENT" | "ADMIN", variables = {}, timeoutMs = 8000) {
  console.log("🔧 [Boulevard API] Making request:", requestType);
  
  let API = '';
  let authenticationHeader = '';
  
  if (requestType === 'CLIENT') {
    if (!URL_CLIENT) throw new Error("Missing URL_CLIENT");
    if (!BLVD_API_KEY) throw new Error("Missing BLVD_API_KEY");
    API = URL_CLIENT;
    authenticationHeader = await generate_guest_auth_header(BLVD_API_KEY);
  } else if (requestType === 'ADMIN') {
    if (!URL_ADMIN) throw new Error("Missing URL_ADMIN");
    API = URL_ADMIN;
    authenticationHeader = await generate_admin_auth_header();
  }
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${authenticationHeader}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: controller.signal,
  });
  
  clearTimeout(timeout);

  
  const json = await res.json();
  
  if (json.errors?.length) {
    throw new Error(JSON.stringify(json.errors));
  }
  
  return json.data;
}
// GraphQL Queries (same as before)
const GQL_LOCATIONS = `{
  locations(first:20){
    edges{
      node{
        id
        businessName
        name
        address{
          city
          country
          line1
          state
        }
      }
    }
  }
}`;

const GQL_CREATE_CART = `mutation createCart($input:CreateCartInput!){
  createCart(input:$input){
    cart{
      id
      expiresAt
      summary{
        subtotal
        taxAmount
        total
      }
    }
  }
}`;

const GQL_AVAILABLE_SERVICES = `query membershipPlans {
  membershipPlans(first: 1000) {
    edges {
      node {
        id 
        name
        active 
        unitPrice
        description
        category {
          id
          name
        }
      }
    } 
  }
}`;

const GQL_ADD_SERVICE = `mutation addCartSelectedPurchasableItem($input:AddCartSelectedPurchasableItemInput!){
  addCartSelectedPurchasableItem(input:$input){
    cart {
      id
      selectedItems {
        id
      }
    }
  }
}`;

const GQL_APPLY_PROMO = `mutation addCartOffer($input:AddCartOfferInput!){
  addCartOffer(input:$input){
    offer{
      applied
      code
      id
      name
    }
    cart{
      id
      summary{
        discountAmount
        total
      }
    }
  }
}`;

const GQL_SET_CLIENT = `mutation updateCart($input:UpdateCartInput!){
  updateCart(input:$input){
    cart{
      id
      clientInformation{
        email
        firstName
        lastName
        phoneNumber
      }
    }
  }
}`;

const ADD_CART_CARD_PAYMENT_METHOD = `
mutation addCartCardPaymentMethod($input: AddCartCardPaymentMethodInput!) {
  addCartCardPaymentMethod(input: $input) {
    cart {
      id
      expiresAt
      availablePaymentMethods {
        id
        name
        ... on CartItemCardPaymentMethod {
          cardBrand
          cardExpMonth
          cardExpYear
          cardHolder
          cardIsDefault
          cardLast4
          id
          name
          __typename
        }
        ... on CartItemVoucherPaymentMethod {
          availableCount
          expiresOn
          id
          name
          __typename
        }
        __typename
      }
      summary {
        deposit
        depositAmount
        discountAmount
        gratuityAmount
        paymentMethodRequired
        roundingAmount
        subtotal
        taxAmount
        total
        __typename
      }
      clientInformation {
        email
        firstName
        lastName
        phoneNumber
        externalId
        __typename
      }
      __typename
    }
    __typename
  }
}
`;



const CHECKOUT_CART = `
mutation checkoutCart($id: ID!) {
  checkoutCart(input: { id: $id }) {
    appointments {
      appointmentId
      clientId
      __typename
    }
    cart {
      id
      completedAt
      selectedItems {
        id
        price
        item {
          id
          name
          __typename
        }
        __typename
      }
      summary {
        deposit
        depositAmount
        discountAmount
        gratuityAmount
        paymentMethodRequired
        roundingAmount
        subtotal
        taxAmount
        total
        __typename
      }
      clientInformation {
        email
        firstName
        lastName
        phoneNumber
        externalId
        __typename
      }
      location {
        id
        name
        tz
      }
    }
  }
}
`;

// ============================================================================
// BOULEVARD API WRAPPER FUNCTIONS
// ============================================================================

async function blvdGetLocations() {
  const data = await gql(GQL_LOCATIONS, 'CLIENT');
  return data?.locations?.edges?.map((e: any) => ({
    id: e?.node?.id,
    name: e?.node?.name || e?.node?.businessName,
    city: e?.node?.address?.city,
  })) || [];
}

async function blvdCreateCart(locationId: string) {
  const data = await gql(GQL_CREATE_CART, 'CLIENT', { 
    input: { locationId } 
  });
  return data?.createCart?.cart?.id;
}

async function blvdGetAvailableServices(cartId: string) {
  const data = await gql(GQL_AVAILABLE_SERVICES, 'ADMIN');
  return data?.membershipPlans?.edges?.map((e: any) => ({
    id: e?.node?.id,
    name: e?.node?.name,
    description: e?.node?.description,
    price: e?.node?.unitPrice,
    active: e?.node?.active,
    category: e?.node?.category?.name,
  })) || [];
}

async function blvdAddServiceToCart(cartId: string, itemId: string) {
  const data = await gql(GQL_ADD_SERVICE, 'CLIENT', {
    input: {
      id: cartId,
      itemId: itemId,
    }
  });
  return data;
}

async function blvdApplyPromoCode(cartId: string, offerCode: string) {
  const data = await gql(GQL_APPLY_PROMO, 'CLIENT', {
    input: {
      id: cartId,
      offerCode: offerCode,
    }
  });
  const applied = data?.addCartOffer?.offer?.applied || false;
  const total = data?.addCartOffer?.cart?.summary?.total;           // post-discount total (cents)
  const discountAmount = data?.addCartOffer?.cart?.summary?.discountAmount; // discount (cents)
  return { applied, total, discountAmount };
}

async function blvdSetClientOnCart(cartId: string, clientInfo: any) {
  const data = await gql(GQL_SET_CLIENT, 'CLIENT', {
    input: {
      id: cartId,
      clientInformation: {
        firstName: clientInfo.firstName,
        lastName: clientInfo.lastName,
        email: clientInfo.email,
        phoneNumber: clientInfo.phoneNumber,
      }
    }
  });
  return data;
}

async function blvdAddCartCardPaymentMethod(cartId: string, token: string, select: boolean = true) {
  const data = await gql(ADD_CART_CARD_PAYMENT_METHOD, 'CLIENT', {
    input: {
      id: cartId,
      token: token,
      select: select,
    }
  });
  return data;
}

async function blvdCheckoutCart(cartId: string) {
  const data = await gql(CHECKOUT_CART, 'CLIENT', { 
    id: cartId 
  });
  return data;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function extractLocationFromMessage(message: BaseMessage, locations: any[]): any | null {
  if (!message || !message.content) return null;
  const content = message.content.toString().toLowerCase();
  
  // Try number match
  const numberMatch = content.match(/\b(\d+)\b/);
  if (numberMatch) {
    const index = parseInt(numberMatch[1]) - 1;
    if (index >= 0 && index < locations.length) {
      return locations[index];
    }
  }
  
  // Try name match
  for (const location of locations) {
    const locationName = location.name.toLowerCase();
    const words = content.split(/\s+/);
    for (const word of words) {
      if (locationName.includes(word) || word.includes(locationName.split(' ')[0].toLowerCase())) {
        return location;
      }
    }
  }
  
  return null;
}

function extractPlanFromMessage(message: BaseMessage, plans: any[]): any | null {
  if (!message || !message.content) return null;
  const content = message.content.toString().toLowerCase();
  
  // Try number match
  const numberMatch = content.match(/\b(\d+)\b/);
  if (numberMatch) {
    const index = parseInt(numberMatch[1]) - 1;
    if (index >= 0 && index < plans.length) {
      return plans[index];
    }
  }
  
  // Try name match
  for (const plan of plans) {
    const planName = plan.name.toLowerCase();
    const words = content.split(/\s+/);
    for (const word of words) {
      if (planName.includes(word) || word.includes(planName.split(' ')[0].toLowerCase())) {
        return plan;
      }
    }
  }
  
  return null;
}

function extractClientInfoFromMessages(messages: BaseMessage[]): {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
} {
  const info: any = {};

  for (let i = messages.length - 1; i >= Math.max(0, messages.length - 10); i--) {
    const msg = messages[i];
    if (msg.constructor.name !== "HumanMessage") continue;

    const content = msg.content.toString();

    if (!info.email) {
      const emailMatch = content.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
      if (emailMatch) info.email = emailMatch[0];
    }

    if (!info.phoneNumber) {
      const phoneMatch = content.match(/\b(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/);
      if (phoneMatch) info.phoneNumber = phoneMatch[0].replace(/\D/g, "");
    }

    if (!info.firstName || !info.lastName) {
      let nameMatch = content.match(/(?:name is|i'm|i am|call me)\s+([A-Za-z]+)(?:\s+([A-Za-z]+))?/i);
      if (!nameMatch) nameMatch = content.match(/^([A-Za-z]+)\s+([A-Za-z]+)/);
      if (!nameMatch) {
        const cleanContent = content
          .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '')
          .replace(/\b(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '');
        nameMatch = cleanContent.match(/\b([A-Za-z]+)\s+([A-Za-z]+)\b/);
      }
      if (nameMatch) {
        info.firstName = info.firstName || nameMatch[1];
        info.lastName = info.lastName || nameMatch[2];
      }
    }
  }

  return info;
}

// ============================================================================
// SAVE/LOAD PROGRESS
// ============================================================================

function getBookingNamespace(config: LangGraphRunnableConfig): string[] {
  const configurable = ensureConfiguration(config);
  const userId = configurable.userId || "default";
  const threadId = config.configurable?.thread_id || "default";
  return ["booking", userId, threadId];
}

function getInterruptText(
  response:
    | HumanResponse
    | string
    | Array<HumanResponse | string>
    | null
    | undefined,
): string {
  if (!response) return "";
  const first = Array.isArray(response) ? response[0] : response;
  if (!first) return "";
  if (typeof first === "string") return first;
  if (first.type === "response") {
    if (typeof first.args === "string") return first.args;
    if (first.args && typeof first.args === "object") {
      const args = first.args as Record<string, unknown>;
      if (typeof args.value === "string") return args.value;
    }
  }
  return "";
}

async function saveProgress(
  config: LangGraphRunnableConfig,
  step: string,
  data: Record<string, any>,
  state?: typeof StateAnnotation.State,
): Promise<void> {
  console.log(`\n💾 [saveProgress] Saving step: ${step}`);
  console.log(`🔍 [saveProgress] Data being saved:`, data);

  const store = getStoreFromConfigOrThrow(config);
  const configurable = ensureConfiguration(config);





  let existingProgress: any = { completedSteps: [], data: {}, messages: [] };
  try {
    const results = await store.search(getBookingNamespace(config), { limit: 1 });
    if (results && results.length > 0) {
      existingProgress = results[0].value;
    }
  } catch (error) {
    // No existing progress
  }

  const completedSteps = new Set(existingProgress.completedSteps || []);
  completedSteps.add(step);

  const messagesToSave = state?.messages?.slice(-10).map(msg => ({
    type: msg.constructor.name,
    content: msg.content,
  })) || existingProgress.messages || [];

  const mergedData = { ...existingProgress.data, ...data };
  
  if (data.clientInfo || existingProgress.data?.clientInfo) {
    mergedData.clientInfo = {
      ...(existingProgress.data?.clientInfo || {}),
      ...(data.clientInfo || {}),
    };
  }
  
  console.log(`🔍 [saveProgress] Merged data (including clientInfo):`, mergedData);

  const progressData = {
    completedSteps: Array.from(completedSteps),
    data: mergedData,
    messages: messagesToSave,
    availableLocations: state?.availableLocations || existingProgress.availableLocations || [],
    availablePlans: state?.availablePlans || existingProgress.availablePlans || [],
    lastUpdated: new Date().toISOString(),
  };

  const namespace = getBookingNamespace(config);
  await store.put(namespace, "progress", progressData);
  console.log("✅ [saveProgress] Saved:", progressData.completedSteps);

  const verification = await store.get(namespace, "progress");
console.log("✅ [saveProgress] Verified stored value:", verification);

}

async function loadSavedProgress(
  state: typeof StateAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof StateAnnotation.State>> {
  console.log("\n📂 [loadSavedProgress] Loading progress...");
  
  const store = getStoreFromConfigOrThrow(config);
  const configurable = ensureConfiguration(config);

  // ⭐ Extract user input from the latest message
  let userInput = "";
  if (state.messages && state.messages.length > 0) {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage && typeof lastMessage.content === 'string') {
      const content = lastMessage.content.trim();
   

      if (userInput !== "check_booking_status_internal") {
        userInput = content;
      }
    }
  }
  console.log("📝 [loadSavedProgress] Extracted userInput:", userInput ? `"${userInput}"` : "(empty)");

  try {
    const results = await store.search(getBookingNamespace(config), { limit: 1 });

    if (results && results.length > 0) {
      const progress = results[0].value;
      console.log("✅ [loadSavedProgress] Found:", progress.completedSteps);
      console.log("🔍 [loadSavedProgress] progress.data:", progress.data);
      console.log("🔍 [loadSavedProgress] progress.data.clientInfo:", progress.data?.clientInfo);

      // CRITICAL FIX: Explicitly set all fields including clientInfo
      const bookingProgress: any = {
        completedSteps: progress.completedSteps || [],
        selectedLocationId: progress.data?.selectedLocationId,
        selectedLocationName: progress.data?.selectedLocationName,
        cartId: progress.data?.cartId,
        selectedPlanId: progress.data?.selectedPlanId,
        selectedPlanName: progress.data?.selectedPlanName,
        promoCode: progress.data?.promoCode,
        promoSkipped: progress.data?.promoSkipped,
      };

      // ⭐ CRITICAL FIX: Always include clientInfo, even if empty
      // This ensures the state has the clientInfo object structure
      bookingProgress.clientInfo = progress.data?.clientInfo || {};
      console.log("✅ [loadSavedProgress] Restored clientInfo:", bookingProgress.clientInfo);
      
      // ⭐ CHECK FOR STORED CARD TOKEN
      const threadId = config.configurable?.thread_id || 'default';
      const storedToken = await getStoredToken(configurable.userId, threadId);
      
      if (storedToken) {
        console.log("💳 [loadSavedProgress] Found stored card token!");
        bookingProgress.cardToken = storedToken;
      } else {
        console.log("ℹ️  [loadSavedProgress] No stored card token found");
        bookingProgress.cardToken = progress.data?.cardToken || '';
      }

      return {
        bookingProgress,
        availableLocations: progress.availableLocations || [],
        availablePlans: progress.availablePlans || [],
        userInput: userInput,
      };
    }
  } catch (error) {
    console.log("🔭 [loadSavedProgress] No saved progress");
  }

  return { 
    bookingProgress: { 
      cardToken: '',
      completedSteps: [],
      clientInfo: {}  // ⭐ Always initialize with empty clientInfo object
    },
    userInput: userInput,
  };
}

// ============================================================================
// NODES WITH INTERRUPT PATTERN
// ============================================================================

async function getLocations(
  state: typeof StateAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof StateAnnotation.State>> {
  // console.log("\n🏢 [getLocations] Fetching locations from API...");

  try {
    const locations = await blvdGetLocations();
    // console.log("✅ [getLocations] Fetched", locations.length, "locations");

    const locationsList = locations
      .map((loc: any, i: number) => `${i + 1}. ${loc.name}${loc.city ? ` - ${loc.city}` : ''}`)
      .join("\n");

    const message = `Here are our available locations:\n\n${locationsList}\n\nWhich location would you prefer? (Enter number or name)`;

    const updatedState = {
      ...state,
      availableLocations: locations,
      messages: [...state.messages, new AIMessage({ content: message })],
    };

    await saveProgress(config, "getLocations", {}, updatedState);

    return {
      availableLocations: locations,
      bookingProgress: {
        ...state.bookingProgress,
        completedSteps: [...(state.bookingProgress?.completedSteps || []), "getLocations"],
      },
      messages: [new AIMessage({ content: message })],
    };
  } catch (error) {
    console.error("❌ [getLocations] API Error:", error);
    return {
      messages: [new AIMessage({ content: "I'm having trouble fetching locations. Please try again." })],
    };
  }
}
async function selectLocation(
  state: typeof StateAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof StateAnnotation.State>> {
  let userInput = state.userInput;

  if (!userInput) {
    const prompt: HumanInterrupt = {
      action_request: { action: "select_location", args: {} },
      config: {
        allow_respond: true,
        allow_ignore: false,
        allow_accept: false,
        allow_edit: false,
      },
      description: "Please select a location:",
    };
    const response = interrupt([prompt]) as
      | Array<HumanResponse | string>
      | HumanResponse
      | string
      | null;
    userInput = getInterruptText(response);
  }

  const selectedLocation = extractLocationFromMessage(
    new HumanMessage({ content: userInput }),
    state.availableLocations || []
  );

  if (!selectedLocation) {
    const errorMessage = `❌ Invalid selection "${userInput}". Please choose by number or name:`;
    
    return {
      messages: [
        new HumanMessage({ content: userInput }), // Send user input to frontend
        new AIMessage({ content: errorMessage })
      ],
      userInput: "",
    };
  }

  await saveProgress(config, "selectLocation", {
    selectedLocationId: selectedLocation.id,
    selectedLocationName: selectedLocation.name,
  }, state);

  return {
    bookingProgress: {
      ...state.bookingProgress,
      completedSteps: [...(state.bookingProgress?.completedSteps || []), "selectLocation"],
      selectedLocationId: selectedLocation.id,
      selectedLocationName: selectedLocation.name,
    },
    messages: [
      new HumanMessage({ content: userInput }), // Send user input to frontend
      new AIMessage({ content: `Perfect! You've selected ${selectedLocation.name}.` })
    ],
    userInput: "",
  };
}
async function createCart(
  state: typeof StateAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof StateAnnotation.State>> {
  console.log("\n🛒 [createCart] Creating cart via API...");

  try {
    const locationId = state.bookingProgress?.selectedLocationId;
    if (!locationId) throw new Error("No location selected");

    const cartId = await blvdCreateCart(locationId);
    if (!cartId) throw new Error("Failed to create cart");

    console.log("✅ [createCart] Cart created:", cartId);
    await saveProgress(config, "createCart", { cartId }, state);

    return {
      bookingProgress: {
        ...state.bookingProgress,
        completedSteps: [...(state.bookingProgress?.completedSteps || []), "createCart"],
        cartId: cartId,
      },
      messages: [new AIMessage({ content: "Cart created! Loading membership plans..." })],
    };
  } catch (error) {
    console.error("❌ [createCart] Error:", error);
    return {
      messages: [new AIMessage({ content: "Error creating cart. Please try again." })],
    };
  }
}

async function getMembershipPlans(
  state: typeof StateAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof StateAnnotation.State>> {
  console.log("\n📋 [getMembershipPlans] Fetching plans...");

  try {
    const plans = await blvdGetAvailableServices("");
    console.log("✅ [getMembershipPlans] Fetched", plans.length, "plans");

    const plansList = plans
      .map((plan: any, i: number) => {
        let info = `${i + 1}. ${plan.name}`;
        if (plan.price) info += ` - ${plan.price}`;
        if (plan.description) info += `\n   ${plan.description}`;
        return info;
      })
      .join("\n\n");

    const message = `Here are our membership plans:\n\n${plansList}\n\nWhich plan interests you?`;

    const updatedState = {
      ...state,
      availablePlans: plans,
      messages: [...state.messages, new AIMessage({ content: message })],
    };

    await saveProgress(config, "getMembershipPlans", {}, updatedState);

    return {
      availablePlans: plans,
      bookingProgress: {
        ...state.bookingProgress,
        completedSteps: [...(state.bookingProgress?.completedSteps || []), "getMembershipPlans"],
      },
      messages: [new AIMessage({ content: message })],
    };
  } catch (error) {
    console.error("❌ [getMembershipPlans] Error:", error);
    return {
      messages: [new AIMessage({ content: "Error fetching plans. Please try again." })],
    };
  }
}
async function selectPlan(
  state: typeof StateAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof StateAnnotation.State>> {
  console.log("\n🔹 [selectPlan] Processing selection...");

  let userInput = state.userInput;

  if (!userInput) {
    const prompt: HumanInterrupt = {
      action_request: { action: "select_plan", args: {} },
      config: {
        allow_respond: true,
        allow_ignore: false,
        allow_accept: false,
        allow_edit: false,
      },
      description: "Please select a plan:",
    };
    const response = interrupt([prompt]) as
      | Array<HumanResponse | string>
      | HumanResponse
      | string
      | null;
    userInput = getInterruptText(response);
  }

  console.log(`   📥 Processing: "${userInput}"`);

  const selectedPlan = extractPlanFromMessage(
    new HumanMessage({ content: userInput }),
    state.availablePlans || []
  );

  if (!selectedPlan) {
    console.log("   ❌ Invalid selection - asking again...");
    const errorMessage = `❌ Invalid selection "${userInput}". Please choose by number or name:`;
    
    return {
      messages: [
        new HumanMessage({ content: userInput }), // Send user input to frontend
        new AIMessage({ content: errorMessage })
      ],
      userInput: "",
    };
  }

  console.log("   ✅ Selected:", selectedPlan.name);

  await saveProgress(config, "selectPlan", {
    selectedPlanId: selectedPlan.id,
    selectedPlanName: selectedPlan.name,
    selectedPlanPrice: selectedPlan.price, 
  }, state);

  return {
    bookingProgress: {
      ...state.bookingProgress,
      completedSteps: [...(state.bookingProgress?.completedSteps || []), "selectPlan"],
      selectedPlanId: selectedPlan.id,
      selectedPlanName: selectedPlan.name,
      selectedPlanPrice: selectedPlan.price, 
    },
    messages: [
      new HumanMessage({ content: userInput }), // Send user input to frontend
      new AIMessage({ content: `Excellent! You've selected ${selectedPlan.name}.` })
    ],
    userInput: "",
  };
}

async function addMembershipToCart(
  state: typeof StateAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof StateAnnotation.State>> {
  console.log("\n➕ [addMembershipToCart] Adding to cart...");

  try {
    const cartId = state.bookingProgress?.cartId;
    const serviceId = state.bookingProgress?.selectedPlanId;

    if (!cartId || !serviceId) throw new Error("Missing cart or service ID");

    await blvdAddServiceToCart(cartId, serviceId);
    console.log("✅ [addMembershipToCart] Added to cart");

    await saveProgress(config, "addMembershipToCart", {}, state);

    return {
      bookingProgress: {
        ...state.bookingProgress,
        completedSteps: [...(state.bookingProgress?.completedSteps || []), "addMembershipToCart"],
      },
      messages: [new AIMessage({
        content: `${state.bookingProgress?.selectedPlanName} added to cart!\n\nDo you have a promo code? (yes/no or enter code)`
      })],
    };
  } catch (error) {
    console.error("❌ [addMembershipToCart] Error:", error);
    return {
      messages: [new AIMessage({ content: "Error adding to cart. Please try again." })],
    };
  }
}


async function applyPromotionCode(
  state: typeof StateAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof StateAnnotation.State>> {
  console.log("\n🎟️  [applyPromotionCode] Processing...");

  let userInput = state.userInput?.trim();

  // Track if we're asking for the code itself (vs initial yes/no)
  const isAskingForCode = state.bookingProgress?.promoCodeState === "asking_for_code";
  const isRetryingCode = state.bookingProgress?.promoCodeState === "retrying_code";

  if (!userInput) {
    console.log("   ⏸️  No input yet - triggering interrupt...");
    let promptMessage: string;
    
    if (isRetryingCode) {
      promptMessage = "Would you like to try another promo code? (yes/no)";
    } else if (isAskingForCode) {
      promptMessage = "Please enter your promo code:";
    } else {
      promptMessage = "Do you have a promo code? (yes/no)";
    }
    
    const prompt: HumanInterrupt = {
      action_request: { action: "promo_code_input", args: {} },
      config: {
        allow_respond: true,
        allow_ignore: false,
        allow_accept: false,
        allow_edit: false,
      },
      description: promptMessage,
    };
    
    const response = interrupt([prompt]) as
      | Array<HumanResponse | string>
      | HumanResponse
      | string
      | null;
    
    console.log("   ▶️  Resumed with:", response);
    userInput = getInterruptText(response);
  }

  console.log(`   📥 Processing promo input: "${userInput}"`);
  const lower = (userInput || "").toLowerCase();

  // ============================================================
  // SCENARIO 1: Initial question - user says "yes" or "no"
  // ============================================================
  if (!isAskingForCode && !isRetryingCode) {
    if (lower === "yes" || lower === "y") {
      console.log("   ✅ User wants to enter a promo code - asking for it now...");
      
      return {
        bookingProgress: {
          ...state.bookingProgress,
          promoCodeState: "asking_for_code",
        },
        messages: [
          new HumanMessage({ content: userInput }), // Send user input to frontend
          new AIMessage({ content: "Great! Please enter your promo code:" })
        ],
        userInput: "",
      };
    }
    
    if (lower === "no" || lower === "n" || lower === "skip") {
      console.log("   ⏭️  User doesn't want to use a promo code");
      await saveProgress(config, "applyPromotionCode", { promoSkipped: true }, state);

      return {
        bookingProgress: {
          ...state.bookingProgress,
          completedSteps: [...(state.bookingProgress?.completedSteps || []), "applyPromotionCode"],
          promoSkipped: true,
          promoCodeState: undefined,
        },
        messages: [
          new HumanMessage({ content: userInput }), // Send user input to frontend
          new AIMessage({
            content: "No promo code applied.\n\nNow I need some information to complete your booking. \n\nPlease Enter your First Name ,Last Name, Email and Phone"
          })
        ],
        userInput: "",
      };
    }
    
    // If user entered something else (maybe a promo code directly), treat it as a code
    console.log("   🎟️  User entered something other than yes/no - treating as promo code");
    // Fall through to code application below
  }
  
  // ============================================================
  // SCENARIO 2: User said they want to retry after invalid code
  // ============================================================
  if (isRetryingCode) {
    if (lower === "yes" || lower === "y") {
      console.log("   🔄 User wants to try another code - asking for it...");
      
      return {
        bookingProgress: {
          ...state.bookingProgress,
          promoCodeState: "asking_for_code",
        },
        messages: [
          new HumanMessage({ content: userInput }), // Send user input to frontend
          new AIMessage({ content: "Please enter your promo code:" })
        ],
        userInput: "",
      };
    }
    
    if (lower === "no" || lower === "n") {
      console.log("   ⏭️  User doesn't want to retry - continuing without promo");
      await saveProgress(config, "applyPromotionCode", { promoSkipped: true }, state);

      return {
        bookingProgress: {
          ...state.bookingProgress,
          completedSteps: [...(state.bookingProgress?.completedSteps || []), "applyPromotionCode"],
          promoSkipped: true,
          promoCodeState: undefined,
        },
        messages: [
          new HumanMessage({ content: userInput }), // Send user input to frontend
          new AIMessage({
            content: "No promo code applied.\n\nNow I need some information to complete your booking. \n\nPlease Enter your First Name ,Last Name, Email and Phone"
          })
        ],
        userInput: "",
      };
    }
  }

  // ============================================================
  // SCENARIO 3: Apply the promo code the user entered
  // ============================================================
  const promoCode = userInput;
  const cartId = state.bookingProgress?.cartId;

  if (!cartId) {
    console.error("   ❌ No cartId available for promo application");
    await saveProgress(config, "applyPromotionCode", { promoSkipped: true }, state);
    
    return {
      bookingProgress: {
        ...state.bookingProgress,
        completedSteps: [...(state.bookingProgress?.completedSteps || []), "applyPromotionCode"],
        promoSkipped: true,
        promoCodeState: undefined,
      },
      messages: [
        new HumanMessage({ content: userInput }), // Send user input to frontend
        new AIMessage({
          content: "Couldn't apply the promo code (cart not found). Moving on.\n\nNow I need some information to complete your booking. \n\nPlease Enter your First Name ,Last Name, Email and Phone"
        })
      ],
      userInput: "",
    };
  }

  try {
    console.log(`   🎟️  Applying promo code "${promoCode}" to cart ${cartId}...`);
    const { applied, total, discountAmount } = await blvdApplyPromoCode(cartId, promoCode);

    console.log("   Boulevard response — applied:", applied, "| total:", total, "| discountAmount:", discountAmount);

    if (applied) {
      console.log("   ✅ Promo code applied successfully!");
      await saveProgress(config, "applyPromotionCode", { 
        promoCode, 
        promoSkipped: false, 
        promoTotal: total, 
        promoDiscountAmount: discountAmount 
      }, state);

      return {
        bookingProgress: {
          ...state.bookingProgress,
          completedSteps: [...(state.bookingProgress?.completedSteps || []), "applyPromotionCode"],
          promoCode,
          promoSkipped: false,
          promoTotal: total,
          promoDiscountAmount: discountAmount,
          promoCodeState: undefined,
        },
        messages: [
          new HumanMessage({ content: userInput }), // Send user input to frontend
          new AIMessage({
            content: `✅ Promo code "${promoCode}" applied successfully!\n\nNow I need some information to complete your booking. \n\nPlease Enter your First Name ,Last Name, Email and Phone`
          })
        ],
        userInput: "",
      };
    } else {
      console.log("   ❌ Promo code was not applied (invalid or expired)");
      
      return {
        bookingProgress: {
          ...state.bookingProgress,
          promoCodeState: "retrying_code",
        },
        messages: [
          new HumanMessage({ content: userInput }), // Send user input to frontend
          new AIMessage({
            content: `❌ The promo code "${promoCode}" is invalid or expired.\n\nWould you like to try another promo code? (yes/no)`
          })
        ],
        userInput: "",
      };
    }
  } catch (error) {
    console.error("   ❌ Error applying promo code:", error);
    
    return {
      bookingProgress: {
        ...state.bookingProgress,
        promoCodeState: "retrying_code",
      },
      messages: [
        new HumanMessage({ content: userInput }), // Send user input to frontend
        new AIMessage({
          content: `❌ There was an issue applying the promo code "${promoCode}".\n\nWould you like to try another promo code? (yes/no)`
        })
      ],
      userInput: "",
    };
  }
}

async function promptForClientInfo(
  state: typeof StateAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof StateAnnotation.State>> {
  console.log("\n💬 [promptForClientInfo] Showing prompt...");

  const existingInfo = state.bookingProgress?.clientInfo || {};
  console.log("   Existing info:", existingInfo);
  
  const missingFields: string[] = [];
  if (!existingInfo.firstName) missingFields.push("first name");
  if (!existingInfo.lastName) missingFields.push("last name");
  if (!existingInfo.email) missingFields.push("email address");
  if (!existingInfo.phoneNumber) missingFields.push("phone number");
  
  let message = "";
  
  // Show collected info if any
  if (Object.keys(existingInfo).some(key => existingInfo[key as keyof typeof existingInfo])) {
    message += "I have:\n";
    if (existingInfo.firstName) message += `✓ First name: ${existingInfo.firstName}\n`;
    if (existingInfo.lastName) message += `✓ Last name: ${existingInfo.lastName}\n`;
    if (existingInfo.email) message += `✓ Email: ${existingInfo.email}\n`;
    if (existingInfo.phoneNumber) message += `✓ Phone: ${existingInfo.phoneNumber}\n`;
    message += "\n";
  }
  
  // Ask for missing info
  if (missingFields.length > 0) {
    message += `Please provide your ${missingFields.join(", ")}:`;
  }
  
  console.log("📣 Message to user:");
  console.log(message);
  
  const prompt: HumanInterrupt = {
    action_request: { action: "collect_client_info", args: {} },
    config: {
      allow_respond: true,
      allow_ignore: false,
      allow_accept: false,
      allow_edit: false,
    },
    description: message,
  };
  const response = interrupt([prompt]) as
    | Array<HumanResponse | string>
    | HumanResponse
    | string
    | null;
  console.log("   ▶️  Resumed with:", response);

  const userInput = getInterruptText(response);

  return {
    messages: [
      new AIMessage({ content: message }),
      new HumanMessage({ content: userInput }), // Send user input to frontend
    ],
    userInput: userInput,
  };
}


// async function collectClientInfo(
//   state: typeof StateAnnotation.State,
//   config: LangGraphRunnableConfig,
// ): Promise<Partial<typeof StateAnnotation.State>> {
//   console.log("\n📋 [collectClientInfo] Processing user input...");

//   // Get existing client info from state
//   const existingInfo = state.bookingProgress?.clientInfo || {};
//   console.log("   Existing info:", existingInfo);

//   // Get user input
//   const userInput = state.userInput?.trim() || "";
//   console.log("   User input:", userInput);

//   // Initialize newInfo with existing data
//   let newInfo = { ...existingInfo };

//   // Extract information from user input using regex patterns
//   if (userInput && userInput.toLowerCase() !== 'okk' && userInput.toLowerCase() !== 'ok') {
//     console.log("   🔍 Extracting client info from user input...");

//     try {
//       // Extract email
//       if (!newInfo.email) {
//         const emailMatch = userInput.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
//         if (emailMatch) {
//           newInfo.email = emailMatch[0];
//           console.log("   ✓ Extracted email:", newInfo.email);
//         }
//       }

//       // Extract phone number
//       if (!newInfo.phoneNumber) {
//         const phoneMatch = userInput.match(/\b(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/);
//         if (phoneMatch) {
//           newInfo.phoneNumber = phoneMatch[0].replace(/\D/g, "");
//           console.log("   ✓ Extracted phone:", newInfo.phoneNumber);
//         }
//       }

//       // Extract name
//       if (!newInfo.firstName || !newInfo.lastName) {
//         // Remove email and phone from text for cleaner name extraction
//         let cleanText = userInput
//           .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '')
//           .replace(/\b(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '')
//           .trim();

//         // Try patterns like "My name is John Doe" or "I'm John Doe"
//         let nameMatch = cleanText.match(/(?:name is|i'm|i am|call me)\s+([A-Za-z]+)(?:\s+([A-Za-z]+))?/i);
        
//         if (!nameMatch) {
//           // Try to find two capitalized words
//           nameMatch = cleanText.match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/);
//         }
        
//         if (!nameMatch) {
//           // Try to find any two words that look like names
//           nameMatch = cleanText.match(/\b([A-Za-z]{2,})\s+([A-Za-z]{2,})\b/);
//         }

//         if (nameMatch) {
//           if (!newInfo.firstName && nameMatch[1]) {
//             newInfo.firstName = nameMatch[1];
//             console.log("   ✓ Extracted first name:", newInfo.firstName);
//           }
//           if (!newInfo.lastName && nameMatch[2]) {
//             newInfo.lastName = nameMatch[2];
//             console.log("   ✓ Extracted last name:", newInfo.lastName);
//           }
//         } else if (!newInfo.firstName && cleanText.match(/\b([A-Za-z]{2,})\b/)) {
//           // If only one name found, treat as first name
//           const singleNameMatch = cleanText.match(/\b([A-Za-z]{2,})\b/);
//           if (singleNameMatch) {
//             newInfo.firstName = singleNameMatch[1];
//             console.log("   ✓ Extracted first name:", newInfo.firstName);
//           }
//         }
//       }
//     } catch (error) {
//       console.error("   ❌ Error extracting client info:", error);
//     }
//   }

//   console.log("   Updated info:", newInfo);

//   // Check what's still missing
//   const missingFields: string[] = [];
//   if (!newInfo.firstName) missingFields.push("first name");
//   if (!newInfo.lastName) missingFields.push("last name");
//   if (!newInfo.email) missingFields.push("email address");
//   if (!newInfo.phoneNumber) missingFields.push("phone number");

//   console.log("   Missing fields:", missingFields);

//   // Save progress (always save, even if partial)
//   await saveProgress(config, "collectClientInfo_processing", {
//     clientInfo: newInfo,
//   }, state);

//   // If all information is collected, mark as complete
//   if (missingFields.length === 0) {
//     console.log("   ✅ All client info collected!");
    
//     await saveProgress(config, "collectClientInfo", {
//       clientInfo: newInfo,
//     }, state);

//     return {
//       bookingProgress: {
//         ...state.bookingProgress,
//         completedSteps: [...(state.bookingProgress?.completedSteps || []), "collectClientInfo"],
//         clientInfo: newInfo,
//       },
//       messages: [new AIMessage({ 
//         content: `Perfect! I have all your information:\n✓ Name: ${newInfo.firstName} ${newInfo.lastName}\n✓ Email: ${newInfo.email}\n✓ Phone: ${newInfo.phoneNumber}\n\nProceeding with your booking...` 
//       })],
//       userInput: "",
//     };
//   }

//   // If still missing info, return to promptForClientInfo
//   console.log("   ⏭️  Still missing info, will prompt again");
  
//   return {
//     bookingProgress: {
//       ...state.bookingProgress,
//       clientInfo: newInfo,
//     },
//     messages: [new AIMessage({ content: `Thanks! I've recorded that information.` })],
//     userInput: "",
//   };
// }

async function collectClientInfo(
  state: typeof StateAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof StateAnnotation.State>> {
  console.log("\n📋 [collectClientInfo] Processing user input...");

  const existingInfo = state.bookingProgress?.clientInfo || {};
  console.log("   Existing info:", existingInfo);

  const userInput = state.userInput?.trim() || "";
  console.log("   User input:", userInput);

  let newInfo = { ...existingInfo };

  if (userInput && userInput.toLowerCase() !== 'okk' && userInput.toLowerCase() !== 'ok') {
    console.log("   🔍 Extracting client info from user input...");

    try {
      // Extract email
      if (!newInfo.email) {
        const emailMatch = userInput.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
        if (emailMatch) {
          newInfo.email = emailMatch[0];
          console.log("   ✓ Extracted email:", newInfo.email);
        }
      }

      // Extract phone number
      if (!newInfo.phoneNumber) {
        const phoneMatch = userInput.match(/\b(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/);
        if (phoneMatch) {
          newInfo.phoneNumber = phoneMatch[0].replace(/\D/g, "");
          console.log("   ✓ Extracted phone:", newInfo.phoneNumber);
        }
      }

      // Extract name
      if (!newInfo.firstName || !newInfo.lastName) {
        let cleanText = userInput
          .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '')
          .replace(/\b(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '')
          .trim();

        let nameMatch = cleanText.match(/(?:name is|i'm|i am|call me)\s+([A-Za-z]+)(?:\s+([A-Za-z]+))?/i);
        
        if (!nameMatch) {
          nameMatch = cleanText.match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/);
        }
        
        if (!nameMatch) {
          nameMatch = cleanText.match(/\b([A-Za-z]{2,})\s+([A-Za-z]{2,})\b/);
        }

        if (nameMatch) {
          if (!newInfo.firstName && nameMatch[1]) {
            newInfo.firstName = nameMatch[1];
            console.log("   ✓ Extracted first name:", newInfo.firstName);
          }
          if (!newInfo.lastName && nameMatch[2]) {
            newInfo.lastName = nameMatch[2];
            console.log("   ✓ Extracted last name:", newInfo.lastName);
          }
        } else if (!newInfo.firstName && cleanText.match(/\b([A-Za-z]{2,})\b/)) {
          const singleNameMatch = cleanText.match(/\b([A-Za-z]{2,})\b/);
          if (singleNameMatch) {
            newInfo.firstName = singleNameMatch[1];
            console.log("   ✓ Extracted first name:", newInfo.firstName);
          }
        }
      }
    } catch (error) {
      console.error("   ❌ Error extracting client info:", error);
    }
  }

  console.log("   Updated info:", newInfo);

  const missingFields: string[] = [];
  if (!newInfo.firstName) missingFields.push("first name");
  if (!newInfo.lastName) missingFields.push("last name");
  if (!newInfo.email) missingFields.push("email address");
  if (!newInfo.phoneNumber) missingFields.push("phone number");

  console.log("   Missing fields:", missingFields);

  await saveProgress(config, "collectClientInfo_processing", {
    clientInfo: newInfo,
  }, state);

  if (missingFields.length === 0) {
    console.log("   ✅ All client info collected!");
    
    // ⭐ GENERATE PAYMENT URL HERE (Don't call setClientOnCart)
    const selectedPlanName = state.bookingProgress?.selectedPlanName || "Membership";

    // If a promo was applied, Boulevard already returned the post-discount total — use that.
    // Otherwise use the original plan price.
    const promoTotal            = state.bookingProgress?.promoTotal;            // post-discount (cents)
    const promoDiscountAmount   = state.bookingProgress?.promoDiscountAmount;   // discount  (cents)
    const selectedPlanPrice     = state.bookingProgress?.selectedPlanPrice || "0";

    const effectivePriceCents = promoTotal != null
      ? parseInt(promoTotal.toString().replace(/[^0-9]/g, ''), 10)
      : parseInt(selectedPlanPrice.toString().replace(/[^0-9]/g, ''), 10);

    const amountInDollars = (effectivePriceCents / 100).toFixed(2);

    // Build a discount line for the summary (only when promo was applied)
    const discountLine = promoDiscountAmount != null
      ? `\n- Discount: -$${(parseInt(promoDiscountAmount.toString().replace(/[^0-9]/g, ''), 10) / 100).toFixed(2)} (${state.bookingProgress?.promoCode})`
      : '';

    console.log("💰 [collectClientInfo] selectedPlanPrice (raw):", selectedPlanPrice);
    console.log("💰 [collectClientInfo] promoTotal (raw):", promoTotal);
    console.log("💰 [collectClientInfo] Effective amount in dollars:", amountInDollars);
    
    // Get userId and threadId from config for token callback
    const configurable = ensureConfiguration(config);
    const userId = configurable.userId;
    const threadId = config.configurable?.thread_id || 'default';
    
    console.log("whythread",threadId);
      

    // Build payment URL with userId and threadId for token callback
     //const paymentUrl = `https://blvd-chatbot.ostlive.com/checkout/?email=${encodeURIComponent(newInfo.email!)}&amount=${amountInDollars}&userId=${encodeURIComponent(userId)}&threadId=${encodeURIComponent(threadId)}`;
     const paymentUrl = `http://localhost:4200/checkout/?email=${encodeURIComponent(newInfo.email!)}&amount=${amountInDollars}&userId=${encodeURIComponent(userId)}&threadId=${encodeURIComponent(threadId)}`;
    
    console.log("💳 [collectClientInfo] Generated payment URL:", paymentUrl);
    console.log("💰 [collectClientInfo] Amount: $" + amountInDollars);
    console.log("🔑 [collectClientInfo] UserId:", userId, "ThreadId:", threadId);
    
    await saveProgress(config, "collectClientInfo", {
      clientInfo: newInfo,
      paymentUrl: paymentUrl, // ⭐ Save payment URL
    }, state);

    return {
      bookingProgress: {
        ...state.bookingProgress,
        completedSteps: [...(state.bookingProgress?.completedSteps || []), "collectClientInfo"],
        clientInfo: newInfo,
        paymentUrl: paymentUrl, // ⭐ Save to state
      },
      messages: [new AIMessage({ 
        content: `

📋 Summary:
- Location: ${state.bookingProgress?.selectedLocationName}
- Plan: ${selectedPlanName}
- Name: ${newInfo.firstName} ${newInfo.lastName}
- Email: ${newInfo.email}
- Phone: ${newInfo.phoneNumber}${state.bookingProgress?.promoCode ? `\n- Promo: ${state.bookingProgress.promoCode}` : ''}${discountLine}
- Amount: $${amountInDollars}

💳 Click below to complete your payment:
${paymentUrl}

After payment, your membership will be automatically processed.` 
      })],
      userInput: "",
    };
  }

  console.log("   ⏭️  Still missing info, will prompt again");
  
  return {
    bookingProgress: {
      ...state.bookingProgress,
      clientInfo: newInfo,
    },
    messages: [new AIMessage({ content: `Thanks! I've recorded that information.` })],
    userInput: "",
  };
}


async function setClientOnCart(
  state: typeof StateAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof StateAnnotation.State>> {
  console.log("\n💾 [setClientOnCart] Saving to cart...");

  try {
    const cartId = state.bookingProgress?.cartId;
    const clientInfo = state.bookingProgress?.clientInfo;

    if (!cartId || !clientInfo) throw new Error("Missing data");

    await blvdSetClientOnCart(cartId, clientInfo);
    console.log("✅ [setClientOnCart] Saved");

    await saveProgress(config, "setClientOnCart", {}, state);

    // Clear for next booking
    // ⭐ FIX: Include threadId in namespace for thread isolation
    const store = getStoreFromConfigOrThrow(config);
    const configurable = ensureConfiguration(config);
    const threadId = config.configurable?.thread_id || 'default';
    console.log("thrrrr",threadId);
    
    await store.delete(["booking", configurable.userId, threadId], "progress");

    console.log("thrrrr2",threadId);

    return {
      bookingProgress: {
        ...state.bookingProgress,
        completedSteps: [...(state.bookingProgress?.completedSteps || []), "setClientOnCart"],
      },
      messages: [new AIMessage({
        content: `Booking complete! \n\n📋 Summary:\n- Location: ${state.bookingProgress?.selectedLocationName}\n- Plan: ${state.bookingProgress?.selectedPlanName}\n- Name: ${clientInfo.firstName} ${clientInfo.lastName}\n- Email: ${clientInfo.email}\n- Phone: ${clientInfo.phoneNumber}${state.bookingProgress?.promoCode ? `\n- Promo: ${state.bookingProgress.promoCode}` : ''}`
      })],
    };
  } catch (error) {
    console.error("[setClientOnCart] Error:", error);
    return {
      messages: [new AIMessage({ content: "Error saving info. Please try again." })],
    };
  }
}

async function addCardPaymentMethod(
  state: typeof StateAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof StateAnnotation.State>> {
  console.log("\n💳 [addCardPaymentMethod] Adding payment method...");

  try {
    const cartId = state.bookingProgress?.cartId;
    const cardToken = state.bookingProgress?.cardToken;

    if (!cartId || !cardToken) {
      throw new Error("Missing cart ID or card token");
    }

    const result = await blvdAddCartCardPaymentMethod(cartId, cardToken, true);
    console.log("[addCardPaymentMethod] Payment method added");

    await saveProgress(config, "addCardPaymentMethod", {}, state);

    return {
      bookingProgress: {
        ...state.bookingProgress,
        completedSteps: [...(state.bookingProgress?.completedSteps || []), "addCardPaymentMethod"],
      },
      messages: [new AIMessage({
        content: `Payment method added successfully!`
      })],
    };
  } catch (error) {
    console.error("[addCardPaymentMethod] Error:", error);
    return {
      messages: [new AIMessage({ 
        content: "Error adding payment method. Please try again." 
      })],
    };
  }
}

async function checkoutCart(
  state: typeof StateAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof StateAnnotation.State>> {
  console.log("\n🛒 [checkoutCart] Processing checkout...");

  try {
    const cartId = state.bookingProgress?.cartId;

    if (!cartId) {
      throw new Error("Missing cart ID");
    }

    const result = await blvdCheckoutCart(cartId);
    console.log("[checkoutCart] Checkout complete");

    await saveProgress(config, "checkoutCart", {}, state);

    // Clear for next booking
    const store = getStoreFromConfigOrThrow(config);
    const configurable = ensureConfiguration(config);
    await store.delete(["booking", configurable.userId], "progress");

    return {
      bookingProgress: {
        ...state.bookingProgress,
        completedSteps: [...(state.bookingProgress?.completedSteps || []), "checkoutCart"],
      },
      messages: [new AIMessage({
        content: `🎉 Checkout complete! Your booking is confirmed.\n\nCart ID: ${cartId}`
      })],
    };
  } catch (error) {
    console.error("[checkoutCart] Error:", error);
    return {
      messages: [new AIMessage({ 
        content: "Error during checkout. Please try again." 
      })],
    };
  }
}
// ============================================================================
// ROUTING
// ============================================================================
async function routeAfterLoad(state: typeof StateAnnotation.State): string {
  // console.log("\n🔀 [routeAfterLoad] Routing...");
  
  const completed = state.bookingProgress?.completedSteps || [];
  const userInput = state.userInput?.trim() || "";
  // console.log("   Completed:", completed);
  console.log("   User input:", userInput ? `"${userInput}"` : "(empty)");

  // ⭐ NEW: If bookingProgress is undefined or empty, start fresh
  if (!state.bookingProgress || completed.length === 0) {
    console.log("   → getLocations (fresh start - no progress found)");
    return "getLocations";
  }

  // // ⭐ NEW: Check if this is an internal booking status check
  // if (userInput === "check_booking_status_internal") {
  //   console.log("   → checkBookingStatus (internal status check)");
  //   return "checkBookingStatus";
  // }

    // ⭐ NEW: Check if this is an internal booking status check
  // Check the last message content (could be AIMessage or HumanMessage)
  // const lastMessage = state.messages[state.messages.length - 1];
  // const lastMessageContent = lastMessage?.content?.toString().trim() || "";
  
  // if (lastMessageContent === "check_booking_status_internal") {
  //   console.log("   → checkBookingStatus (internal status check)");
  //   return "checkBookingStatus";
  // }


  const store = getStoreFromConfigOrThrow(config);
  const configurable = ensureConfiguration(config);
  const threadId = config.configurable?.thread_id || 'default';
  
  console.log("🔍 [routerAfterReload] Checking booking status from store...");
  
  try {
    const results = await store.search(["booking", configurable.userId, threadId], { limit: 1 });
    
    console.log("   - Search results length:", results?.length || 0);
    
    if (results && results.length > 0) {
      const progress = results[0].value;
      
      console.log("     • completedSteps:", progress.completedSteps);
      console.log("     • checkoutComplete:", progress.data?.checkoutComplete);
      
      // Check if checkout is complete
      if (progress.data?.checkoutComplete === true) {
        console.log("   ✅ Checkout is complete, sending success message");
        return "checkBookingStatus";
      } else {
        console.log("     • checkoutComplete value:", progress.data?.checkoutComplete);
      }
    } else {
      console.log("   ⚠️ No progress data found in store");
    }
  } catch (error) {
    console.error("   ❌ Error checking booking status from store:");
  }

  // New payment flow
  if (completed.includes("checkoutCart")) {
    return "__end__";
  }
  if (completed.includes("addCardPaymentMethod")) {
    return "checkoutCart";
  }
  
  // Check if we have a card token to process
  if (completed.includes("setClientOnCart") && state.bookingProgress?.cardToken) {
    console.log("   → addCardPaymentMethod (card token present)");
    return "addCardPaymentMethod";
  }
  
  if (completed.includes("setClientOnCart")) {
    return "__end__";
  }
  if (completed.includes("collectClientInfo")) {
    return "setClientOnCart";
  }
  
  // If we just processed client info but it's incomplete, handle user input
  if (completed.includes("collectClientInfo_processing")) {
    const info = state.bookingProgress?.clientInfo;
    
    // If all info complete, proceed to save
    if (info?.firstName && info?.lastName && info?.email && info?.phoneNumber) {
      console.log("   → setClientOnCart (client info complete)");
      return "setClientOnCart";
    }
    
    // ⭐ FIX: If user provided new input, process it in collectClientInfo
    if (userInput && userInput.toLowerCase() !== 'ok' && userInput.toLowerCase() !== 'okk') {
      console.log("   → collectClientInfo (processing new user input)");
      return "collectClientInfo";
    }
    
    // If no new input, show prompt again
    console.log("   → promptForClientInfo (no new input, showing prompt)");
    return "promptForClientInfo";
  }
  
  // If applyPromotionCode completed, handle client info collection
  if (completed.includes("applyPromotionCode")) {
    const info = state.bookingProgress?.clientInfo;
    
    // If all info already complete (from previous session), skip to setClientOnCart
    if (info?.firstName && info?.lastName && info?.email && info?.phoneNumber) {
      console.log("   → setClientOnCart (client info already complete)");
      return "setClientOnCart";
    }
    
    // If user provided input, process it in collectClientInfo
    if (userInput) {
      console.log("   → collectClientInfo (processing user input)");
      return "collectClientInfo";
    }
    
    // Otherwise show prompt
    console.log("   → promptForClientInfo (showing prompt)");
    return "promptForClientInfo";
  }
  
  if (completed.includes("addMembershipToCart")) {
    return "applyPromotionCode";
  }
  if (completed.includes("selectPlan")) {
    return "addMembershipToCart";
  }
  
  // If getMembershipPlans completed and plan already selected, continue to next step
  if (completed.includes("getMembershipPlans") && state.bookingProgress?.selectedPlanId) {
    console.log("   → addMembershipToCart (plan already selected)");
    return "addMembershipToCart";
  }
  
  // If getMembershipPlans completed and user provided input, process the selection
  if (completed.includes("getMembershipPlans") && state.userInput && state.userInput.trim()) {
    console.log("   → selectPlan (processing user input)");
    return "selectPlan";
  }
  
  // If getMembershipPlans completed but no plan selected and no input, prompt for selection
  if (completed.includes("getMembershipPlans") && !state.bookingProgress?.selectedPlanId) {
    console.log("   → selectPlan (waiting for plan selection)");
    return "selectPlan";
  }
  
  if (completed.includes("createCart")) {
    return "getMembershipPlans";
  }
  if (completed.includes("selectLocation")) {
    return "createCart";
  }
  
  // If getLocations completed and location already selected, continue to next step
  if (completed.includes("getLocations") && state.bookingProgress?.selectedLocationId) {
    console.log("   → createCart (location already selected)");
    return "createCart";
  }
  
  // If getLocations completed and user provided input, process the selection
  if (completed.includes("getLocations") && state.userInput && state.userInput.trim()) {
    console.log("   → selectLocation (processing user input)");
    return "selectLocation";
  }
  
  // If getLocations completed but no location selected and no input, prompt for selection
  if (completed.includes("getLocations") && !state.bookingProgress?.selectedLocationId) {
    console.log("   → selectLocation (waiting for location selection)");
    return "selectLocation";
  }

  console.log("   → getLocations (fresh start)");
  return "getLocations";
}


// Node to check if booking is completed after payment
async function checkBookingStatus(
  state: typeof StateAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof StateAnnotation.State>> {
  const configurable = ensureConfiguration(config);
  const userId = configurable.userId;
  
  console.log('🔍 [checkBookingStatus] Checking booking completion status for user:', userId);
  
  if (!userId) {
    return state;
  }

  try {
    // Search for booking progress
    const store = getStoreFromConfigOrThrow(config);
    const threadId = config.configurable?.thread_id || "default";
    const searchResult = await store.search(["booking", userId, threadId]);
    
    if (searchResult && searchResult.length > 0) {
      const bookingData = searchResult[0].value;
      
      console.log('📊 [checkBookingStatus] Found booking data:', JSON.stringify(bookingData, null, 2));
      
      // Check if booking is completed
      const isComplete = bookingData.data?.checkoutComplete === true;
      
      console.log("isComplete",isComplete);
      

      if (isComplete) {

      console.log("entered222");

        // Extract booking details for summary
        const locationName = bookingData.data?.selectedLocationName || "N/A";
        const planName = bookingData.data?.selectedPlanName || "N/A";
        const planPrice = (bookingData.data?.selectedPlanPrice ?? 0) / 100;
        const promoTotal =
          bookingData.data?.promoTotal != null
            ? bookingData.data.promoTotal / 100
            : planPrice;
         const clientInfo = bookingData.data?.clientInfo || {};
        const firstName = clientInfo.firstName || "N/A";
        const lastName = clientInfo.lastName || "N/A";
        const email = clientInfo.email || "N/A";
        const phoneNumber = clientInfo.phoneNumber || "N/A";
     
        const hasDiscount = planPrice !== promoTotal;
        const savings = hasDiscount ? Math.round(planPrice - promoTotal) : 0;
        


        const completionMessage = `[RECEIPT]
        ✅ Membership Purchased - Receipt
        
        📍 Location: ${locationName}
        
        💎 Membership Plan: ${planName}
        
        💰 Pricing Details:
      - Original Price: $${planPrice}
        ${hasDiscount ? `- After : $${promoTotal}` : ""}
        ${hasDiscount ? `- You Saved: $${savings}` : ""}
        
        👤 Client Information:
        - Name: ${firstName} ${lastName}
        - Email: ${email}
        - Phone: ${phoneNumber}
        
        📧 A confirmation email has been sent to ${email}
        
        Thank you ! 🎉`;

        console.log("[checkBookingStatus] Booking complete, sending summary");

        return {
          messages: [
            new AIMessage({
              content: completionMessage
            })
          ]
        };
      }
    }
  } catch (error) {
    console.error('[checkBookingStatus] Error checking booking status:', error);
  }
  
  return state;
}



// Node to cleanup state after successful booking
async function cleanupState(state: typeof StateAnnotation.State): Promise<Partial<typeof StateAnnotation.State>> {
  const userId = ensureConfiguration(config).userId;
  
  console.log('🧹 [cleanupState] Cleaning up booking state for user:', userId);
  
  if (!userId) {
    return state;
  }

  try {
    // Delete the booking progress from the store
    // ⭐ FIX: Include threadId in namespace for thread isolation
    const threadId = config.configurable?.thread_id || 'default';
    await config.store.delete(["booking", userId, threadId], "progress");
    console.log('✅ [cleanupState] Booking state cleared successfully');
    
    // Also save the updated store to file
    await saveStoreToFile();
    console.log('✅ [cleanupState] Store saved to file');
    
    // Return state with cleared bookingProgress
    return {
      bookingProgress: undefined
    };
  } catch (error) {
    console.error('[cleanupState] Error cleaning up state:', error);
  }
  
  return state;
}

// ============================================================================
// GRAPH CONSTRUCTION
// ============================================================================

const workflow = new StateGraph(
  { stateSchema: StateAnnotation },
  ConfigurationAnnotation
)
  .addNode("loadProgress", loadSavedProgress)
  .addNode("getLocations", getLocations)
  .addNode("selectLocation", selectLocation)
  .addNode("createCart", createCart)
  .addNode("getMembershipPlans", getMembershipPlans)
  .addNode("selectPlan", selectPlan)
  .addNode("addMembershipToCart", addMembershipToCart)
  .addNode("applyPromotionCode", applyPromotionCode)
  .addNode("promptForClientInfo", promptForClientInfo)
  .addNode("collectClientInfo", collectClientInfo)
  .addNode("setClientOnCart", setClientOnCart)
  .addNode("addCardPaymentMethod", addCardPaymentMethod)
  .addNode("checkoutCart", checkoutCart)
  .addNode("checkBookingStatus", checkBookingStatus)
  .addNode("cleanupState", cleanupState)
  .addEdge(START, "loadProgress")
  .addConditionalEdges("loadProgress", routeAfterLoad, {
    getLocations: "getLocations",
    selectLocation: "selectLocation",
    createCart: "createCart",
    getMembershipPlans: "getMembershipPlans",
    selectPlan: "selectPlan",
    addMembershipToCart: "addMembershipToCart",
    applyPromotionCode: "applyPromotionCode",
    promptForClientInfo: "promptForClientInfo",
    collectClientInfo: "collectClientInfo",
    setClientOnCart: "setClientOnCart",
    addCardPaymentMethod: "addCardPaymentMethod",
    checkoutCart: "checkoutCart",
    checkBookingStatus: "checkBookingStatus",
    cleanupState: "cleanupState",
    __end__: END,
  })
  .addEdge("getLocations", "selectLocation")
  .addConditionalEdges("selectLocation", (state: typeof StateAnnotation.State) => {
    // If location was selected successfully, proceed to createCart
    if (state.bookingProgress?.selectedLocationId) {
      return "createCart";
    }
    // Otherwise, go back to selectLocation to show error and get new input
    return "selectLocation";
  }, {
    selectLocation: "selectLocation",
    createCart: "createCart",
  })
  .addEdge("createCart", "getMembershipPlans")
  .addEdge("getMembershipPlans", "selectPlan")
  .addConditionalEdges("selectPlan", (state: typeof StateAnnotation.State) => {
    // If plan was selected successfully, proceed to addMembershipToCart
    if (state.bookingProgress?.selectedPlanId) {
      return "addMembershipToCart";
    }
    // Otherwise, go back to selectPlan to show error and get new input
    return "selectPlan";
  }, {
    selectPlan: "selectPlan",
    addMembershipToCart: "addMembershipToCart",
  })
  .addEdge("addMembershipToCart", "applyPromotionCode")
  .addConditionalEdges("applyPromotionCode", (state: typeof StateAnnotation.State) => {
    // Check if promo code step is complete
    const completed = state.bookingProgress?.completedSteps || [];
    const promoCodeState = state.bookingProgress?.promoCodeState;
    
    // If we're still in the promo flow (asking for code or retrying), loop back
    if (promoCodeState === "asking_for_code" || promoCodeState === "retrying_code") {
      console.log("🔄 [Router] Promo flow incomplete - looping back to applyPromotionCode");
      return "applyPromotionCode";
    }
    
    // If promo step is completed, move to client info
    if (completed.includes("applyPromotionCode")) {
      console.log("✅ [Router] Promo flow complete - moving to promptForClientInfo");
      return "promptForClientInfo";
    }
    
    // Default: loop back to complete the promo flow
    console.log("⚠️ [Router] Promo step not in completedSteps - looping back");
    return "applyPromotionCode";
  }, {
    applyPromotionCode: "applyPromotionCode",
    promptForClientInfo: "promptForClientInfo",
  })
  .addEdge("promptForClientInfo", "collectClientInfo")
  // .addConditionalEdges("collectClientInfo", (state: typeof StateAnnotation.State) => {
  //   // Check if all required client info is collected
  //   const info = state.bookingProgress?.clientInfo;
  //   if (info?.firstName && info?.lastName && info?.email && info?.phoneNumber) {
  //     return "setClientOnCart";
  //   }
  //   // Otherwise, show prompt again
  //   return "promptForClientInfo";
  // }, {
  //   promptForClientInfo: "promptForClientInfo",
  //   setClientOnCart: "setClientOnCart",
  // })

  .addConditionalEdges("collectClientInfo", (state: typeof StateAnnotation.State) => {
    // Check if all required client info is collected
    const info = state.bookingProgress?.clientInfo;
    if (info?.firstName && info?.lastName && info?.email && info?.phoneNumber) {
      // All info collected - show payment link and END (wait for payment)
      return "__end__";
    }
    // Otherwise, show prompt again
    return "promptForClientInfo";
  }, {
    promptForClientInfo: "promptForClientInfo",
    __end__: END,
  })
  .addEdge("setClientOnCart", END)
  // .addEdge("addCardPaymentMethod", "checkoutCart")
  // .addEdge("checkoutCart", "checkBookingStatus")
  .addEdge("checkBookingStatus", END);

// ✅ Graph is compiled WITHOUT checkpointer here
// Checkpointer is passed at runtime in index.ts



const config: any = {
  configurable: {
    checkpointer:checkpointer,
    // thread_id: userId,
    // userId: userId,
    model: "claude-sonnet-4-5-20250929",
  },
  store: memorySTore,
};




export const graph = workflow.compile(config);
graph.name = "MembershipBookingAgent";

console.log("[Setup] Graph ready with interrupt pattern!");

// ============================================================================
// EXPRESS SERVER FOR TOKEN ENDPOINT
// ============================================================================

const app = express();
app.use(cors());
app.use(express.json());

// Store for temporary token storage (in production, use Redis or similar)
const tokenStore = new Map<string, string>();

/**
 * POST /receive-token
 * Receives card token from payment form and stores it
 * 
 * Expected body:
 * {
 *   "token": "tok_xxxxxxxxxxxx",
 *   "userId": "user-123",
 *   "threadId": "thread-456"
 * }
 */
// app.post('/receive-token', async (req: Request, res: Response) => {
//   console.log("\n💳 [receive-token] Received token webhook");
  
//   try {
//     const { token, userId, threadId } = req.body;
    
//     if (!token) {
//       res.status(400).json({ 
//         success: false, 
//         error: "Missing token in request body" 
//       });
//       return;
//     }
    
//     if (!userId || !threadId) {
//       res.status(400).json({ 
//         success: false, 
//         error: "Missing userId or threadId in request body" 
//       });
//       return;
//     }
    
//     // Store the token with a composite key
//     const storeKey = `${userId}:${threadId}`;
//     tokenStore.set(storeKey, token);
//     console.log(`✅ [receive-token] Token stored for ${storeKey}`);
    
//     // Token will be automatically processed by the graph on next invocation
//     // The graph checks for tokens in the routing logic
    
//     res.json({ 
//       success: true, 
//       message: "Token received and will be processed",
//       userId,
//       threadId
//     });
    
//   } catch (error) {
//     console.error("❌ [receive-token] Error:", error);
//     res.status(500).json({ 
//       success: false, 
//       error: "Internal server error" 
//     });
//   }
// });





app.post('/receive-token', async (req: Request, res: Response) => {
  console.log("\n [receive-token] Received token webhook");
  console.log(" [receive-token] Request body:", JSON.stringify(req.body, null, 2));
  
  try {
    const { token, uuid, sessionId } = req.body;
    
    console.log("🔍 [receive-token] Extracted values:");
    console.log("   - userId:", uuid);
    console.log("   - threadId:", sessionId);

    config.configurable.thread_id = sessionId;

    const threadId = config.configurable?.thread_id || 'default';
    
    console.log('     • thread_id5555:', threadId);
    

    
    if (!token) {
      console.error("[receive-token] Missing token in request body");
      res.status(400).json({ 
        success: false, 
        error: "Missing token in request body" 
      });
      return;
    }
    
    if (!uuid || !sessionId) {
      console.error("[receive-token] Missing userId or threadId");
      console.error("   - uuid:", uuid);
      console.error("   - sessionId:", sessionId);
      res.status(400).json({ 
        success: false, 
        error: "Missing userId or threadId in request body" 
      });
      return;
    }
    
    // Store the token with a composite key
    const storeKey = `${uuid}:${sessionId}`;
    tokenStore.set(storeKey, token);
    console.log(`[receive-token] Token stored successfully!`);
    console.log(`   - Store key: ${storeKey}`);
    
    // ⭐ NEW: Automatically process payment after receiving token
    console.log("\n[receive-token] Starting automatic payment processing...");
    
    try {
      // Reload store data from file to ensure we have latest data
      console.log("[receive-token] Reloading store data from file...");
      try {
        await loadStoreFromFile();
        console.log("[receive-token] Store data reloaded successfully");
      } catch (loadError) {
        console.error("[receive-token] Error loading store data:", loadError);
        throw new Error("Failed to load store data: " + (loadError instanceof Error ? loadError.message : String(loadError)));
      }
      
      // Use the same store instance the graph was compiled with
      const store = memorySTore;
      
      console.log("[receive-token] Searching for booking progress...");
      
      const results = await store.search(["booking", uuid, sessionId], { limit: 1 });
      
      console.log("[receive-token] Search results:");
      // console.log("   - results:", JSON.stringify(results, null, 2));
      
      if (!results || results.length === 0) {
        throw new Error("No booking progress found for this user");
      }
      
      const progress = results[0].value;
      const cartId = progress.data?.cartId;
      const clientInfo = progress.data?.clientInfo;
      
      console.log("📋 [receive-token] Retrieved booking data:");
      console.log("   - cartId:", cartId);
      console.log("   - clientInfo:", clientInfo);
      
      if (!cartId) {
        throw new Error("Cart ID not found in booking progress");
      }
      
      if (!clientInfo?.firstName || !clientInfo?.lastName || !clientInfo?.email || !clientInfo?.phoneNumber) {
        throw new Error("Incomplete client information");
      }
      


      const configurable = ensureConfiguration(config);
      const userId = configurable.userId;
      const threadId = config.configurable?.thread_id || 'default';
      
      console.log('     • thread_i6666:', threadId);
    

      
      // Step 1: Set client info on cart
      console.log("\n[receive-token] Step 1: Setting client info on cart...");
      await blvdSetClientOnCart(cartId, clientInfo);
      console.log("[receive-token] Client info set successfully");
      
      // Step 2: Add card payment method
      console.log("\n[receive-token] Step 2: Adding card payment method...");
      await blvdAddCartCardPaymentMethod(cartId, token, true);
      console.log("[receive-token] Payment method added successfully");
      
      // Step 3: Checkout cart
      console.log("\n🛒 [receive-token] Step 3: Processing checkout...");
      const checkoutResult = await blvdCheckoutCart(cartId);
      console.log("[receive-token] Checkout complete!");
      console.log("[receive-token] Checkout result:", JSON.stringify(checkoutResult, null, 2));
      
      // Update progress to mark as complete
      const updatedProgress = {
        completedSteps: [...progress.completedSteps, "setClientOnCart", "addCardPaymentMethod", "checkoutCart"],
        data: {
          ...progress.data,
          checkoutComplete: true,
          checkoutResult: checkoutResult
        },
        messages: progress.messages,
        availableLocations: progress.availableLocations || [],
        availablePlans: progress.availablePlans || [],
        lastUpdated: new Date().toISOString(),
      };
      
      await store.put(["booking", uuid, sessionId], "progress", updatedProgress);
      console.log("[receive-token] Progress updated");
      
      // ⭐ Save store to file
      await saveStoreToFile();
      
      console.log("[receive-token] Payment processing complete!");
      
      res.json({ 
        success: true, 
        message: "Token received and payment processed successfully",
        userId: uuid,
        sessionId,
        checkoutResult
      });


// Automatically trigger the graph to send the success message
try {

  console.log('🔍 [receive-token] About to invoke graph...');
  console.log('   - sessionId from request:', sessionId);
  console.log('     • thread_id:', sessionId);
  console.log('     • userId:', uuid);

  const configurable = ensureConfiguration(config);
    const userId = configurable.userId;
    const threadId = config.configurable?.thread_id || 'default';
    
    console.log('     • thread_id333:', threadId);
  

  const graphResponse = await graph.invoke(
    {
      messages: [],  // ✅ Empty messages array instead of null
    },
    {
      configurable: {
        thread_id: sessionId,
        userId: uuid,
        model: "claude-sonnet-4-5-20250929",
        systemPrompt: SYSTEM_PROMPT,
      },
      store: memorySTore,
    }
  );

  console.log('[receive-token] Graph invoked with success message');
} catch (error) {
  console.error('[receive-token] Error invoking graph:', error);
}


      
      

      
      
    } catch (processingError) {
      console.error("[receive-token] Error during payment processing:");
      console.error("   - Error:", processingError);
      
      // Still return success for token receipt, but indicate processing failed
      res.json({ 
        success: true, 
        message: "Token received but payment processing failed",
        userId: uuid,
        sessionId,
        processingError: processingError instanceof Error ? processingError.message : String(processingError)
      });
    }
    
  } catch (error) {
    console.error("[receive-token] Error occurred:");
    console.error("   - Error type:", error?.constructor?.name);
    console.error("   - Error message:", error instanceof Error ? error.message : String(error));
    console.error("   - Error stack:", error instanceof Error ? error.stack : "No stack trace");
    console.error("   - Full error object:", error);
    
    res.status(500).json({ 
      success: false, 
      error: "Internal server error",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});




// /**
//  * GET /get-token/:userId/:threadId
//  * Helper endpoint to retrieve stored token (used internally by graph)
//  */
// app.get('/get-token/:userId/:threadId', async (req: Request, res: Response) => {
//   const { userId, threadId } = req.params;
//   const storeKey = `${userId}:${threadId}`;
//   const token = tokenStore.get(storeKey);
  
//   if (token) {
//     // Delete token after retrieval (one-time use)
//     tokenStore.delete(storeKey);
//     res.json({ success: true, token });
//   } else {
//     res.status(404).json({ success: false, error: "Token not found" });
//   }
// });

/**
 * Helper function to retrieve token from store
 * Used by the graph nodes
 */
export async function getStoredToken(userId: string, threadId: string): Promise<string | null> {
  const storeKey = `${userId}:${threadId}`;
  const token = tokenStore.get(storeKey);
  
  if (token) {
    // Remove token after retrieval (one-time use)
    tokenStore.delete(storeKey);
    console.log(`[getStoredToken] Retrieved token for ${storeKey}`);
    return token;
  }
  
  console.log(`[getStoredToken] No token found for ${storeKey}`);
  return null;
}

// Start the Express server
const PORT =  3030;
app.listen(PORT, () => {
  console.log(`[Token Server] Listening on port ${PORT}`);
  console.log(`   POST /receive-token - Receive card token`);
  console.log(`   GET /get-token/:userId/:threadId - Retrieve token`);
});
