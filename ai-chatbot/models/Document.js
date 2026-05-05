const mongoose = require("mongoose");

const ChunkSchema = new mongoose.Schema({
    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },
    embedding: { type: [Number], default: [] }
}, { _id: false });

const DocumentSchema = new mongoose.Schema({
    participantID: { type: String, required: true, index: true },
    filename: { type: String, required: true },
    text: { type: String, required: true },
    chunks: { type: [ChunkSchema], default: [] },
    processingStatus: { type: String, default: "ready" },
    processedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Document", DocumentSchema);
