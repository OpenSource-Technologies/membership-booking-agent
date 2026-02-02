// state.ts - Updated with paymentUrl and selectedPlanPrice fields

import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

// Client information interface
export interface ClientInfo {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

// Booking state interface
export interface BookingState {
  currentStep?: string;
  stepsCompleted: string[];
  data: Record<string, any>;
  clientInfo: ClientInfo;
}

// Initial state
export const initialState: BookingState = {
  currentStep: undefined,
  stepsCompleted: [],
  data: {},
  clientInfo: {},
};

// Main state annotation
export const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  userInput: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  bookingProgress: Annotation<{
    completedSteps: string[];
    selectedLocationId?: string;
    selectedLocationName?: string;
    cartId?: string;
    cardToken?:string;
    selectedPlanId?: string;
    selectedPlanName?: string;
    selectedPlanPrice?: string; // ⭐ NEW: Store plan price
    promoCode?: string;
    promoSkipped?: boolean;
    paymentUrl?: string; // ⭐ NEW: Store generated payment URL
    clientInfo?: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phoneNumber?: string;
    };
  }>({
    reducer: (x, y) => {
      // Deep merge clientInfo to preserve partial data
      const mergedClientInfo = x?.clientInfo || y?.clientInfo 
        ? { ...(x?.clientInfo || {}), ...(y?.clientInfo || {}) }
        : undefined;
      
      return { 
        ...x, 
        ...y,
        clientInfo: mergedClientInfo,
        completedSteps: y?.completedSteps || x?.completedSteps || []
      };
    },
    default: () => ({ completedSteps: [] }),
  }),
  availableLocations: Annotation<any[]>({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  availablePlans: Annotation<any[]>({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
});