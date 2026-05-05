const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const RetrievedDocumentSchema = new Schema({
    docName: { type: String },
    chunkIndex: { type: Number },
    chunkText: { type: String },
    relevanceScore: { type: Number }
  }, { _id: false });
  
  const ConfidenceMetricsSchema = new Schema({
    overallConfidence: { type: Number },
    retrievalConfidence: { type: Number },
    responseConfidence: { type: Number, default: null },
    retrievalMethod: { type: String }
  }, { _id: false });

const InteractionSchema = new Schema({
    participantID: String, // Unique identifier for the user
    systemID: { type: Number }, // System ID (1 for baseline, 2 for enhanced)
    userInput: String, // Store the user's message
    botResponse: String, // Store the bot's response
    timestamp: { type: Date, default: Date.now }, // Log the time of interaction
    retrievalMethod: { type: String }, // Store the retrieval method
    retrievedDocuments: { type: [RetrievedDocumentSchema], default: [] }, // Store the retrieved documents
    confidenceMetrics: { type: ConfidenceMetricsSchema, default: null } // Store the confidence metrics

});

module.exports = mongoose.model('Interaction', InteractionSchema);