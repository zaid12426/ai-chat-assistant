const mongoose = require('mongoose');

// One exchange = one user prompt + the AI's response to it.
const exchangeSchema = new mongoose.Schema(
  {
    userPrompt: { type: String, required: true },
    aiResponse: { type: String, default: '' },
    tone: {
      type: String,
      enum: ['professional', 'casual', 'concise'],
      default: 'professional',
    },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

// One conversation thread = a title + an ordered list of exchanges.
const conversationSchema = new mongoose.Schema(
  {
    title: { type: String, default: 'New chat' },
    exchanges: { type: [exchangeSchema], default: [] },
  },
  { timestamps: true } // adds createdAt and updatedAt
);

module.exports = mongoose.model('Conversation', conversationSchema);
