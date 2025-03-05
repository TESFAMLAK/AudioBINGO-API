import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema(
  {
    ticketNumber: { type: String, required: true, unique: true },
    betAmount: { type: Number, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true, expires: 0 },
    address: { type: String, required: true },
    isChecked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Ticket = mongoose.model('Ticket', ticketSchema);
export default Ticket;
