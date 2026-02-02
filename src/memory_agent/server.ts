import "dotenv/config";
import express from 'express';
import cors from 'cors';
import { graph } from "./graph.js";
import { InMemoryStore } from "@langchain/langgraph";

const app = express();

// ============================================================================
// STORE SETUP - Required by the graph
// ============================================================================
const store = new InMemoryStore();
console.log("🗄️  Store initialized");

// ============================================================================
// EXPRESS SERVER SETUP
// ============================================================================

app.use(cors({
  origin: 'http://localhost:4200',
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`\n📥 ${req.method} ${req.url}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

app.post('/receive-token', async (req, res) => {
  const { token, sessionId, uuid } = req.body;
  
  console.log("\n💳 ============================================");
  console.log("💳 Token received:", token);
  console.log("📋 Session ID:", sessionId);
  console.log("🔑 UUID:", uuid);
  console.log("💳 ============================================\n");

  if (!token) {
    return res.json({
      reply: {
        role: 'assistant',
        content: 'No token received.'
      }
    });
  }

  // Validate sessionId and uuid
  if (!sessionId || !uuid || sessionId === 'this.sessionId' || uuid === 'this.uUId') {
    console.error("❌ Invalid session/user IDs");
    return res.status(400).json({
      reply: {
        role: 'assistant',
        content: 'Invalid session or user ID. Please check your Angular app configuration.'
      }
    });
  }

  try {
    console.log("🔄 Processing payment with graph...");
    
    // ⭐ IMPORTANT: Pass the store in the config
    const result = await graph.invoke(
      {
        userInput: "",
        bookingProgress: {
          completedSteps: [],
          cardToken: token
        }
      },

      {
        configurable: {
          userId: "user_demo_test",  
          thread_id: "user_demo_test",      // Use the UUID from Angular
          sessionId: "user_demo_test" // Use the session ID from Angular
        },
        store: store  // ⭐ THIS WAS MISSING - the graph needs this!
      } as any
    );

    console.log("\n✅ ============================================");
    console.log("✅ Payment processed successfully");
    console.log("📊 Completed steps:", result.bookingProgress?.completedSteps);
    console.log("✅ ============================================\n");
    
    const lastMessage = result.messages?.[result.messages.length - 1];
    
    return res.json({
      reply: {
        role: 'assistant',
        content: lastMessage?.content || 'Payment processed and checkout complete!'
      },
      success: true,
      completedSteps: result.bookingProgress?.completedSteps
    });

  } catch (error) {
    console.error("\n❌ ============================================");
    console.error("❌ Error processing payment:", error);
    console.error("❌ Message:", error instanceof Error ? error.message : 'Unknown');
    console.error("❌ ============================================\n");
    
    return res.status(500).json({
      reply: {
        role: 'assistant',
        content: `Error processing payment: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      success: false
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log('\n🚀 ============================================');
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Ready to receive tokens from http://localhost:4200`);
  console.log('🔍 Health check: curl http://localhost:3000/health');
  console.log('🚀 ============================================\n');
});

// Handle server errors
server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use!`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', error);
    process.exit(1);
  }
});

