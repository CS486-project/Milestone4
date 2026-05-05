const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const EventlogSchema = new Schema({
    participantID: String, // Unique identifier for the user
    eventType: String, // Store the type of event
    elementName: String, // Store the name of the element
    timestamp: { type: Date, default: Date.now } // Log the time of interaction
});

module.exports = mongoose.model('EventLog', EventlogSchema);